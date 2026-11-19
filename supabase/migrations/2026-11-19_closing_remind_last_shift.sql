-- Напоминание о чек-листе закрытия — только вечерней смене (19.11.2026).
--
-- Было: опорная смена закрытия — ближайшая по началу к owner_shift_start
-- (у кальянной 14:45). Если в этот день никто не начинал ровно в 14:45,
-- checklist_owners отдавал ВСЕХ мастеров цеха на смене, и напоминание
-- «Закрытие смены, срок до 01:00» получал и дневной мастер, уходящий в 00:00
-- (жалоба Иксанова Александра, Чехов). Срок брался от смены 12:45–01:00.
--
-- Стало (только в рассылке, общие функции не трогаем): напоминание о закрытии
-- только вечерней смене — кто по графику уходит не раньше чем за час до срока
-- шаблона (кальянная 03:00 → смены до 02:00 и позже). Вечерней смены нет —
-- не получает никто (решение владельца). Открытие как раньше.

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
  t record; f text; v_due timestamp; v_own record; v_ids bigint[];
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

        if v_closing then
          -- Закрывает вечерняя смена: те, кто по графику уходит не раньше чем
          -- за час до срока шаблона (кальянная 03:00 → с 02:00, кухня 02:30 →
          -- с 01:30). Срок — самый поздний их конец смены. Вечерней смены
          -- нет — не пишем никому.
          select array_agg(distinct s.employee_id), max(bday_ts(v_bday, safe_time(s.shift_end)))
            into v_ids, v_due
            from schedules s join employees e on e.id = s.employee_id
           where s.date = v_bday and s.filial = f and not coalesce(s.is_day_off, false)
             and e.department = t.department
             and safe_time(s.shift_start) is not null and safe_time(s.shift_end) is not null
             and bday_ts(v_bday, safe_time(s.shift_end)) >= bday_ts(v_bday, t.due_time) - interval '1 hour';
          continue when v_ids is null;
        else
          v_due := checklist_due_effective(v_bday, t.due_time, t.owner_shift_start, t.department, f);
        end if;

        continue when v_now >= v_due + interval '1 hour';

        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        if not v_closing then
          select * from checklist_owners(t.department, t.owner_shift_start, f, v_bday, v_due) into v_own;
          v_ids := v_own.employee_ids;
        end if;
        continue when v_ids is null;

        v_kind := case when v_closing then 'before_due' else 'after_checkin' end;

        continue when exists (
          select 1 from checklist_reminders x
           where x.template_id = t.id and x.filial = f and x.date = v_bday and x.kind = v_kind);

        if v_kind = 'after_checkin' then
          continue when not exists (
            select 1 from attendance att
             where att.date = v_bday and att.filial = f
               and att.employee_id = any(v_ids)
               and att.check_in_time is not null
               and v_now >= bday_ts(v_bday, safe_time(att.check_in_time)) + interval '30 minutes');
        else
          continue when v_due - v_now > interval '1 hour';
        end if;

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
           where p.telegram_id is not null and p.employee_id = any(v_ids)
        loop
          perform net.http_post(
            url := v_fn,
            headers := '{"Content-Type":"application/json"}'::jsonb,
            body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
          v_n := v_n + 1;
        end loop;

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
