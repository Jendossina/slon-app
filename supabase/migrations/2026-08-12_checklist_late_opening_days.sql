-- Чек-листы в дни с поздним открытием (субботы) — и заодно конец наказаний всем цехом.
--
-- Что случилось. По субботам заведение открывается в 15:00, и весь штат выходит
-- одной сменой позже обычного: официанты в 12:00, повара в 13:00, бармены в
-- 13:00–13:30, кальянщики в 13:30. Шаблоны утренних чек-листов ждут 11:00 и
-- 11:30. То есть срок проходил ДО того, как первый человек появлялся на работе,
-- и невыполнение было предопределено — сдать чек-лист было физически некому.
--
-- Вторая беда рядом. Ответственный ищется по точному совпадению начала смены с
-- owner_shift_start шаблона. В субботу не совпадает ни одна смена, срабатывает
-- запасная ветка «отвечают все в смене» — и штрафной балл прилетал всему цеху
-- разом. 1 и 8 августа (обе субботы) это дало 12 и 20 наказанных человек против
-- обычных трёх-четырёх за день.
--
-- Лечим двумя правилами. Оба общие: не «если суббота», а «если смена начинается
-- позже срока» — то же самое случится в любой праздник или при сдвиге графика.
--
--   1. СРОК НЕ РАНЬШЕ ВЫХОДА ЦЕХА. Фактический срок = позднейшее из двух:
--      срок шаблона и начало первой смены цеха в этот день. В обычный день
--      ничего не меняется (смена в 11:00, срок 11:00). В субботу срок утреннего
--      чек-листа сам переезжает на 12:00/13:00/13:30 — на момент, когда люди уже
--      на месте. Час на выполнение сверх этого остаётся как был.
--      Ночные чек-листы закрытия сравниваются как отметки времени, а не как
--      часы на циферблате, иначе срок 03:00 «оказался бы раньше» смены в 13:00.
--
--   2. БАЛЛ И ШТРАФ — ОДНОМУ, А НЕ ЦЕХУ. У невыполнения теперь есть личный
--      ответственный: из тех, кто в смене, берём отметившихся, среди них — чья
--      смена ближе к сроку, дальше кто раньше пришёл. Ему и балл, и деньги.
--      Сама запись о невыполнении и уведомление по-прежнему называют всю смену:
--      руководству видно, кто работал, но наказан один человек.

-- ===== Фактический срок с учётом того, когда цех реально выходит =====
create or replace function public.checklist_due_effective(
  p_bday date, p_due time, p_department text, p_filial text)
returns timestamp language sql stable security definer set search_path = public as $$
  select greatest(
           bday_ts(p_bday, p_due),
           coalesce((select p_bday + min(safe_time(s.shift_start))
                       from schedules s join employees e on e.id = s.employee_id
                      where s.date = p_bday and s.filial = p_filial
                        and not s.is_day_off and e.department = p_department),
                    bday_ts(p_bday, p_due)));
$$;

-- ===== Ответственные + тот, кто отвечает лично =====
-- employee_ids/employee_names — вся смена цеха, что попала под чек-лист: это
-- журнал и текст уведомления. lead_id/lead_name — кто получает балл и штраф.
create or replace function public.checklist_owners(
  p_department text, p_owner_shift time, p_filial text, p_bday date, p_due_ts timestamp default null,
  out employee_ids bigint[], out employee_names text, out lead_id bigint, out lead_name text)
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

  if employee_ids is null then return; end if;

  -- Личный ответственный. Отметившихся предпочитаем: наказание должно лечь на
  -- того, кто реально был на смене, а не на того, кто её пропустил.
  select e.id, e.name into lead_id, lead_name
    from schedules s
    join employees e on e.id = s.employee_id
    left join attendance att
      on att.employee_id = s.employee_id and att.date = p_bday and att.filial = p_filial
   where s.date = p_bday and s.filial = p_filial and s.employee_id = any(employee_ids)
   order by (att.id is null),
            abs(extract(epoch from ((p_bday + safe_time(s.shift_start)) - coalesce(p_due_ts, p_bday::timestamp)))),
            att.check_in_time nulls last,
            s.employee_id
   limit 1;
end $$;

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
        -- Срок считаем на каждый филиал свой: смены в них могут начинаться
        -- по-разному, а раньше выхода цеха срок наступить не может.
        v_due := checklist_due_effective(v_bday, t.due_time, t.department, f);
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
                        then ' (сдвинут с ' || to_char(t.due_time,'HH24:MI') || ' — цех вышел позже)'
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

-- ===== Напоминания: тот же фактический срок =====
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
    foreach f in array array['istikbol','chekhov'] loop
      begin
        v_due := checklist_due_effective(v_bday, t.due_time, t.department, f);
        -- После этого момента невыполнение уже зафиксировано: предупреждать поздно
        continue when v_now >= v_due + interval '1 hour';

        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        select * from checklist_owners(t.department, t.owner_shift_start, f, v_bday, v_due) into v_own;
        continue when v_own.employee_ids is null;

        -- Открытие смены или закрытие: у «открытия» срок в паре часов от начала
        -- смены ответственного, у «закрытия» — через полсуток.
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
