-- Две поправки к сроку хранения медиа.
--
-- 1. Каталог посуды под уборку попадать не должен. Фото в карточке посуды —
--    это не отчёт за смену, а часть справочника: оно должно жить, пока живёт
--    сама позиция. Уборка удаляла всё подряд старше двух недель, и первое же
--    добавленное фото исчезло бы через две недели. Сейчас фото нет ни у одной
--    из 68 позиций, так что удалять было нечего — правим до того, как появятся.
--    Каталог узнаём по папке: dishware/<id>-<время>, всё остальное лежит в
--    корне бакета плоскими именами (checkin-, checklist-, receipt- и т.д.).
--
-- 2. Удалять файлы может и менеджер. Политику я завёл под одного управляющего,
--    а замена фото посуды доступна менеджеру тоже (dishwareCanManage =
--    canEditData). У менеджера старый файл оставался в хранилище молча — ровно
--    та беда, из-за которой бакет и переполнился.

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
     and (
       o.created_at < now() - make_interval(days => greatest(p_days, 1))
       or (o.name like 'checkin-%'
           and o.created_at < now() - make_interval(days => greatest(p_orphan_days, 1))
           and not exists (select 1 from public.attendance a
                            where a.checkin_video like '%' || o.name))
     )
   order by o.created_at;
$$;

drop policy if exists task_reports_delete_admin on storage.objects;
create policy task_reports_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-reports'
    and exists (select 1 from public.profiles p
                 where p.user_id = auth.uid()
                   and p.role = any(array['admin','manager']))
  );
