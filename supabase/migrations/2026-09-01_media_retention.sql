-- Срок хранения медиа: две недели.
--
-- Зачем. Бакет task-reports дорос до 966 МБ из 1 ГБ бесплатного тарифа за один
-- месяц (513 МБ из них — видео прихода), и до потолка оставалось меньше двух
-- суток. На потолке отвалились бы и видео прихода, и фото чек-листов: они лежат
-- в одном бакете.
--
-- Почему не помогала кнопка «удалить медиа старше N дней» в админке: на
-- storage.objects были политики только SELECT и INSERT. Удаление молча
-- отфильтровывалось RLS, а клиент считал успехом любой ответ без ошибки и
-- рапортовал «удалено N файлов». За месяц не удалилось ни одного файла.
--
-- Как теперь:
--   1) media_expired() — единственное место, где записано, что считать
--      просроченным. Читает storage.objects (клиенту она недоступна).
--   2) edge-функция cleanup-media ходит сюда за списком и удаляет файлы
--      сервис-ключом. Удалять из SQL нельзя: строку в storage.objects стереть
--      можно, а сам файл в хранилище останется и место не освободит.
--   3) pg_cron дёргает функцию раз в сутки в полночь по Ташкенту.
--   4) политика на DELETE — чтобы ручная кнопка в админке наконец работала.
--
-- Ссылки в attendance.checkin_video НЕ чистим: пусть в истории остаётся видно,
-- что видео человек присылал. Плеер на удалённое видео говорит, что срок
-- хранения вышел (js/tasks.js, viewReport).

-- ===== 1. Что считать просроченным =====
create or replace function public.media_expired(p_days integer default 14,
                                                p_orphan_days integer default 2)
returns table (name text, bytes bigint, reason text)
language sql
stable
security definer
set search_path to 'public', 'storage'
as $$
  -- p_days ниже единицы не опускаем: ноль означал бы «удалить всё сегодняшнее»
  select o.name,
         coalesce((o.metadata->>'size')::bigint, 0) as bytes,
         case when o.created_at < now() - make_interval(days => greatest(p_days, 1))
              then 'expired' else 'orphan' end as reason
    from storage.objects o
   where o.bucket_id = 'task-reports'
     and (
       o.created_at < now() - make_interval(days => greatest(p_days, 1))
       -- Видео, которое загрузилось, но так и не привязалось к отметке: связь
       -- оборвалась между загрузкой файла и записью ссылки. Такое видео не
       -- увидит никто и никогда, а место занимает. Свежие не трогаем — там
       -- ещё может дописаться отложенная привязка.
       or (o.name like 'checkin-%'
           and o.created_at < now() - make_interval(days => greatest(p_orphan_days, 1))
           and not exists (select 1 from public.attendance a
                            where a.checkin_video like '%' || o.name))
     )
   order by o.created_at;
$$;

comment on function public.media_expired(integer, integer) is
  'Файлы бакета task-reports, которые пора удалить: старше p_days либо ничейные видео прихода.';

revoke all on function public.media_expired(integer, integer) from public, anon, authenticated;
grant execute on function public.media_expired(integer, integer) to service_role;

-- ===== 2. Ежедневный запуск =====
create or replace function public.media_cleanup_run()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  perform net.http_post(
    url := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/cleanup-media',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb);
end $$;

revoke all on function public.media_cleanup_run() from public, anon, authenticated;

-- Полночь по Ташкенту (UTC+5): смена уже закрыта, никто ничего не грузит.
select cron.unschedule('media-cleanup') where exists (select 1 from cron.job where jobname = 'media-cleanup');
select cron.schedule('media-cleanup', '0 19 * * *', $cron$select public.media_cleanup_run();$cron$);

-- ===== 3. Ручное удаление из админки =====
-- Именно этой политики не было, из-за неё кнопка очистки и не работала.
drop policy if exists task_reports_delete_admin on storage.objects;
create policy task_reports_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-reports'
    and exists (select 1 from public.profiles p
                 where p.user_id = auth.uid() and p.role = 'admin')
  );
