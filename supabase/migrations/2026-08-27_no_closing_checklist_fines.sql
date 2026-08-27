-- Чек-листы ЗАКРЫТИЯ больше не наказывают: ни штрафа, ни балла, ни записи о
-- невыполнении. Остаётся только напоминание — контроль закрытия владелец
-- оставил за менеджерами (решение 27.08.2026).
--
-- Почему. Срок закрытия считается от конца смены ответственного в графике
-- (checklist_due_effective), а не от времени закрытия заведения. Пока в цехе
-- две смены, это работает: опорной становится поздняя. Но как только человек
-- выходит один, срок съезжает на его собственный конец смены:
--   • 26.08 Чехов, бар: бармен один, смена 12:00–00:00 → «закрытие» просрочено
--     в 00:00, хотя бар закрывается в 02:00;
--   • 26.08 Истикбол, кухня: оба повара 11:00–23:00 → срок 23:00 и 100 000 сум
--     штрафа за чек-лист, время которого ещё не пришло.
-- То есть наказание получал тот, кто открывал смену, — за то, что не сдал
-- чек-лист закрытия. Чинить срок по графику нечем: график и есть источник, а
-- «настоящее» время закрытия в нём не записано.
--
-- Открытие смены не трогаем: там срок = начало смены, он берётся из графика
-- достоверно, и штрафы за него остаются.

-- ===== 1. Проверка просрочки: закрытие пропускаем =====
create or replace function public.checklist_check_overdue()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_fine constant integer := 50000;
  v_fine_from constant date := date '2026-08-13';
  v_now timestamp; v_bday date; v_found integer := 0;
  t record; f text; v_due timestamp; v_deadline timestamp; v_own record; o record;
  v_att_id bigint; v_miss_id bigint;
  v_points integer; v_notified integer; v_fined integer;
  v_paid text; v_capped text; v_nomark text;
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
    -- Чек-листы закрытия не проверяем вовсе: ни невыполнения, ни штрафа, ни
    -- уведомления. Смена видит их в приложении, спрашивает менеджер.
    continue when checklist_is_closing(v_bday, t.due_time, t.owner_shift_start);

    foreach f in array array['istikbol','chekhov'] loop
      begin  -- сбой на одном чек-листе не должен ронять проверку остальных
        continue when checklist_duplicate_shift(t.id, v_bday, t.due_time, t.owner_shift_start, t.department, f);

        v_due := checklist_due_effective(v_bday, t.due_time, t.owner_shift_start, t.department, f);
        v_deadline := v_due + interval '1 hour';
        continue when v_now < v_deadline;
        -- Окно 3 часа: срок прошёл давно — молчим. Иначе включение проверки
        -- задним числом выкатит пачку наказаний за старые дедлайны.
        continue when v_now > v_deadline + interval '3 hours';

        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        continue when exists (
          select 1 from checklist_misses m
           where m.template_id = t.id and m.filial = f and m.date = v_bday);

        select * from checklist_owners(t.department, t.owner_shift_start, f, v_bday, v_due) into v_own;
        continue when v_own.employee_ids is null;   -- отдел сегодня не работает

        v_points := 0; v_notified := 0; v_fined := 0;
        v_paid := null; v_capped := null; v_nomark := null;

        insert into checklist_misses (template_id, template_name, department, filial, date, due_time, employee_ids, employee_names)
        values (t.id, t.name, t.department, f, v_bday, v_due::time, v_own.employee_ids, v_own.employee_names)
        returning id into v_miss_id;

        for o in select e.id, e.name from employees e where e.id = any(v_own.employee_ids) order by e.name
        loop
          -- Балл официантам: один на человека в день, как и штраф
          if t.department = 'Официанты'
             and not exists (select 1 from waiter_points wp
                              where wp.employee_id = o.id and wp.date = v_bday
                                and wp.reason = 'checklist' and wp.created_by_name = 'Автоматически') then
            insert into waiter_points (employee_id, employee_name, filial, date, category, points, reason, note, created_by_name)
            values (o.id, o.name, f, v_bday, 'discipline', 1, 'checklist',
                    t.name || ' — срок до ' || to_char(v_due, 'HH24:MI'), 'Автоматически');
            v_points := v_points + 1;
          end if;

          continue when v_bday < v_fine_from;

          -- Потолок: с человека не больше одного штрафа за кассовый день
          if exists (select 1 from checklist_penalties cp
                       join checklist_misses m2 on m2.id = cp.miss_id
                      where m2.date = v_bday and cp.employee_id = o.id) then
            v_capped := concat_ws(', ', v_capped, o.name);
            continue;
          end if;

          -- Деньги вешаем на отметку прихода: penalty вычитают все расчёты
          -- зарплаты. Нет отметки — списывать не с чего.
          select att.id into v_att_id from attendance att
           where att.date = v_bday and att.filial = f and att.employee_id = o.id;
          if v_att_id is null then
            v_nomark := concat_ws(', ', v_nomark, o.name);
            continue;
          end if;

          update attendance set penalty = coalesce(penalty, 0) + v_fine where id = v_att_id;
          insert into checklist_penalties (miss_id, employee_id, amount) values (v_miss_id, o.id, v_fine);
          v_fined := v_fined + v_fine;
          v_paid := concat_ws(', ', v_paid, o.name);
        end loop;

        v_text := '⚠️ <b>Чек-лист не сдан</b>' || chr(10)
               || t.name || ' · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || chr(10)
               || 'Срок был до ' || to_char(v_due, 'HH24:MI')
               || (case when v_due::time <> t.due_time
                        then ' (по смене; в шаблоне ' || to_char(t.due_time,'HH24:MI') || ')'
                        else '' end) || ', прошёл час.' || chr(10)
               || 'Ответственные: ' || coalesce(v_own.employee_names,'—') || chr(10)
               || 'Зафиксировано невыполнение.'
               || (case when v_paid is not null
                        then chr(10) || 'Штраф ' || replace(to_char(v_fine, 'FM999,999'), ',', ' ')
                             || ' сум: ' || v_paid
                        else '' end)
               || (case when v_capped is not null
                        then chr(10) || 'Без штрафа (уже был сегодня): ' || v_capped
                        else '' end)
               || (case when v_nomark is not null
                        then chr(10) || 'Без штрафа (нет отметки прихода): ' || v_nomark
                        else '' end)
               || (case when v_bday < v_fine_from
                        then chr(10) || 'Штрафы за чек-листы вступают в силу ' || to_char(v_fine_from, 'DD.MM') || '.'
                        else '' end)
               || (case when v_points > 0 then chr(10) || 'Официантам штрафной балл: ' || v_points || '.' else '' end)
               || chr(10) || 'Сдадите в ближайшие 2 часа — снимем и невыполнение, и всё начисленное.';

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

-- ===== 2. Напоминание о закрытии остаётся, но без угроз =====
-- Раньше текст обещал невыполнение и штраф через час после срока. Для закрытия
-- этого больше не будет, и обещать нечего — остаётся просто напоминание.
create or replace function public.checklist_remind()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_fine constant integer := 50000;
  v_fine_from constant date := date '2026-08-13';
  v_now timestamp; v_bday date; v_sent integer := 0;
  t record; f text; v_due timestamp; v_own record;
  v_kind text; v_closing boolean; v_late boolean; v_text text; r record; v_n integer;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_now  := now() at time zone 'Asia/Tashkent';
  v_bday := business_today();

  for t in
    select id, name, department, due_time, owner_shift_start
      from checklist_templates
     where is_active and due_time is not null
  loop
    foreach f in array array['istikbol','chekhov'] loop
      begin
        continue when checklist_duplicate_shift(t.id, v_bday, t.due_time, t.owner_shift_start, t.department, f);

        v_closing := checklist_is_closing(v_bday, t.due_time, t.owner_shift_start);

        v_due := checklist_due_effective(v_bday, t.due_time, t.owner_shift_start, t.department, f);
        -- У открытия после этого момента невыполнение уже зафиксировано:
        -- предупреждать поздно. У закрытия наказания нет, но и напоминать
        -- бесконечно не надо — держим то же окно.
        continue when v_now >= v_due + interval '1 hour';

        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        select * from checklist_owners(t.department, t.owner_shift_start, f, v_bday, v_due) into v_own;
        continue when v_own.employee_ids is null;

        -- Открытие напоминаем через полчаса после прихода, закрытие — за час до
        -- срока: за полсмены вперёд про закрытие всё равно забудут.
        v_kind := case when v_closing then 'before_due' else 'after_checkin' end;

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
                        then 'Срок был до ' || to_char(v_due,'HH24:MI') || ' — уже прошёл.'
                        else 'Срок — до ' || to_char(v_due,'HH24:MI') || '.' end)
               || (case when v_closing
                        then chr(10) || 'Сдай его перед уходом.'
                        else chr(10) || 'Не сдашь до ' || to_char(v_due + interval '1 hour', 'HH24:MI') || ' — невыполнение'
                             || (case when v_bday >= v_fine_from
                                      then ' и штраф ' || replace(to_char(v_fine, 'FM999,999'), ',', ' ') || ' сум.'
                                      else '.' end)
                        end);

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

-- ===== 3. Разбор августа: снимаем всё, что уже начислено за закрытие =====
-- Идемпотентно: возврат считается по строкам checklist_penalties, а они тут же
-- удаляются, поэтому повторный запуск миграции второй раз денег не вернёт.
-- Сами записи о невыполнении оставляем — это история, деньги и баллы с них сняты.
-- Ненужные строки менеджер может убрать в «⏰ Сроки сдачи и невыполнения».

-- 3.1 Деньги обратно на отметку прихода, ровно теми суммами, что списывали.
-- Возвращаем только там, где штраф действительно на месте (penalty >= суммы).
-- Если penalty уже меньше — значит смену правили руками и штраф с неё сняли;
-- вычесть ещё раз означало бы обнулить чужие деньги, например штраф за опоздание.
update attendance a
   set penalty = a.penalty - x.amount
  from (
    select cp.employee_id, m.date, m.filial, sum(cp.amount) as amount
      from checklist_penalties cp
      join checklist_misses m on m.id = cp.miss_id
      join checklist_templates t on t.id = m.template_id
     where m.date >= date '2026-08-01'
       and checklist_is_closing(m.date, t.due_time, t.owner_shift_start)
     group by cp.employee_id, m.date, m.filial
  ) x
 where a.employee_id = x.employee_id and a.date = x.date and a.filial = x.filial
   and coalesce(a.penalty, 0) >= x.amount;

delete from checklist_penalties cp
 using checklist_misses m, checklist_templates t
 where m.id = cp.miss_id and t.id = m.template_id
   and m.date >= date '2026-08-01'
   and checklist_is_closing(m.date, t.due_time, t.owner_shift_start);

-- 3.2 Штрафные баллы официантам. Сверяемся с названием шаблона в примечании:
-- в тот же день у человека мог быть балл за чек-лист ОТКРЫТИЯ — его не трогаем.
delete from waiter_points wp
 using checklist_misses m, checklist_templates t
 where t.id = m.template_id
   and m.date >= date '2026-08-01'
   and checklist_is_closing(m.date, t.due_time, t.owner_shift_start)
   and wp.reason = 'checklist' and wp.created_by_name = 'Автоматически'
   and wp.date = m.date and wp.filial = m.filial
   and wp.employee_id = any(m.employee_ids)
   and wp.note like m.template_name || '%';

-- 3.3 Счётчики в журнале — в ноль, чтобы записи не показывали снятое
update checklist_misses m
   set penalty_given = 0, points_given = 0
  from checklist_templates t
 where t.id = m.template_id
   and m.date >= date '2026-08-01'
   and checklist_is_closing(m.date, t.due_time, t.owner_shift_start)
   and (coalesce(m.penalty_given, 0) <> 0 or coalesce(m.points_given, 0) <> 0);
