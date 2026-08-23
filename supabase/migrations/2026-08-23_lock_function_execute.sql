-- Закрываем свои функции от анонимного вызова.
--
-- Postgres по умолчанию даёт EXECUTE роли PUBLIC на каждую новую функцию, а
-- publishable-ключ лежит в коде приложения и по определению публичен. То есть
-- любой, кто открыл js/core.js, мог дёрнуть наши функции, не входя в систему.
-- Нашлось при проверке 23.08: notify_chiefs отдавал telegram_id всего
-- руководства по одному curl, а cleaning_remind позволял слать людям
-- напоминания сколько угодно раз.
--
-- Снимать право надо и у PUBLIC, и у anon отдельно: Supabase держит
-- ALTER DEFAULT PRIVILEGES, который выдаёт EXECUTE роли anon явным грантом, так
-- что «revoke from public» его не задевает — проверено, после него anon всё ещё
-- звал notify_chiefs. Возвращаем право роли authenticated и только тем, которые
-- приложение действительно зовёт из браузера. Остальные вызываются изнутри:
--   * триггерные — право проверяется при CREATE TRIGGER, а не при срабатывании;
--   * по расписанию — cron работает от postgres.
--
-- Трогаем ТОЛЬКО свои функции: расширения (pgcrypto, pg_net и прочие) кладут
-- своё в те же схемы, и снятое у них право ломает то, что им пользуется.
--
-- Дальше правило простое: создал функцию — сразу сними PUBLIC.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       -- не наше: функции, принадлежащие расширениям
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
  end loop;
end $$;

-- Обратно — только то, что зовёт клиент (список сверен с grep по js/*.js).
grant execute on function public.notify_chiefs(text) to authenticated;
grant execute on function public.notify_dept_seniors(text, integer, text) to authenticated;
grant execute on function public.tg_link_code_new() to authenticated;
grant execute on function public.update_own_telegram_id(text) to authenticated;
grant execute on function public.update_own_notify_prefs(jsonb) to authenticated;

-- Эти зовутся из браузера с аргументами — сигнатуры берём из базы, чтобы не
-- промахнуться мимо перегрузки и не выдать право не тому.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'cleaning_start', 'waiter_positions_assign', 'apply_dishware_inventory',
         'quiz_start', 'quiz_submit', 'quiz_reopen',
         'my_employee_id', 'job_level', 'business_today', 'cleanup_old_data'
       )
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- Отдельно закрываем от вошедшего сотрудника то, что умеет слать людям сообщения
-- и чистить данные. Эти функции зовёт только cron (он работает от postgres) или
-- триггер изнутри security definer — из браузера их не вызывает никто, а руками
-- позвать значило бы засыпать смену напоминаниями или выгрести чужие чаты.
-- Остальным функциям право у authenticated пока оставлено: их зовут политики
-- RLS, проверки и ограничения от имени самого сотрудника, и снимать право
-- вслепую — верный способ положить экраны.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'cleaning_remind', 'cleaning_needs_reminder', 'checklist_remind',
         'shift_requests_cleanup', 'dept_leads_with_telegram'
       )
  loop
    execute format('revoke all on function %s from authenticated', r.sig);
  end loop;
end $$;
