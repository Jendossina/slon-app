-- ФИКС: проверка просроченных чек-листов падала на каждом прогоне, где надо было
-- определить ответственного.
--
-- Причина: schedules.shift_start — text ('11:00'), а checklist_templates.owner_shift_start
-- — time. coalesce() двух разных типов = ошибка «COALESCE types time without time zone
-- and text cannot be matched». 42 из 101 запуска cron падали, невыполнения не писались,
-- уведомления не уходили — и всё это молча.
--
-- Заодно: ошибка в одном шаблоне больше не роняет весь проход по остальным.

-- Безопасное приведение времени из текста: 'весь день', '' и NULL дают NULL, а не ошибку.
create or replace function public.safe_time(p text)
returns time language sql immutable as $$
  select case when p ~ '^\d{1,2}:\d{2}(:\d{2})?$' then p::time end;
$$;

create or replace function public.checklist_check_overdue()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamp; v_bday date; v_found integer := 0;
  t record; f text; v_deadline timestamp;
  v_emp_ids bigint[]; v_emp_names text; v_owner_shift time;
  v_miss_id bigint; v_points integer; v_notified integer;
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
    v_deadline := (v_bday + (case when t.due_time < time '08:00' then 1 else 0 end))
                  + t.due_time + interval '1 hour';
    continue when v_now < v_deadline;
    continue when v_now > v_deadline + interval '3 hours';

    foreach f in array array['istikbol','chekhov'] loop
      begin  -- сбой на одном чек-листе не должен ронять проверку остальных
        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        continue when exists (
          select 1 from checklist_misses m
           where m.template_id = t.id and m.filial = f and m.date = v_bday);

        -- Ответственный: смена, начинающаяся в owner_shift_start; если такой нет —
        -- самая поздняя смена дня (это и есть тот, кто закрывает).
        select coalesce(t.owner_shift_start, (
                 select max(safe_time(s.shift_start)) from schedules s
                  join employees e on e.id = s.employee_id
                 where s.date = v_bday and s.filial = f and not s.is_day_off
                   and e.department = t.department))
          into v_owner_shift;

        select array_agg(e.id), string_agg(e.name, ', ')
          into v_emp_ids, v_emp_names
          from schedules s join employees e on e.id = s.employee_id
         where s.date = v_bday and s.filial = f and not s.is_day_off
           and e.department = t.department and safe_time(s.shift_start) = v_owner_shift;

        if v_emp_ids is null then
          select array_agg(e.id), string_agg(e.name, ', ')
            into v_emp_ids, v_emp_names
            from schedules s join employees e on e.id = s.employee_id
           where s.date = v_bday and s.filial = f and not s.is_day_off and e.department = t.department;
        end if;

        continue when v_emp_ids is null;   -- отдел сегодня не работает

        v_points := 0; v_notified := 0;

        insert into checklist_misses (template_id, template_name, department, filial, date, due_time, employee_ids, employee_names)
        values (t.id, t.name, t.department, f, v_bday, t.due_time, v_emp_ids, v_emp_names)
        returning id into v_miss_id;

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
      exception when others then
        raise warning 'checklist_check_overdue: шаблон % филиал % — %', t.id, f, sqlerrm;
      end;
    end loop;
  end loop;

  return v_found;
end $$;

revoke all on function public.checklist_check_overdue() from public, anon;
grant execute on function public.checklist_check_overdue() to authenticated;
