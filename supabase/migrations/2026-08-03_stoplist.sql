-- Го/стоп-лист: что закончилось и что нужно продавать в первую очередь.
--
-- Ставят позиции те, кто отвечает за продукт: повара — по кухне, бармены — по бару.
-- Руководство может по обеим областям. Видят все — прежде всего официанты, ради
-- которых лист и заводится: не предлагать гостю то, чего нет, и продвигать то,
-- что иначе испортится.
--
-- Позиция не удаляется, а закрывается (resolved_at) — остаётся история: видно,
-- что чаще всего уходит в стоп и как долго висит.
--
-- Меню в базе нет (в приложении нет каталога блюд), поэтому название — текстом.

create table if not exists public.stoplist_items (
  id               bigserial primary key,
  filial           text not null,
  area             text not null check (area in ('kitchen','bar')),
  state            text not null check (state in ('stop','go')),
  name             text not null,
  note             text,                                   -- «осталось 3 порции», «до конца дня»
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid,
  resolved_by_name text
);

-- Одно и то же блюдо не должно висеть в списке дважды. Ограничение частичное:
-- на закрытые записи не распространяется, иначе позицию нельзя было бы вернуть
-- в стоп завтра.
create unique index if not exists stoplist_active_uniq
  on public.stoplist_items (filial, area, lower(name)) where (resolved_at is null);

-- Основная выборка — активные позиции филиала; история читается по created_at.
create index if not exists stoplist_active_idx
  on public.stoplist_items (filial, resolved_at, created_at desc);

-- ===== RLS =====
-- Кто правит: управляющий и менеджер — обе области; повар — только кухню,
-- бармен — только бар (сопоставление цеха и области здесь и в js/stoplist.js
-- должно совпадать: STOPLIST_DEPT_AREA).

alter table public.stoplist_items enable row level security;

-- Видят все сотрудники: лист бесполезен, если официант его не видит.
drop policy if exists stoplist_select on public.stoplist_items;
create policy stoplist_select on public.stoplist_items for select to authenticated
  using (true);

drop policy if exists stoplist_insert on public.stoplist_items;
create policy stoplist_insert on public.stoplist_items for insert to authenticated
  with check (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
    or exists (select 1 from public.profiles p
                 join public.employees e on e.id = p.employee_id
               where p.user_id = auth.uid()
                 and ((e.department = 'Повара'  and stoplist_items.area = 'kitchen')
                   or (e.department = 'Бармены' and stoplist_items.area = 'bar')))
  );

-- Снятие позиции — это update (resolved_at), правила те же, что и на постановку.
drop policy if exists stoplist_update on public.stoplist_items;
create policy stoplist_update on public.stoplist_items for update to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
    or exists (select 1 from public.profiles p
                 join public.employees e on e.id = p.employee_id
               where p.user_id = auth.uid()
                 and ((e.department = 'Повара'  and stoplist_items.area = 'kitchen')
                   or (e.department = 'Бармены' and stoplist_items.area = 'bar')))
  )
  with check (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
    or exists (select 1 from public.profiles p
                 join public.employees e on e.id = p.employee_id
               where p.user_id = auth.uid()
                 and ((e.department = 'Повара'  and stoplist_items.area = 'kitchen')
                   or (e.department = 'Бармены' and stoplist_items.area = 'bar')))
  );

-- Удаление (не снятие, а стирание из истории) — только руководство.
drop policy if exists stoplist_delete on public.stoplist_items;
create policy stoplist_delete on public.stoplist_items for delete to authenticated
  using (exists (select 1 from public.profiles p
                  where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));
