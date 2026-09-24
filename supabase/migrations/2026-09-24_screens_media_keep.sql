-- Картинки для экранов в зале уборка медиа стирать не должна.
--
-- media_expired() сносит из бакета task-reports всё старше двух недель, кроме
-- чеков и каталога посуды. Картинка акции — такой же долгоживущий материал:
-- без этой правки баннер пропал бы с телевизора ровно через четырнадцать дней,
-- и выглядело бы это как «экран сам себя сломал».
--
-- Врезки лежат с приставкой screen/ (см. uploadSlideImage в js/screens.js).

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
     and o.name not like 'screen/%'        -- и врезки на телевизорах в зале
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

revoke all on function public.media_expired(integer, integer) from public, anon, authenticated;
grant execute on function public.media_expired(integer, integer) to service_role;
