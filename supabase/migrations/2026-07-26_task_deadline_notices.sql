-- Уведомления в день дедлайна задачи.
-- 11:00 — исполнителю список его задач на сегодня, руководству — сводка по всем.
-- 20:00 — второе напоминание, только по тем, что так и не закрыты.
-- Крутится в базе (pg_cron) и шлёт через существующую edge-функцию send-telegram (pg_net).

-- Чтобы одно и то же не ушло дважды (перезапуск cron, повторный прогон файла).
create table if not exists public.task_deadline_notices (
  id        bigserial primary key,
  date      date not null,
  kind      text not null check (kind in ('morning','evening')),
  recipient text not null,          -- user_id получателя
  tasks     integer not null default 0,
  sent_at   timestamptz not null default now(),
  unique (date, kind, recipient)
);
create index if not exists task_deadline_notices_date_idx on public.task_deadline_notices (date);

alter table public.task_deadline_notices enable row level security;
drop policy if exists task_deadline_notices_select on public.task_deadline_notices;
create policy task_deadline_notices_select on public.task_deadline_notices for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager','boss'])));

create or replace function public.tasks_notify_deadline(p_kind text)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_today date; v_sent integer := 0; r record; v_text text; v_head text;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  -- Задачи живут по календарной дате (не по кассовому дню) — как и в приложении
  v_today := (now() at time zone 'Asia/Tashkent')::date;

  -- ===== 1. Исполнителям — их задачи =====
  v_head := case p_kind
              when 'morning' then '📌 <b>Сегодня дедлайн</b>'
              else '⏰ <b>Задачи на сегодня ещё не закрыты</b>' end;

  for r in
    select t.assigned_to_id as user_id, p.telegram_id, count(*) as n,
           string_agg('• ' || replace(replace(replace(t.title,'&','&amp;'),'<','&lt;'),'>','&gt;'),
                      chr(10) order by t.id) as list
      from tasks t
      join profiles p on p.user_id = t.assigned_to_id
     where t.due_date = v_today and coalesce(t.status,'pending') <> 'done'
       and p.telegram_id is not null
     group by t.assigned_to_id, p.telegram_id
  loop
    insert into task_deadline_notices (date, kind, recipient, tasks)
      values (v_today, p_kind, r.user_id::text, r.n)
      on conflict (date, kind, recipient) do nothing;
    continue when not found;   -- уже слали

    v_text := v_head || chr(10) || r.list;
    perform net.http_post(
      url := v_fn,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
    v_sent := v_sent + 1;
  end loop;

  -- ===== 2. Руководству — одна сводка по всем задачам дня =====
  select string_agg('• ' || replace(replace(replace(t.title,'&','&amp;'),'<','&lt;'),'>','&gt;')
                    || ' — ' || coalesce(t.assigned_to_name,'без исполнителя')
                    || ' · ' || (case t.filial when 'chekhov' then 'Чехов' else 'Истикбол' end),
                    chr(10) order by t.filial, t.id)
    into v_text
    from tasks t
   where t.due_date = v_today and coalesce(t.status,'pending') <> 'done';

  if v_text is not null then
    v_head := case p_kind
                when 'morning' then '📋 <b>Задачи с дедлайном сегодня</b>'
                else '⏰ <b>Не закрыто на конец дня</b>' end;
    v_text := v_head || chr(10) || v_text;

    for r in
      select p.user_id, p.telegram_id
        from profiles p
       where p.telegram_id is not null
         and p.role = any(array['admin','manager'])
         and coalesce(p.notify_prefs ->> 'task_due', 'true') <> 'false'
    loop
      insert into task_deadline_notices (date, kind, recipient, tasks)
        values (v_today, p_kind, 'mgr:' || r.user_id::text, 0)
        on conflict (date, kind, recipient) do nothing;
      continue when not found;

      perform net.http_post(
        url := v_fn,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
      v_sent := v_sent + 1;
    end loop;
  end if;

  return v_sent;
end $$;

revoke all on function public.tasks_notify_deadline(text) from public, anon;
grant execute on function public.tasks_notify_deadline(text) to authenticated;

-- Ташкент = UTC+5 круглый год, перевода часов нет: 11:00 → 06:00 UTC, 20:00 → 15:00 UTC.
select cron.unschedule('task-deadline-morning') where exists (select 1 from cron.job where jobname = 'task-deadline-morning');
select cron.unschedule('task-deadline-evening') where exists (select 1 from cron.job where jobname = 'task-deadline-evening');
select cron.schedule('task-deadline-morning', '0 6 * * *',  $$ select public.tasks_notify_deadline('morning'); $$);
select cron.schedule('task-deadline-evening', '0 15 * * *', $$ select public.tasks_notify_deadline('evening'); $$);
