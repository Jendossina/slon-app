-- Фото чеков не удаляем никогда.
--
-- Чек — не оперативный отчёт за смену, а подтверждение суммы в кассе: к нему
-- возвращаются при сверках и спорах спустя месяцы. Под общий двухнедельный
-- срок он попал заодно со всем остальным, и восемь снимков этим уже унесло —
-- вернуть их нельзя, файлы удалены из хранилища.
--
-- Теперь бессрочных категорий две, и обе узнаются по имени файла:
--   dishware/<id>-<время>  — каталог посуды (часть справочника)
--   receipt-<время>.jpg    — фото кассы (finance.photo_url)
-- Всё остальное живёт две недели: видео прихода, фото чек-листов, отчёты по
-- кальянам и уборке, снимки к задачам, вложения чата.

create or replace function public.media_expired(p_days integer default 14,
                                                p_orphan_days integer default 2)
returns table (name text, bytes bigint, reason text)
language sql
stable
security definer
set search_path to 'public', 'storage'
as $$
  select o.name,
         coalesce((o.metadata->>'size')::bigint, 0) as bytes,
         case when o.created_at < now() - make_interval(days => greatest(p_days, 1))
              then 'expired' else 'orphan' end as reason
    from storage.objects o
   where o.bucket_id = 'task-reports'
     and o.name not like 'dishware/%'      -- каталог посуды живёт всегда
     and o.name not like 'receipt-%'       -- фото кассы тоже: это документ
     and (
       o.created_at < now() - make_interval(days => greatest(p_days, 1))
       or (o.name like 'checkin-%'
           and o.created_at < now() - make_interval(days => greatest(p_orphan_days, 1))
           and not exists (select 1 from public.attendance a
                            where a.checkin_video like '%' || o.name))
     )
   order by o.created_at;
$$;
