-- 1) Чек-лист, сданный с небольшим опозданием, не должен стоить балла.
--    Решение владельца: прощаем, если уложились в 2 часа от срока.
--    Для этого нужно знать, КОГДА чек-лист закрыли, — раньше это нигде не хранилось.
-- 2) Напоминание про выгрузку iiko: без неё два блока процентов не оцениваются.

-- ===== когда чек-лист закрыли =====
alter table public.checklist_logs add column if not exists completed_at timestamptz;

create or replace function public.checklist_stamp_completed()
returns trigger language plpgsql as $$
begin
  if new.completed and (tg_op = 'INSERT' or not coalesce(old.completed, false)) then
    new.completed_at := now();
  elsif not new.completed then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists checklist_logs_stamp_completed on public.checklist_logs;
create trigger checklist_logs_stamp_completed
  before insert or update on public.checklist_logs
  for each row execute function public.checklist_stamp_completed();

-- Историю проставляем по времени создания строки — точнее данных нет
update public.checklist_logs set completed_at = created_at
 where completed and completed_at is null;

-- ===== прощение опоздания =====
-- Отдельной функцией, чтобы её можно было звать и из проверки, и вручную.
create or replace function public.checklist_forgive_late(p_grace interval default interval '2 hours')
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_done timestamp; v_due timestamp; v_freed integer := 0;
begin
  for r in
    select m.id, m.template_id, m.filial, m.date, m.due_time, m.employee_ids
      from checklist_misses m
     where m.date >= business_today() - 3
  loop
    select (l.completed_at at time zone 'Asia/Tashkent') into v_done
      from checklist_logs l
     where l.template_id = r.template_id and l.date = r.date and l.filial = r.filial and l.completed;
    continue when v_done is null;

    -- срок с учётом ночных чек-листов (до 08:00 — это следующая календарная дата)
    v_due := (r.date + (case when r.due_time < time '08:00' then 1 else 0 end)) + r.due_time;
    continue when v_done > v_due + p_grace;

    -- уложились: снимаем автоматические баллы и саму запись о невыполнении
    delete from waiter_points
     where reason = 'checklist' and date = r.date and filial = r.filial
       and created_by_name = 'Автоматически'
       and employee_id = any(r.employee_ids);
    delete from checklist_misses where id = r.id;
    v_freed := v_freed + 1;
  end loop;
  return v_freed;
end $$;

revoke all on function public.checklist_forgive_late(interval) from public, anon;
grant execute on function public.checklist_forgive_late(interval) to authenticated;

-- ===== напоминание про iiko =====
-- В понедельник утром: если за прошедшую неделю нет ни одной строки показателей,
-- «Наполняемость» и «Десерты» засчитались автоматически — руководству стоит знать.
create or replace function public.iiko_weekly_reminder()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare v_week date; v_waiters int; v_rows int; v_text text; r record; v_sent int := 0;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_week := week_start_of(business_today()) - 7;   -- прошедшая неделя
  select count(*) into v_waiters from employees
   where department = 'Официанты' and coalesce(status,'Активен') <> 'Уволен';
  select count(*) into v_rows from waiter_week_stats where week_start = v_week;
  if v_waiters = 0 or v_rows >= v_waiters then return 0; end if;

  v_text := '📊 <b>Показатели iiko не внесены</b>' || chr(10)
         || 'Неделя с ' || to_char(v_week,'DD.MM') || ': заполнено ' || v_rows || ' из ' || v_waiters || chr(10)
         || 'Без них «Наполняемость чека» и «Десерты» засчитываются официантам автоматически.' || chr(10)
         || 'Проценты → Итоги недели → «Данные из iiko».';

  for r in
    select distinct p.telegram_id from profiles p
     where p.telegram_id is not null and p.role = any(array['admin','manager'])
  loop
    perform net.http_post(url := v_fn,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;

revoke all on function public.iiko_weekly_reminder() from public, anon;
grant execute on function public.iiko_weekly_reminder() to authenticated;

-- Прощение — вместе с проверкой просрочки, каждые 15 минут.
select cron.unschedule('checklist-forgive') where exists (select 1 from cron.job where jobname = 'checklist-forgive');
select cron.schedule('checklist-forgive', '*/15 * * * *', $$ select public.checklist_forgive_late(); $$);

-- Напоминание про iiko — понедельник 11:00 по Ташкенту (06:00 UTC).
select cron.unschedule('iiko-weekly-reminder') where exists (select 1 from cron.job where jobname = 'iiko-weekly-reminder');
select cron.schedule('iiko-weekly-reminder', '0 6 * * 1', $$ select public.iiko_weekly_reminder(); $$);
