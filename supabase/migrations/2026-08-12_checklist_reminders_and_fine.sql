-- Чек-листы: напоминания ДО срока и денежный штраф за невыполнение.
--
-- Что было. Проверка checklist_check_overdue() через час после due_time писала
-- невыполнение и слала уведомление — то есть первое, что человек видел, было
-- «не сдал, зафиксировано». Никаких предупреждений заранее. Санкция была одна:
-- штрафной балл дисциплины, и только официантам — у остальных отделов нет
-- процентной премии, на которую балл влияет, так что для повара, бармена и
-- кальянщика невыполнение не стоило ничего.
--
-- Решения владельца (12.08.2026):
--   1. Напоминания двух видов. Чек-листы ОТКРЫТИЯ смены напоминаем через 30
--      минут после того, как ответственный отметил приход, — он точно на месте
--      и может пойти и сдать. Чек-листы ЗАКРЫТИЯ за полсуток вперёд напоминать
--      бессмысленно (пришёл в 18:00, срок в 03:00 — забудет), их напоминаем за
--      час до срока.
--   2. Штраф деньгами — 50 000 сум, всем отделам. Официантам штрафной балл
--      остаётся сверх этого.
--   3. Платит ОДИН человек, а не весь цех. Причина в цифрах: ответственный
--      ищется по точному совпадению начала смены с owner_shift_start шаблона, и
--      когда график написан другими временами (1 и 8 августа — ни одного
--      совпадения), срабатывает запасная ветка «отвечают все в смене». Со
--      штрафным баллом это терпимо, а с деньгами сдвиг графика на полчаса
--      умножал бы штраф на число людей в цехе: 8 августа вышло бы 1 000 000 сум
--      за день. Невыполнение и уведомление по-прежнему называют всю смену —
--      деньги списываются с одного.
--
-- Кто платит: среди ответственных берём того, чья смена ближе всего к сроку
-- сдачи (для закрытия это тот, кто закрывает, для открытия — кто открывает).
-- Из них предпочитаем отметившихся: штраф должен лечь на того, кто реально был
-- на смене. Никто не отметился — не списываем ни с кого, только фиксируем.
--
-- Открытие от закрытия отличаем не по названию, а по расстоянию от начала смены
-- ответственного до срока: у «открытия» это часы, у «закрытия» — полсуток.
-- Порог 3 часа разделяет все девять нынешних шаблонов без исключений.

-- ===== 1. Общий помощник: момент времени в кассовых сутках =====
-- Время до 08:00 относится к следующей календарной дате: смена 12:00–03:00 —
-- один кассовый день. Правило было размазано по функциям копипастой, теперь одно.
create or replace function public.bday_ts(p_bday date, p_time time)
returns timestamp language sql immutable as $$
  select (p_bday + (case when p_time < time '08:00' then 1 else 0 end)) + p_time;
$$;

-- ===== 2. Кто отвечает за чек-лист =====
-- Ровно та логика, что жила внутри checklist_check_overdue(): сотрудник отдела
-- со сменой в owner_shift_start → если таких нет, самая поздняя смена дня (это и
-- есть «кто закрывает») → если и этого нет, все в смене. Вынесено отдельно,
-- чтобы напоминания и проверка просрочки не разъехались.
create or replace function public.checklist_owners(
  p_department text, p_owner_shift time, p_filial text, p_bday date,
  out employee_ids bigint[], out employee_names text)
language plpgsql stable security definer set search_path = public as $$
declare v_shift time;
begin
  select coalesce(p_owner_shift, (
           select max(safe_time(s.shift_start))
             from schedules s join employees e on e.id = s.employee_id
            where s.date = p_bday and s.filial = p_filial and not s.is_day_off
              and e.department = p_department))
    into v_shift;

  select array_agg(e.id), string_agg(e.name, ', ')
    into employee_ids, employee_names
    from schedules s join employees e on e.id = s.employee_id
   where s.date = p_bday and s.filial = p_filial and not s.is_day_off
     and e.department = p_department and safe_time(s.shift_start) = v_shift;

  if employee_ids is null then
    select array_agg(e.id), string_agg(e.name, ', ')
      into employee_ids, employee_names
      from schedules s join employees e on e.id = s.employee_id
     where s.date = p_bday and s.filial = p_filial and not s.is_day_off
       and e.department = p_department;
  end if;
end $$;

-- ===== 3. Куда кладём деньги =====
-- Штраф прибавляется к attendance.penalty того же кассового дня. Это
-- единственное поле, которое УЖЕ вычитают все расчёты: месячная ведомость
-- (hr.js openPayroll), дневная (openDailyPayroll), карточка «Моя зарплата» у
-- сотрудника и три сводки в дашборде. Класть штраф в premiums нельзя — их
-- читает только дневная ведомость, в остальных местах вычет бы потерялся.
--
-- Сколько именно списали с каждого — храним отдельно: прощение опоздавшего
-- чек-листа должно вернуть ровно эту сумму, не задев штраф за опоздание.
create table if not exists public.checklist_penalties (
  id          bigserial primary key,
  miss_id     bigint not null references public.checklist_misses(id) on delete cascade,
  employee_id bigint not null,
  amount      integer not null,
  created_at  timestamptz not null default now()
);
create index if not exists checklist_penalties_miss_idx on public.checklist_penalties (miss_id);

alter table public.checklist_misses add column if not exists penalty_given integer not null default 0;

alter table public.checklist_penalties enable row level security;
drop policy if exists checklist_penalties_select on public.checklist_penalties;
create policy checklist_penalties_select on public.checklist_penalties for select to authenticated using (true);

-- ===== 4. Триггер отметки прихода пропускает серверные правки =====
-- attendance_guard() на UPDATE возвращает penalty к прежнему значению всем,
-- кроме управляющего и менеджера. Проверка чек-листов крутится в pg_cron, где
-- auth.uid() пуст, — без этой поправки начисленный штраф откатывался бы тут же.
-- Пустой auth.uid() снаружи недостижим: политика attendance_update требует
-- совпадения employee_id с профилем по auth.uid() либо роли admin/manager, и с
-- null не выполняется ни то, ни другое. То есть «uid пуст» = запрос изнутри базы.
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
  v_privileged boolean;
begin
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  if TG_OP = 'INSERT' then
    v_date := public.business_today();   -- смена до 8 утра относится ко вчерашнему дню
    NEW.date := v_date;
    NEW.check_in_time := v_time;

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

    NEW.late_minutes := v_late;
    NEW.penalty      := v_pen;
    NEW.is_late      := v_pen > 0;
    return NEW;
  end if;

  -- UPDATE
  if auth.uid() is null then
    return NEW;                          -- правка изнутри базы (cron, миграция)
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
  NEW.checkin_geo   := OLD.checkin_geo;

  -- Видео можно только ДОСЛАТЬ: пока его нет — принимаем, дальше не трогаем
  if OLD.checkin_video is null then
    NEW.checkin_video := NEW.checkin_video;
  else
    NEW.checkin_video := OLD.checkin_video;
  end if;

  -- Единственное, что сотрудник вправе изменить помимо этого — закрыть смену
  if OLD.check_out_time is null and NEW.check_out_time is not null then
    NEW.check_out_time := v_time;
  else
    NEW.check_out_time := OLD.check_out_time;
  end if;
  return NEW;
end $$;

-- ===== 5. Проверка просрочки: та же, плюс деньги =====
create or replace function public.checklist_check_overdue()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  -- Штраф за несданный чек-лист. Решение владельца 12.08.2026: столько же,
  -- сколько за опоздание до часа. Живёт ТОЛЬКО здесь, как и лестница опозданий
  -- в attendance_guard() — чтобы сумма не разъехалась по двум местам.
  v_fine constant integer := 50000;
  v_now timestamp; v_bday date; v_found integer := 0;
  t record; f text; v_deadline timestamp; v_own record; a record;
  v_miss_id bigint; v_points integer; v_notified integer; v_fined integer; v_nopay integer;
  v_text text; r record;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_now  := now() at time zone 'Asia/Tashkent';
  v_bday := business_today();

  for t in
    select id, name, type, department, due_time, owner_shift_start
      from checklist_templates
     where is_active and due_time is not null
  loop
    v_deadline := bday_ts(v_bday, t.due_time) + interval '1 hour';
    continue when v_now < v_deadline;
    -- Окно 3 часа: срок прошёл давно — молчим. Иначе включение проверки задним
    -- числом (и любой простой cron) выкатит пачку наказаний за старые дедлайны.
    continue when v_now > v_deadline + interval '3 hours';

    foreach f in array array['istikbol','chekhov'] loop
      begin  -- сбой на одном чек-листе не должен ронять проверку остальных
        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        continue when exists (
          select 1 from checklist_misses m
           where m.template_id = t.id and m.filial = f and m.date = v_bday);

        select * from checklist_owners(t.department, t.owner_shift_start, f, v_bday) into v_own;
        continue when v_own.employee_ids is null;   -- отдел сегодня не работает

        v_points := 0; v_notified := 0; v_fined := 0; v_nopay := 0;

        insert into checklist_misses (template_id, template_name, department, filial, date, due_time, employee_ids, employee_names)
        values (t.id, t.name, t.department, f, v_bday, t.due_time, v_own.employee_ids, v_own.employee_names)
        returning id into v_miss_id;

        -- Кто платит (правило — в шапке файла). Деньги вешаем на отметку прихода
        -- этого дня: attendance.penalty вычитают все расчёты зарплаты.
        select att.id as att_id, e.id as emp_id, e.name as emp_name
          into a
          from schedules s
          join employees e on e.id = s.employee_id
          left join attendance att
            on att.employee_id = s.employee_id and att.date = v_bday and att.filial = f
         where s.date = v_bday and s.filial = f and s.employee_id = any(v_own.employee_ids)
         order by (att.id is null),                                  -- сперва те, кто отметился
                  abs(extract(epoch from (bday_ts(v_bday, safe_time(s.shift_start))
                                        - bday_ts(v_bday, t.due_time)))),  -- чья смена ближе к сроку
                  att.check_in_time nulls last,                      -- кто раньше пришёл
                  s.employee_id                                      -- на всякий случай — устойчиво
         limit 1;

        if a.att_id is not null then
          update attendance set penalty = coalesce(penalty, 0) + v_fine where id = a.att_id;
          insert into checklist_penalties (miss_id, employee_id, amount) values (v_miss_id, a.emp_id, v_fine);
          v_fined := v_fine;
        else
          v_nopay := 1;   -- никто из ответственных не отметил приход
        end if;

        if t.department = 'Официанты' then
          insert into waiter_points (employee_id, employee_name, filial, date, category, points, reason, note, created_by_name)
          select e.id, e.name, f, v_bday, 'discipline', 1, 'checklist',
                 t.name || ' — срок до ' || to_char(t.due_time,'HH24:MI'), 'Автоматически'
            from employees e where e.id = any(v_own.employee_ids);
          get diagnostics v_points = row_count;
        end if;

        v_text := '⚠️ <b>Чек-лист не сдан</b>' || chr(10)
               || t.name || ' · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || chr(10)
               || 'Срок был до ' || to_char(t.due_time,'HH24:MI') || ', прошёл час.' || chr(10)
               || 'Ответственные: ' || coalesce(v_own.employee_names,'—') || chr(10)
               || 'Зафиксировано невыполнение.'
               || (case when v_fined > 0
                        then chr(10) || 'Штраф ' || replace(to_char(v_fine, 'FM999,999'), ',', ' ') || ' сум — '
                             || coalesce(a.emp_name, '—') || ', вычтется из смены.'
                        else '' end)
               || (case when v_nopay > 0
                        then chr(10) || 'Штраф не списан: никто из ответственных не отметил приход.'
                        else '' end)
               || (case when t.department = 'Официанты' then chr(10) || 'Официантам дополнительно штрафной балл.' else '' end)
               || chr(10) || 'Сдадите в ближайшие 2 часа — снимем и штраф, и невыполнение.';

        for r in
          select distinct p.telegram_id
            from profiles p
           where p.telegram_id is not null
             and (p.employee_id = any(v_own.employee_ids) or p.role = any(array['admin','manager']))
        loop
          perform net.http_post(
            url := v_fn,
            headers := '{"Content-Type":"application/json"}'::jsonb,
            body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
          v_notified := v_notified + 1;
        end loop;

        update checklist_misses
           set points_given = v_points, notified = v_notified, penalty_given = v_fined
         where id = v_miss_id;
        v_found := v_found + 1;
      exception when others then
        raise warning 'checklist_check_overdue: шаблон % филиал % — %', t.id, f, sqlerrm;
      end;
    end loop;
  end loop;

  return v_found;
end $$;

-- ===== 6. Прощение опоздавших: возвращаем и балл, и деньги =====
create or replace function public.checklist_forgive_late(p_grace interval default interval '2 hours')
returns integer language plpgsql security definer set search_path = public as $$
declare m record; cp record; v_done timestamp; v_due timestamp; v_freed integer := 0;
begin
  for m in
    select id, template_id, filial, date, due_time, employee_ids
      from checklist_misses
     where date >= business_today() - 3
  loop
    select (l.completed_at at time zone 'Asia/Tashkent') into v_done
      from checklist_logs l
     where l.template_id = m.template_id and l.date = m.date and l.filial = m.filial and l.completed;
    continue when v_done is null;

    v_due := bday_ts(m.date, m.due_time);
    continue when v_done > v_due + p_grace;

    -- уложились: возвращаем деньги ровно в тех суммах, что списали, — штраф за
    -- опоздание на смену при этом остаётся нетронутым
    for cp in select employee_id, amount from checklist_penalties where miss_id = m.id loop
      update attendance
         set penalty = greatest(0, coalesce(penalty, 0) - cp.amount)
       where date = m.date and filial = m.filial and employee_id = cp.employee_id;
    end loop;

    delete from waiter_points
     where reason = 'checklist' and date = m.date and filial = m.filial
       and created_by_name = 'Автоматически'
       and employee_id = any(m.employee_ids);
    delete from checklist_misses where id = m.id;   -- checklist_penalties уйдут каскадом
    v_freed := v_freed + 1;
  end loop;
  return v_freed;
end $$;

-- ===== 7. Напоминания до срока =====
create table if not exists public.checklist_reminders (
  id          bigserial primary key,
  template_id bigint not null,
  filial      text   not null,
  date        date   not null,
  kind        text   not null check (kind in ('after_checkin','before_due')),
  sent        integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (template_id, filial, date, kind)
);

alter table public.checklist_reminders enable row level security;
drop policy if exists checklist_reminders_select on public.checklist_reminders;
create policy checklist_reminders_select on public.checklist_reminders for select to authenticated using (true);

create or replace function public.checklist_remind()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_fine constant integer := 50000;
  v_now timestamp; v_bday date; v_sent integer := 0;
  t record; f text; v_due timestamp; v_shift timestamp; v_own record;
  v_kind text; v_late boolean; v_text text; r record; v_n integer;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_now  := now() at time zone 'Asia/Tashkent';
  v_bday := business_today();

  for t in
    select id, name, department, due_time, owner_shift_start
      from checklist_templates
     where is_active and due_time is not null
  loop
    v_due := bday_ts(v_bday, t.due_time);
    -- После этого момента невыполнение уже зафиксировано checklist_check_overdue():
    -- предупреждать поздно, человек и так получил сообщение.
    continue when v_now >= v_due + interval '1 hour';

    foreach f in array array['istikbol','chekhov'] loop
      begin
        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        select * from checklist_owners(t.department, t.owner_shift_start, f, v_bday) into v_own;
        continue when v_own.employee_ids is null;

        -- Открытие смены или закрытие: см. шапку файла
        v_shift := v_bday + coalesce(t.owner_shift_start, time '00:00');
        v_kind := case when v_due - v_shift <= interval '3 hours' then 'after_checkin' else 'before_due' end;

        continue when exists (
          select 1 from checklist_reminders x
           where x.template_id = t.id and x.filial = f and x.date = v_bday and x.kind = v_kind);

        if v_kind = 'after_checkin' then
          -- ждём, пока ответственный отметит приход, и даём ему полчаса осмотреться
          continue when not exists (
            select 1 from attendance att
             where att.date = v_bday and att.filial = f
               and att.employee_id = any(v_own.employee_ids)
               and att.check_in_time is not null
               and v_now >= bday_ts(v_bday, safe_time(att.check_in_time)) + interval '30 minutes');
        else
          continue when v_due - v_now > interval '1 hour';
        end if;

        v_late := v_now >= v_due;
        v_text := '🔔 <b>Не забудь чек-лист</b>' || chr(10)
               || t.name || ' · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || chr(10)
               || (case when v_late
                        then 'Срок был до ' || to_char(t.due_time,'HH24:MI') || ' — уже прошёл.'
                        else 'Срок — до ' || to_char(t.due_time,'HH24:MI') || '.' end) || chr(10)
               || 'Не сдашь до ' || to_char(v_due + interval '1 hour', 'HH24:MI')
               || ' — невыполнение и штраф ' || replace(to_char(v_fine, 'FM999,999'), ',', ' ') || ' сум.';

        v_n := 0;
        for r in
          select distinct p.telegram_id
            from profiles p
           where p.telegram_id is not null and p.employee_id = any(v_own.employee_ids)
        loop
          perform net.http_post(
            url := v_fn,
            headers := '{"Content-Type":"application/json"}'::jsonb,
            body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
          v_n := v_n + 1;
        end loop;

        -- Запись ставим в любом случае, даже если Telegram ни у кого не привязан:
        -- иначе cron будет молотить одно и то же каждые пять минут.
        insert into checklist_reminders (template_id, filial, date, kind, sent)
        values (t.id, f, v_bday, v_kind, v_n);
        v_sent := v_sent + 1;
      exception when others then
        raise warning 'checklist_remind: шаблон % филиал % — %', t.id, f, sqlerrm;
      end;
    end loop;
  end loop;

  return v_sent;
end $$;

-- Каждые 5 минут: «через полчаса после прихода» должно быть похоже на полчаса,
-- а не на сорок пять минут, как вышло бы на общем пятнадцатиминутном такте.
select cron.unschedule('checklist-remind') where exists (select 1 from cron.job where jobname = 'checklist-remind');
select cron.schedule('checklist-remind', '*/5 * * * *', 'select public.checklist_remind();');
