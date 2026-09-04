-- Напоминание об открытии больше не обвиняет вовремя вышедшего человека.
--
-- 04.09 Ангелина вышла в 11:00, отметилась в 10:51 и в 11:25 получила:
-- «Срок был до 11:00 — уже прошёл. Не сдашь до 12:00 — невыполнение и штраф
-- 50 000 сум». Чек-лист она сдала в 11:44, никакого невыполнения и штрафа не
-- было. Но текст читается как обвинение, хотя человек ничего не нарушил.
--
-- Причина в том, что у чек-листа открытия срок равен началу смены (due_time =
-- owner_shift_start), а невыполнение фиксируется только через час после него.
-- Напоминание уходит через полчаса после отметки прихода — то есть почти
-- всегда уже «после срока», и флаг v_late у открытия поднят всегда.
--
-- Теперь у открытия называем тот срок, который действительно наказуем
-- (начало смены + час), и не говорим про «прошёл». Закрытие не трогаем: там
-- наказания нет, срок — конец смены, и «уже прошёл» там правда.
--
-- Меняется только текст, вся логика отбора прежняя.

create or replace function public.checklist_remind()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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

        -- «Уже прошёл» бывает только у закрытия. У открытия срок равен началу
        -- смены, и до конца часа отсрочки человек ничего не нарушил — ему
        -- называем сам час, а не начало смены.
        v_late := v_closing and v_now >= v_due;
        v_text := '🔔 <b>Не забудь чек-лист</b>' || chr(10)
               || t.name || ' · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || chr(10)
               || (case
                     when v_late   then 'Срок был до ' || to_char(v_due,'HH24:MI') || ' — уже прошёл.'
                     when v_closing then 'Срок — до ' || to_char(v_due,'HH24:MI') || '.'
                     else 'Сдай до ' || to_char(v_due + interval '1 hour','HH24:MI')
                          || ' — после этого невыполнение'
                          || (case when v_bday >= v_fine_from
                                   then ' и штраф ' || replace(to_char(v_fine, 'FM999,999'), ',', ' ') || ' сум.'
                                   else '.' end)
                   end)
               || (case when v_closing then chr(10) || 'Сдай его перед уходом.' else '' end);

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
end $function$;
