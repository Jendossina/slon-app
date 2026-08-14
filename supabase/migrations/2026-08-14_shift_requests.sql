-- Заявки сотрудников: замена смены и предупреждение об опоздании.
--
-- Зачем. Два случая, которые до сих пор жили на словах и ломали данные:
--
--   • Официанты меняются сменами между собой. График об этом не знает, и
--     дальше всё считается неверно: приход сверяется с чужой сменой (человек
--     приходит к 15:00 на смену того, с кем поменялся, а триггер видит его
--     собственные 11:00 и пишет опоздание на четыре часа со штрафом 100 000 —
--     ровно это и разбирали 13.08 по Соснину), позиции в зале раздаются не тем,
--     чек-листы висят на том, кого сегодня нет.
--
--   • Человек знает заранее, что опоздает, и предупреждает. Наказывать за это
--     так же, как за молчаливое опоздание, несправедливо, а руками обнулять
--     штраф в базе — то, чем занимались до сих пор.
--
-- Решения владельца (14.08.2026):
--   • решает старший цеха по своему цеху, управляющий и менеджер — по любому
--     (та же лестница, что и в графике, функция can_edit_schedule_of);
--   • замена бывает двух видов: обмен днями и подмена (второй выходит вместо
--     первого, у первого в этот день смены не остаётся);
--   • согласие второго сотрудника отдельным шагом не спрашиваем — они
--     договариваются между собой, ему уходит уведомление;
--   • одобренное опоздание = штраф 0, но факт опоздания остаётся в истории и
--     дисциплинарный балл в бонусе официантов за него не снимается.
--
-- Заявка ничего не меняет сама по себе: график правится ТОЛЬКО в момент
-- одобрения и только внутри этой функции. Сотрудник графику неподвластен, иначе
-- заявка стала бы обходным путём для правки собственных смен.

create table if not exists public.shift_requests (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  kind            text not null check (kind in ('swap','late')),
  filial          text not null default 'chekhov',
  department      text,
  employee_id     bigint not null,          -- кто подаёт
  employee_name   text,
  date            date not null,            -- смена, о которой речь
  -- замена
  swap_kind       text check (swap_kind in ('exchange','cover')),
  partner_id      bigint,                   -- с кем меняется / кто подменяет
  partner_name    text,
  partner_date    date,                     -- для обмена: день, который берёт автор
  -- опоздание
  late_minutes    integer,                  -- на сколько опоздает, со слов
  reason          text,
  -- решение
  status          text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by      uuid,
  decided_by_name text,
  decided_at      timestamptz,
  decision_note   text,
  -- Заявка обязана быть полной: у замены есть партнёр и вид, у обмена — второй
  -- день, у опоздания — минуты. Полузаполненную заявку одобрять нечем.
  constraint shift_requests_shape check (
    (kind = 'swap' and swap_kind is not null and partner_id is not null
                   and (swap_kind <> 'exchange' or partner_date is not null))
    or
    (kind = 'late' and late_minutes is not null and late_minutes > 0)
  )
);

create index if not exists shift_requests_pending_idx on public.shift_requests (status, filial, date);
create index if not exists shift_requests_employee_idx on public.shift_requests (employee_id, date);

-- Одна необработанная заявка на день: две висящие заявки об одном и том же дне
-- означают, что одобрят обе и вторая перезапишет первую.
create unique index if not exists shift_requests_one_pending
  on public.shift_requests (employee_id, date, kind) where status = 'pending';

-- Свой employee_id — нужен и в политиках, и в проверках ниже.
create or replace function public.my_employee_id()
returns bigint language sql stable security definer set search_path = public as $$
  select p.employee_id from profiles p where p.user_id = auth.uid();
$$;

alter table public.shift_requests enable row level security;

-- Видят: автор, названный в заявке напарник (его смена тоже меняется),
-- ответственный за цех автора и владелец.
drop policy if exists shift_requests_select on public.shift_requests;
create policy shift_requests_select on public.shift_requests for select to authenticated
  using (
    employee_id = public.my_employee_id()
    or partner_id = public.my_employee_id()
    or public.can_edit_schedule_of(employee_id)
    or exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'boss')
  );

-- Подать заявку можно только от своего имени и только необработанной.
drop policy if exists shift_requests_insert on public.shift_requests;
create policy shift_requests_insert on public.shift_requests for insert to authenticated
  with check (employee_id = public.my_employee_id() and status = 'pending');

-- Строку трогают двое: ответственный (решение) и автор (отзыв). Что именно им
-- позволено менять — разбирает триггер ниже.
drop policy if exists shift_requests_update on public.shift_requests;
create policy shift_requests_update on public.shift_requests for update to authenticated
  using (public.can_edit_schedule_of(employee_id) or employee_id = public.my_employee_id());

-- ===== Решение по заявке =====
-- Здесь же и применение: одобрили — график переписан в этой же транзакции.
-- Разваливаться на «одобрено, но график прежний» этой паре нельзя.
create or replace function public.shift_requests_decide()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mine       boolean := OLD.employee_id = public.my_employee_id();
  v_privileged boolean := exists (select 1 from profiles p
                                   where p.user_id = auth.uid() and p.role = any(array['admin','manager']));
  v_a_row  bigint;
  v_b_row  bigint;
  v_a_name text;
  v_b_name text;
begin
  if OLD.status <> 'pending' then
    raise exception 'Заявка уже обработана (%)', OLD.status;
  end if;

  -- Содержание заявки после подачи неприкосновенно: решение — это только
  -- статус и подпись. Иначе одобряющий мог бы подменить день или напарника.
  NEW.kind          := OLD.kind;
  NEW.filial        := OLD.filial;
  NEW.department    := OLD.department;
  NEW.employee_id   := OLD.employee_id;
  NEW.employee_name := OLD.employee_name;
  NEW.date          := OLD.date;
  NEW.swap_kind     := OLD.swap_kind;
  NEW.partner_id    := OLD.partner_id;
  NEW.partner_name  := OLD.partner_name;
  NEW.partner_date  := OLD.partner_date;
  NEW.late_minutes  := OLD.late_minutes;
  NEW.reason        := OLD.reason;
  NEW.created_at    := OLD.created_at;

  -- Автор вправе только отозвать заявку, пока её не рассмотрели
  if NEW.status = 'cancelled' then
    if not v_mine then raise exception 'Отозвать заявку может только её автор'; end if;
    NEW.decided_at := now();
    return NEW;
  end if;

  if not public.can_edit_schedule_of(OLD.employee_id) then
    raise exception 'Нет прав решать по этой заявке';
  end if;
  -- Старший цеха ведёт свой цех, но не самого себя: свою заявку он отправляет
  -- наверх. Иначе право на замену превращается в право менять себе график.
  if v_mine and not v_privileged then
    raise exception 'Свою заявку утверждает руководство';
  end if;

  NEW.decided_by   := auth.uid();
  NEW.decided_at   := now();
  NEW.decided_by_name := coalesce(
    (select p.name from profiles p where p.user_id = auth.uid()), NEW.decided_by_name);

  if NEW.status <> 'approved' then
    return NEW;                       -- отказ: график не трогаем
  end if;

  -- ===== Одобрено: правим график =====
  if OLD.kind = 'swap' then
    select s.id into v_a_row from schedules s
     where s.employee_id = OLD.employee_id and s.date = OLD.date
       and coalesce(s.is_day_off, false) = false
     order by s.id limit 1;
    if v_a_row is null then
      raise exception 'В графике нет смены % на %', coalesce(OLD.employee_name,''), to_char(OLD.date,'DD.MM');
    end if;

    select e.name into v_a_name from employees e where e.id = OLD.employee_id;
    select e.name into v_b_name from employees e where e.id = OLD.partner_id;

    if OLD.swap_kind = 'exchange' then
      select s.id into v_b_row from schedules s
       where s.employee_id = OLD.partner_id and s.date = OLD.partner_date
         and coalesce(s.is_day_off, false) = false
       order by s.id limit 1;
      if v_b_row is null then
        raise exception 'В графике нет смены % на %', coalesce(OLD.partner_name,''), to_char(OLD.partner_date,'DD.MM');
      end if;
      -- Меняем владельцев строк, а не даты: время смены принадлежит дню, а не
      -- человеку. Кто в этот день выходит — то и меняется.
      update schedules set employee_id = OLD.partner_id,  employee_name = coalesce(v_b_name, OLD.partner_name)  where id = v_a_row;
      update schedules set employee_id = OLD.employee_id, employee_name = coalesce(v_a_name, OLD.employee_name) where id = v_b_row;
    else
      -- Подмена: смена целиком переходит напарнику. Двух смен в один день у
      -- него быть не должно — это не подмена, а двойной выход.
      if exists (select 1 from schedules s
                  where s.employee_id = OLD.partner_id and s.date = OLD.date
                    and coalesce(s.is_day_off, false) = false) then
        raise exception 'У % уже есть смена %', coalesce(OLD.partner_name,''), to_char(OLD.date,'DD.MM');
      end if;
      update schedules set employee_id = OLD.partner_id, employee_name = coalesce(v_b_name, OLD.partner_name) where id = v_a_row;
    end if;

  elsif OLD.kind = 'late' then
    -- Обычный случай — заявку одобрили до прихода, и штраф просто не начислится
    -- (см. attendance_guard). Но одобрить могут и после того, как человек уже
    -- отметился: тогда прощаем задним числом здесь.
    --
    -- Отметку правит триггер attendance_guard, и рядовому пользователю он
    -- возвращает прежние значения — иначе сотрудник обнулял бы себе штраф сам.
    -- Старший цеха рядовой и есть, поэтому на время этой правки поднимаем флаг:
    -- пишет не человек, а одобренная заявка.
    perform set_config('slon.excuse_late', '1', true);
    update attendance
       set penalty = 0, late_excused = true
     where employee_id = OLD.employee_id and date = OLD.date;
    perform set_config('slon.excuse_late', '', true);
  end if;

  return NEW;
end $$;

drop trigger if exists shift_requests_decide_trg on public.shift_requests;
create trigger shift_requests_decide_trg
  before update on public.shift_requests
  for each row execute function public.shift_requests_decide();

-- ===== Отметка прихода знает о прощённых опозданиях =====
-- Факт опоздания остаётся (is_late, late_minutes — как было), обнуляется только
-- штраф, а признак late_excused отличает прощённое от обычного: по нему бонус
-- официантов не снимает дисциплинарный балл, а в табеле видно, что человек
-- предупредил.
alter table public.attendance add column if not exists late_excused boolean not null default false;

create or replace function public.attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_local  timestamp := (now() at time zone 'Asia/Tashkent');
  v_time   text      := to_char((now() at time zone 'Asia/Tashkent'), 'HH24:MI');
  v_min    int;
  v_date   date;
  v_start  text;
  v_late   int := 0;
  v_pen    int := 0;
  v_excused boolean := false;
  v_privileged boolean;
begin
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  if TG_OP = 'INSERT' then
    v_date := public.business_today();   -- смена до 8 утра относится ко вчерашнему дню
    NEW.date := v_date;
    NEW.check_in_time := v_time;

    -- Смена сотрудника на этот кассовый день. Выходной не берём: на него отметку
    -- и не предлагают, а shift_start там пустой — без этого условия пустое время
    -- превратилось бы в опоздание на весь день.
    select s.shift_start into v_start
      from schedules s
     where s.employee_id = NEW.employee_id
       and s.date = v_date
       and coalesce(s.is_day_off, false) = false
       and s.shift_start is not null
     limit 1;

    if v_start is not null then
      v_late := greatest(0, v_min - (split_part(v_start, ':', 1)::int * 60 + split_part(v_start, ':', 2)::int));
      v_pen := case when v_late <= 5  then 0
                    when v_late <= 15 then 30000
                    when v_late <= 60 then 50000
                    else 100000 end;
    end if;

    -- Предупредил заранее и заявку одобрили — опоздание фиксируем, штраф нет.
    if v_pen > 0 and exists (
         select 1 from shift_requests r
          where r.kind = 'late' and r.status = 'approved'
            and r.employee_id = NEW.employee_id and r.date = v_date) then
      v_pen := 0;
      v_excused := true;
    end if;

    NEW.late_minutes := v_late;
    NEW.penalty      := v_pen;
    NEW.is_late      := v_late > 5;
    NEW.late_excused := v_excused;
    return NEW;
  end if;

  -- UPDATE
  -- Прощение штрафа по одобренной заявке приходит из shift_requests_decide и
  -- проходит без проверки прав: решение уже принято тем, кто вправе его принять.
  if coalesce(current_setting('slon.excuse_late', true), '') = '1' then
    return NEW;
  end if;

  select exists (select 1 from profiles p
                  where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
    into v_privileged;
  if v_privileged then
    return NEW;                          -- руководство правит запись как раньше
  end if;

  NEW.employee_id   := OLD.employee_id;
  NEW.date          := OLD.date;
  NEW.check_in_time := OLD.check_in_time;
  NEW.is_late       := OLD.is_late;
  NEW.late_minutes  := OLD.late_minutes;
  NEW.penalty       := OLD.penalty;
  NEW.late_excused  := OLD.late_excused;
  NEW.checkin_video := OLD.checkin_video;
  NEW.checkin_geo   := OLD.checkin_geo;

  -- Единственное, что сотрудник вправе изменить — закрыть смену, и то один раз
  if OLD.check_out_time is null and NEW.check_out_time is not null then
    NEW.check_out_time := v_time;
  else
    NEW.check_out_time := OLD.check_out_time;
  end if;
  return NEW;
end $$;

drop trigger if exists attendance_guard_trg on public.attendance;
create trigger attendance_guard_trg
  before insert or update on public.attendance
  for each row execute function public.attendance_guard();
