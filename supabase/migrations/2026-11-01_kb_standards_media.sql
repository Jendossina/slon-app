-- Стандарты с видео (01.11.2026): «как протереть стол», «как включить свет»,
-- «как выглядит менажный набор». Живут статьями базы знаний, в книге
-- «Стандарты», и получают две вещи, которых у статей не было:
--
--   media — видео и фото к статье, список {type, url, path};
--   depts — каким отделам статья видна. Пусто — всем, как все статьи до сих
--           пор. Решение владельца: «каждому своё» — официант видит стандарты
--           зала, бармен — бара; руководство видит всё.

alter table public.kb_articles add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.kb_articles add column if not exists depts text[];

-- Отдел того, кто спрашивает. Нужен политике чтения, поэтому выполняется от
-- имени сотрудника — грант authenticated обязателен.
create or replace function public.my_department()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e.department
    from profiles p join employees e on e.id = p.employee_id
   where p.user_id = auth.uid();
$$;

revoke all on function public.my_department() from public, anon;
grant execute on function public.my_department() to authenticated;

drop policy if exists kb_articles_read on public.kb_articles;
create policy kb_articles_read on public.kb_articles for select to authenticated
  using (
    depts is null or cardinality(depts) = 0
    or exists (select 1 from profiles p
                where p.user_id = auth.uid()
                  and p.role = any(array['admin','manager','boss']))
    or public.my_department() = any(depts)
  );

-- Видео стандартов не должны исчезать через 14 дней вместе с фото чек-листов:
-- лежат под kb/ и в уборку не попадают.
create or replace function public.media_expired(p_days integer default 14, p_orphan_days integer default 2)
returns table(name text, bytes bigint, reason text)
language sql
stable security definer
set search_path to 'public', 'storage'
as $function$
  select o.name,
         coalesce((o.metadata->>'size')::bigint, 0) as bytes,
         case when o.created_at < now() - make_interval(days => greatest(p_days, 1))
              then 'expired' else 'orphan' end as reason
    from storage.objects o
   where o.bucket_id = 'task-reports'
     and o.name not like 'dishware/%'      -- каталог посуды живёт всегда
     and o.name not like 'receipt-%'       -- фото кассы тоже: это документ
     and o.name not like 'screen/%'        -- и врезки на телевизорах в зале
     and o.name not like 'kb/%'            -- и видео стандартов
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
$function$;
