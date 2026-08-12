-- Штраф за чек-листы: старт с 13 августа и потолок один на человека в день.
--
-- 1) СТАРТ С ЗАВТРА. Механизм включили вечером 12 августа, а ближайшие сроки —
--    этой же ночью (бар 02:00, кухня 02:30, кальянная и официанты 03:00). Люди
--    узнали бы о новом правиле, уже получив штраф. Решение владельца: деньги
--    начинают действовать с кассового дня 13 августа. Невыполнения и штрафные
--    баллы работают как работали — меняются только деньги.
--
-- 2) ПОТОЛОК. По субботам весь штат выходит одной сменой в одно время,
--    различить ответственных по графику некого — и все невыполнения дня легли
--    бы на одного человека: три чек-листа = 150 000 с одной смены. Больше
--    одного штрафа в день с человека не берём. Невыполнение при этом
--    фиксируется каждое, руководство видит все.

create or replace function public.checklist_check_overdue()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_fine constant integer := 50000;
  -- С какого кассового дня штраф действует. До этой даты — только невыполнение
  -- и балл, как было до 12.08.2026.
  v_fine_from constant date := date '2026-08-13';
  v_now timestamp; v_bday date; v_found integer := 0;
  t record; f text; v_due timestamp; v_deadline timestamp; v_own record;
  v_att_id bigint; v_miss_id bigint;
  v_points integer; v_notified integer; v_fined integer;
  v_nopay boolean; v_capped boolean;
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

        v_points := 0; v_notified := 0; v_fined := 0; v_nopay := false; v_capped := false;

        insert into checklist_misses (template_id, template_name, department, filial, date, due_time, employee_ids, employee_names)
        values (t.id, t.name, t.department, f, v_bday, v_due::time, v_own.employee_ids, v_own.employee_names)
        returning id into v_miss_id;

        -- Деньги — личному ответственному, на его отметку прихода: penalty
        -- вычитают все расчёты зарплаты.
        if v_bday >= v_fine_from and v_own.lead_id is not null then
          if exists (select 1 from checklist_penalties cp
                       join checklist_misses m2 on m2.id = cp.miss_id
                      where m2.date = v_bday and cp.employee_id = v_own.lead_id) then
            v_capped := true;                       -- один штраф в день, потолок
          else
            select att.id into v_att_id from attendance att
             where att.date = v_bday and att.filial = f and att.employee_id = v_own.lead_id;

            if v_att_id is not null then
              update attendance set penalty = coalesce(penalty, 0) + v_fine where id = v_att_id;
              insert into checklist_penalties (miss_id, employee_id, amount) values (v_miss_id, v_own.lead_id, v_fine);
              v_fined := v_fine;
            else
              v_nopay := true;                      -- не отметил приход — не с чего списывать
            end if;
          end if;
        end if;

        -- Штрафной балл официантам — тому же одному человеку
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
               || (case when v_capped
                        then chr(10) || 'Штраф не начислен: с этого человека уже списан штраф сегодня.'
                        else '' end)
               || (case when v_nopay
                        then chr(10) || 'Штраф не списан: ответственный не отметил приход.'
                        else '' end)
               || (case when v_bday < v_fine_from
                        then chr(10) || 'Штрафы за чек-листы вступают в силу ' || to_char(v_fine_from, 'DD.MM') || '.'
                        else '' end)
               || (case when v_points > 0 then chr(10) || 'Официанту дополнительно штрафной балл.' else '' end)
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

-- Напоминание не должно грозить штрафом раньше, чем штраф начнёт действовать:
-- сегодня ночью люди получили бы «не сдашь — 50 000», а списания бы не было.
create or replace function public.checklist_remind()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_fine constant integer := 50000;
  v_fine_from constant date := date '2026-08-13';
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
               || 'Не сдашь до ' || to_char(v_due + interval '1 hour', 'HH24:MI') || ' — невыполнение'
               || (case when v_bday >= v_fine_from
                        then ' и штраф ' || replace(to_char(v_fine, 'FM999,999'), ',', ' ') || ' сум.'
                        else '.' end);

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
