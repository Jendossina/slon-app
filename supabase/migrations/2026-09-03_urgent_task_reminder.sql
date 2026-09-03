-- Напоминание по срочным задачам.
--
-- Срочная задача, о которой все забыли, ничем не отличается от обычной, поэтому
-- пометка обязана что-то делать, а не только краснеть. Раз в день, в разгар
-- смены, напоминаем о незакрытых срочных:
--   • исполнителю — его срочные;
--   • тому, кто поставил — его срочные, которые ещё не сделаны.
-- Постановщик тут новое: обычные напоминания уходят исполнителю и сводкой
-- руководству, а автор задачи о судьбе своего поручения не узнавал.
--
-- Защита от повторов — та же таблица task_deadline_notices с уникальным
-- (date, kind, recipient), что и у утреннего с вечерним напоминанием: одно
-- сообщение в день на человека, сколько бы раз ни запустился cron.
--
-- Просроченные срочные (дата уже прошла) попадают в то же письмо отдельной
-- строкой — молча забывать их нельзя.

create or replace function public.tasks_notify_urgent()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_today date; v_sent integer := 0; r record; v_text text;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_today := (now() at time zone 'Asia/Tashkent')::date;

  -- Одна строка задачи: просроченная помечена отдельно
  -- (экранируем < > & — сообщение уходит с parse_mode=HTML)
  with строки as (
    select t.assigned_to_id, t.created_by, t.id,
           '• ' || replace(replace(replace(t.title,'&','&amp;'),'<','&lt;'),'>','&gt;')
                || case when t.due_date < v_today
                        then ' — просрочена с ' || to_char(t.due_date, 'DD.MM')
                        else '' end as строка,
           coalesce(t.assigned_to_name, 'без исполнителя') as кому
      from tasks t
     where t.priority = 2
       and coalesce(t.status, 'pending') <> 'done'
       and t.due_date <= v_today
  )
  select 1 into r from строки limit 1;   -- есть ли вообще что слать
  if not found then return 0; end if;

  -- ===== 1. Исполнителю — его срочные =====
  for r in
    select p.telegram_id, p.user_id, count(*) as n,
           string_agg('• ' || replace(replace(replace(t.title,'&','&amp;'),'<','&lt;'),'>','&gt;')
             || case when t.due_date < v_today then ' — просрочена с ' || to_char(t.due_date,'DD.MM') else '' end,
             chr(10) order by t.due_date, t.id) as список
      from tasks t
      join profiles p on p.user_id = t.assigned_to_id
     where t.priority = 2 and coalesce(t.status,'pending') <> 'done'
       and t.due_date <= v_today and p.telegram_id is not null
     group by p.telegram_id, p.user_id
  loop
    insert into task_deadline_notices (date, kind, recipient, tasks)
      values (v_today, 'urgent', r.user_id::text, r.n)
      on conflict (date, kind, recipient) do nothing;
    continue when not found;   -- сегодня уже слали

    v_text := '🔥 <b>Срочная задача не закрыта</b>' || chr(10) || r.список;
    perform net.http_post(url := v_fn,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
    v_sent := v_sent + 1;
  end loop;

  -- ===== 2. Тому, кто поставил =====
  for r in
    select p.telegram_id, p.user_id, count(*) as n,
           string_agg('• ' || replace(replace(replace(t.title,'&','&amp;'),'<','&lt;'),'>','&gt;')
             || ' — ' || coalesce(t.assigned_to_name,'без исполнителя')
             || case when t.due_date < v_today then ' · просрочена с ' || to_char(t.due_date,'DD.MM') else '' end,
             chr(10) order by t.due_date, t.id) as список
      from tasks t
      join profiles p on p.user_id = t.created_by
     where t.priority = 2 and coalesce(t.status,'pending') <> 'done'
       and t.due_date <= v_today and p.telegram_id is not null
       and t.created_by <> t.assigned_to_id      -- себе же дважды не пишем
     group by p.telegram_id, p.user_id
  loop
    insert into task_deadline_notices (date, kind, recipient, tasks)
      values (v_today, 'urgent_author', r.user_id::text, r.n)
      on conflict (date, kind, recipient) do nothing;
    continue when not found;

    v_text := '🔥 <b>Ваши срочные задачи ещё не сделаны</b>' || chr(10) || r.список;
    perform net.http_post(url := v_fn,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end $function$;

revoke all on function public.tasks_notify_urgent() from public, anon, authenticated;

-- 09:00 UTC = 14:00 по Ташкенту: смена в разгаре, между утренним (11:00)
-- и вечерним (20:00) напоминаниями — срочная задача получает третий пинок.
select cron.unschedule('tasks-urgent') where exists (select 1 from cron.job where jobname = 'tasks-urgent');
select cron.schedule('tasks-urgent', '0 9 * * *', $cron$select public.tasks_notify_urgent();$cron$);
