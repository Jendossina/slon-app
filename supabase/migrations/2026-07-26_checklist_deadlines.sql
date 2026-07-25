-- Сроки сдачи чек-листов: если через час после назначенного времени чек-лист
-- не сдан — фиксируем невыполнение, шлём уведомления и (официантам) ставим
-- штрафной балл в блок «Дисциплина».
--
-- Проверка крутится в самой базе (pg_cron каждые 15 минут) и дёргает уже
-- существующую edge-функцию send-telegram через pg_net — новых секретов не нужно.

-- ===== настройки у шаблона чек-листа =====
alter table public.checklist_templates add column if not exists due_time time;           -- до какого времени сдать
alter table public.checklist_templates add column if not exists owner_shift_start time;  -- чья смена отвечает (кто выходит в это время)

comment on column public.checklist_templates.due_time is 'Назначенное время сдачи. Пусто = срок не контролируется.';
comment on column public.checklist_templates.owner_shift_start is 'Ответственный — сотрудник отдела, чья смена начинается в это время. Пусто = вся смена отдела.';

-- ===== журнал невыполнений =====
create table if not exists public.checklist_misses (
  id             bigserial primary key,
  template_id    bigint not null references public.checklist_templates(id) on delete cascade,
  template_name  text,
  department     text,
  filial         text not null,
  date           date not null,                 -- кассовый день
  due_time       time not null,
  employee_ids   bigint[] not null default '{}',
  employee_names text,
  points_given   integer not null default 0,    -- сколько штрафных баллов проставлено
  notified       integer not null default 0,    -- скольким ушло уведомление
  created_at     timestamptz not null default now(),
  unique (template_id, filial, date)            -- одно невыполнение на чек-лист в день
);
create index if not exists checklist_misses_date_idx on public.checklist_misses (filial, date);

alter table public.checklist_misses enable row level security;

drop policy if exists checklist_misses_select on public.checklist_misses;
create policy checklist_misses_select on public.checklist_misses for select to authenticated using (true);

drop policy if exists checklist_misses_delete on public.checklist_misses;
create policy checklist_misses_delete on public.checklist_misses for delete to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

-- ===== дефолтные сроки =====
-- Проставлены по названиям смен; управляющий правит их в приложении.
-- «Второй официант (13:00/15:00)» намеренно оставлен пустым — время неоднозначное.
update public.checklist_templates set due_time = '11:00', owner_shift_start = '11:00' where type = 'open';
update public.checklist_templates set due_time = '03:00', owner_shift_start = '18:00' where type = 'close';
update public.checklist_templates set due_time = '11:30', owner_shift_start = '11:30' where type = 'bar_open';
update public.checklist_templates set due_time = '02:00', owner_shift_start = '15:00' where type = 'bar_close';
update public.checklist_templates set due_time = '11:30', owner_shift_start = '11:30' where type = 'hookah_open';
update public.checklist_templates set due_time = '03:00', owner_shift_start = '14:45' where type = 'hookah_close';
update public.checklist_templates set due_time = '11:00', owner_shift_start = '11:00' where type = 'kitchen_open';
update public.checklist_templates set due_time = '02:30', owner_shift_start = '14:30' where type = 'kitchen_close';

-- ===== проверка просроченных =====
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.checklist_check_overdue()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamp; v_bday date; v_found integer := 0;
  t record; f text; v_deadline timestamp;
  v_emp_ids bigint[]; v_emp_names text; v_owner_shift time;
  v_miss_id bigint; v_points integer; v_notified integer;
  v_text text; r record;
  -- публикуемый ключ проекта, он же лежит открытым в js/core.js
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_now  := now() at time zone 'Asia/Tashkent';
  v_bday := business_today();

  for t in
    select id, name, type, department, due_time, owner_shift_start
      from checklist_templates
     where is_active and due_time is not null
  loop
    -- Срок до 08:00 — это ночь ПОСЛЕ кассового дня (закрытие в 03:00 и т.п.)
    v_deadline := (v_bday + (case when t.due_time < time '08:00' then 1 else 0 end))
                  + t.due_time + interval '1 hour';
    continue when v_now < v_deadline;
    -- Не наказываем задним числом: если срок прошёл больше 3 часов назад, значит
    -- либо правило включили уже после него, либо проверка простаивала. Молчим.
    continue when v_now > v_deadline + interval '3 hours';

    foreach f in array array['istikbol','chekhov'] loop
      -- чек-лист сдан — пропускаем
      continue when exists (
        select 1 from checklist_logs l
         where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

      -- уже зафиксировано
      continue when exists (
        select 1 from checklist_misses m
         where m.template_id = t.id and m.filial = f and m.date = v_bday);

      -- кто отвечает: смена, начинающаяся в owner_shift_start; если такой нет —
      -- самая поздняя смена дня (для закрытия это верно); если смен нет вовсе — пропускаем
      select coalesce(t.owner_shift_start, (
               select max(s.shift_start) from schedules s
                join employees e on e.id = s.employee_id
               where s.date = v_bday and s.filial = f and not s.is_day_off and e.department = t.department))
        into v_owner_shift;

      select array_agg(e.id), string_agg(e.name, ', ')
        into v_emp_ids, v_emp_names
        from schedules s join employees e on e.id = s.employee_id
       where s.date = v_bday and s.filial = f and not s.is_day_off
         and e.department = t.department and s.shift_start = v_owner_shift;

      if v_emp_ids is null then
        -- никто из отдела не совпал по смене — берём всех, кто вообще в смене
        select array_agg(e.id), string_agg(e.name, ', ')
          into v_emp_ids, v_emp_names
          from schedules s join employees e on e.id = s.employee_id
         where s.date = v_bday and s.filial = f and not s.is_day_off and e.department = t.department;
      end if;

      continue when v_emp_ids is null;  -- отдел сегодня не работает — некому сдавать

      v_points := 0; v_notified := 0;

      insert into checklist_misses (template_id, template_name, department, filial, date, due_time, employee_ids, employee_names)
      values (t.id, t.name, t.department, f, v_bday, t.due_time, v_emp_ids, v_emp_names)
      returning id into v_miss_id;

      -- Штрафной балл — только официантам (блок «Дисциплина» в процентах)
      if t.department = 'Официанты' then
        insert into waiter_points (employee_id, employee_name, filial, date, category, points, reason, note, created_by_name)
        select e.id, e.name, f, v_bday, 'discipline', 1, 'checklist',
               t.name || ' — срок до ' || to_char(t.due_time,'HH24:MI'), 'Автоматически'
          from employees e where e.id = any(v_emp_ids);
        get diagnostics v_points = row_count;
      end if;

      v_text := '⚠️ <b>Чек-лист не сдан</b>' || chr(10)
             || t.name || ' · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || chr(10)
             || 'Срок был до ' || to_char(t.due_time,'HH24:MI') || ', прошёл час.' || chr(10)
             || 'Ответственные: ' || coalesce(v_emp_names,'—')
             || (case when t.department = 'Официанты' then chr(10) || 'Зафиксировано невыполнение, поставлен штрафной балл.'
                      else chr(10) || 'Зафиксировано невыполнение.' end);

      -- сотрудникам смены + руководству (admin/manager), у кого привязан телеграм
      for r in
        select distinct p.telegram_id
          from profiles p
         where p.telegram_id is not null
           and (p.employee_id = any(v_emp_ids) or p.role = any(array['admin','manager']))
      loop
        perform net.http_post(
          url := v_fn,
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
        v_notified := v_notified + 1;
      end loop;

      update checklist_misses set points_given = v_points, notified = v_notified where id = v_miss_id;
      v_found := v_found + 1;
    end loop;
  end loop;

  return v_found;
end $$;

revoke all on function public.checklist_check_overdue() from public, anon;
grant execute on function public.checklist_check_overdue() to authenticated;

-- Каждые 15 минут. Пересоздаём задание идемпотентно.
select cron.unschedule('checklist-overdue') where exists (select 1 from cron.job where jobname = 'checklist-overdue');
select cron.schedule('checklist-overdue', '*/15 * * * *', $$ select public.checklist_check_overdue(); $$);
