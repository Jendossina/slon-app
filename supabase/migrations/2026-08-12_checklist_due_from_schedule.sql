-- Срок чек-листа берётся из графика, а не из времени, вшитого в шаблон.
--
-- Предыдущий шаг (2026-08-12_checklist_late_opening_days.sql) только не давал
-- сроку наступить раньше выхода цеха: брал позднейшее из шаблонного времени и
-- начала смены. Это лечило субботу, но оставляло шаблон главным — если смена
-- начиналась РАНЬШЕ шаблонного времени, срок всё равно ждал шаблон.
--
-- Теперь ориентир — фактическая смена:
--   • чек-лист ОТКРЫТИЯ сдаётся к началу смены ответственного;
--   • чек-лист ЗАКРЫТИЯ — к её концу.
-- Час на выполнение сверх срока и прощение в пределах двух часов не меняются.
--
-- Время в шаблоне (due_time) больше не назначает срок. У него осталось две роли:
-- признак «открытие или закрытие» (по расстоянию до owner_shift_start) и
-- запасное значение на случай, когда цеха в графике на этот день нет вовсе.
--
-- Опорная смена — ближайшая к owner_shift_start шаблона. Это важно там, где у
-- цеха в дне несколько смен: у официантов «Открытие» держится за 11:00, а
-- «Второй официант» — за 15:00, и каждый ориентируется на свою. Если
-- owner_shift_start не задан, берём самую позднюю смену дня.
--
-- Что это даёт на живых данных. Обычный день не меняется вообще: смены стоят
-- ровно там, где ждут шаблоны. Суббота (открытие в 15:00, весь штат одной
-- сменой) сама раскладывается по факту: официанты 12:00–03:00 → открытие к
-- 12:00, закрытие к 03:00; бар 13:00–02:00 → 13:00 и 02:00; кальянная
-- 13:30–03:00 → 13:30 и 03:00. Никаких особых правил про субботу в коде нет —
-- поменяется график, поменяются и сроки.

-- ===== Открытие или закрытие =====
-- Признак берём из шаблона, а не из графика: он должен быть устойчивым, иначе
-- в день с необычной сменой чек-лист закрытия мог бы прикинуться открытием.
create or replace function public.checklist_is_closing(p_bday date, p_due time, p_owner_shift time)
returns boolean language sql immutable as $$
  select (bday_ts(p_bday, p_due) - (p_bday + coalesce(p_owner_shift, time '00:00'))) > interval '3 hours';
$$;

-- ===== Срок по факту =====
create or replace function public.checklist_due_effective(
  p_bday date, p_due time, p_owner_shift time, p_department text, p_filial text)
returns timestamp language plpgsql stable security definer set search_path = public as $$
declare v_start time; v_end_ts timestamp;
begin
  -- Опорная смена: ближайшая к owner_shift_start, а без него — самая поздняя
  select safe_time(s.shift_start) into v_start
    from schedules s join employees e on e.id = s.employee_id
   where s.date = p_bday and s.filial = p_filial and not s.is_day_off
     and e.department = p_department and safe_time(s.shift_start) is not null
   order by case when p_owner_shift is null then 0
                 else abs(extract(epoch from (safe_time(s.shift_start) - p_owner_shift))) end,
            safe_time(s.shift_start) desc
   limit 1;

  -- Цеха в графике нет — сроку не от чего отталкиваться, остаётся шаблонный.
  -- Наказания при этом всё равно не будет: checklist_owners вернёт пусто.
  if v_start is null then return bday_ts(p_bday, p_due); end if;

  if not checklist_is_closing(p_bday, p_due, p_owner_shift) then
    return bday_ts(p_bday, v_start);
  end if;

  -- Закрытие: конец опорной смены. Берём позднейший конец среди тех, кто вышел
  -- в это время, и считаем его отметкой времени — иначе «02:00» текстом
  -- оказалось бы раньше «11:00», и ночной конец смены потерялся бы.
  select max(bday_ts(p_bday, safe_time(s.shift_end))) into v_end_ts
    from schedules s join employees e on e.id = s.employee_id
   where s.date = p_bday and s.filial = p_filial and not s.is_day_off
     and e.department = p_department and safe_time(s.shift_start) = v_start;

  return coalesce(v_end_ts, bday_ts(p_bday, p_due));
end $$;

drop function if exists public.checklist_due_effective(date, time, text, text);

-- ===== Проверка просрочки =====
create or replace function public.checklist_check_overdue()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_fine constant integer := 50000;
  v_now timestamp; v_bday date; v_found integer := 0;
  t record; f text; v_due timestamp; v_deadline timestamp; v_own record;
  v_att_id bigint; v_miss_id bigint;
  v_points integer; v_notified integer; v_fined integer; v_nopay boolean;
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
    foreach f in array array['istikbol','chekhov'] loop
      begin  -- сбой на одном чек-листе не должен ронять проверку остальных
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

        v_points := 0; v_notified := 0; v_fined := 0; v_nopay := false;

        insert into checklist_misses (template_id, template_name, department, filial, date, due_time, employee_ids, employee_names)
        values (t.id, t.name, t.department, f, v_bday, v_due::time, v_own.employee_ids, v_own.employee_names)
        returning id into v_miss_id;

        -- Деньги — личному ответственному, на его отметку прихода: penalty
        -- вычитают все расчёты зарплаты. Не отметился — не списываем.
        select att.id into v_att_id from attendance att
         where att.date = v_bday and att.filial = f and att.employee_id = v_own.lead_id;

        if v_att_id is not null then
          update attendance set penalty = coalesce(penalty, 0) + v_fine where id = v_att_id;
          insert into checklist_penalties (miss_id, employee_id, amount) values (v_miss_id, v_own.lead_id, v_fine);
          v_fined := v_fine;
        else
          v_nopay := true;
        end if;

        -- Штрафной балл официантам — тоже одному, тому же человеку
        if t.department = 'Официанты' and v_own.lead_id is not null then
          insert into waiter_points (employee_id, employee_name, filial, date, category, points, reason, note, created_by_name)
          values (v_own.lead_id, v_own.lead_name, f, v_bday, 'discipline', 1, 'checklist',
                  t.name || ' — срок до ' || to_char(v_due, 'HH24:MI'), 'Автоматически');
          v_points := 1;
        end if;

        v_text := '⚠️ <b>Чек-лист не сдан</b>' || chr(10)
               || t.name || ' · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || chr(10)
               || 'Срок был до ' || to_char(v_due, 'HH24:MI')
               || (case when v_due::time <> t.due_time
                        then ' (по смене; в шаблоне ' || to_char(t.due_time,'HH24:MI') || ')'
                        else '' end) || ', прошёл час.' || chr(10)
               || 'В смене: ' || coalesce(v_own.employee_names,'—') || chr(10)
               || 'Отвечает: ' || coalesce(v_own.lead_name,'—') || chr(10)
               || 'Зафиксировано невыполнение.'
               || (case when v_fined > 0
                        then chr(10) || 'Штраф ' || replace(to_char(v_fine, 'FM999,999'), ',', ' ') || ' сум — вычтется из смены.'
                        else '' end)
               || (case when v_nopay
                        then chr(10) || 'Штраф не списан: ответственный не отметил приход.'
                        else '' end)
               || (case when v_points > 0 then chr(10) || 'Официанту дополнительно штрафной балл.' else '' end)
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

-- ===== Напоминания: тот же срок по факту =====
create or replace function public.checklist_remind()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_fine constant integer := 50000;
  v_now timestamp; v_bday date; v_sent integer := 0;
  t record; f text; v_due timestamp; v_own record;
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
    foreach f in array array['istikbol','chekhov'] loop
      begin
        v_due := checklist_due_effective(v_bday, t.due_time, t.owner_shift_start, t.department, f);
        -- После этого момента невыполнение уже зафиксировано: предупреждать поздно
        continue when v_now >= v_due + interval '1 hour';

        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        select * from checklist_owners(t.department, t.owner_shift_start, f, v_bday, v_due) into v_own;
        continue when v_own.employee_ids is null;

        -- Открытие напоминаем через полчаса после прихода, закрытие — за час до
        -- срока: за полсмены вперёд про закрытие всё равно забудут.
        v_kind := case when checklist_is_closing(v_bday, t.due_time, t.owner_shift_start)
                       then 'before_due' else 'after_checkin' end;

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
                        else 'Срок — до ' || to_char(v_due,'HH24:MI') || '.' end) || chr(10)
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
