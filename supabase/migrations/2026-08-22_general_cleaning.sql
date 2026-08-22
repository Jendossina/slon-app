-- Генеральная уборка: запуск, раздача работ по цехам, отметки и фото.
--
-- Как это происходит вживую: по субботам в Чехове и по воскресеньям в Истикболе
-- заведение убирают целиком. Раньше менеджер раздавал работы на словах, и к
-- концу смены никто не помнил, кто мыл вытяжку и мыл ли вообще.
--
-- Устроено по образцу инвентаризации посуды: одна открытая уборка на филиал
-- (частичный уникальный индекс), запускает руководство, дальше каждый видит
-- свои пункты и отмечает их сам.
--
-- Решения владельца (22.08.2026):
--   • список работ редактируется и СВОЙ у каждого филиала — залы разные;
--   • пункты раздаются по цехам: бар барменам, кухня поварам, зал официантам;
--   • участников менеджер отмечает галочками при запуске, список берётся из
--     графика на этот день;
--   • фото к пункту по желанию, а не обязательно.

-- ===== Справочник работ =====
create table if not exists public.cleaning_tasks (
  id          bigserial primary key,
  filial      text    not null,
  text        text    not null,
  department  text,                       -- чей цех убирает; null = любой участник
  sort        integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists cleaning_tasks_filial_idx on public.cleaning_tasks (filial, sort);

-- ===== Запуск уборки =====
create table if not exists public.cleanings (
  id              bigserial primary key,
  filial          text not null,
  date            date not null default public.business_today(),
  status          text not null default 'open' check (status in ('open','done','cancelled')),
  started_by      uuid,
  started_by_name text,
  started_at      timestamptz not null default now(),
  closed_by       uuid,
  closed_by_name  text,
  closed_at       timestamptz
);
-- Две открытые уборки на филиал — это два списка и раздвоенная ответственность
create unique index if not exists cleanings_one_open
  on public.cleanings (filial) where status = 'open';

-- ===== Работа, доставшаяся человеку =====
-- Текст пункта копируем в строку намеренно: справочник потом правят, а отчёт о
-- прошлой уборке обязан показывать то, что человек тогда делал.
create table if not exists public.cleaning_items (
  id            bigserial primary key,
  cleaning_id   bigint not null references public.cleanings(id) on delete cascade,
  task_id       bigint,
  task_text     text not null,
  department    text,
  employee_id   bigint,
  employee_name text,
  done          boolean not null default false,
  done_at       timestamptz,
  done_by_name  text,
  media         jsonb,
  sort          integer not null default 0
);
create index if not exists cleaning_items_cleaning_idx on public.cleaning_items (cleaning_id, sort);

alter table public.cleaning_tasks enable row level security;
alter table public.cleanings      enable row level security;
alter table public.cleaning_items enable row level security;

-- Видят все: сотруднику нужно знать не только своё, но и чью работу он ждёт
drop policy if exists cleaning_tasks_select on public.cleaning_tasks;
create policy cleaning_tasks_select on public.cleaning_tasks for select to authenticated using (true);
drop policy if exists cleanings_select on public.cleanings;
create policy cleanings_select on public.cleanings for select to authenticated using (true);
drop policy if exists cleaning_items_select on public.cleaning_items;
create policy cleaning_items_select on public.cleaning_items for select to authenticated using (true);

-- Список работ и запуск — руководство
drop policy if exists cleaning_tasks_write on public.cleaning_tasks;
create policy cleaning_tasks_write on public.cleaning_tasks for all to authenticated
  using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])))
  with check (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));
drop policy if exists cleanings_write on public.cleanings;
create policy cleanings_write on public.cleanings for all to authenticated
  using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])))
  with check (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

-- Отметить сделанным может тот, кому работа досталась, и руководство.
-- Чужую галочку не поставить: иначе смысл раздачи теряется.
drop policy if exists cleaning_items_update on public.cleaning_items;
create policy cleaning_items_update on public.cleaning_items for update to authenticated
  using (
    employee_id = public.my_employee_id()
    or exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
  );

-- ===== Запуск с раздачей по цехам =====
-- Раздаём внутри цеха по кругу: первый пункт бара — первому бармену, второй —
-- второму, третий снова первому. Так работа делится ровно, а не сваливается на
-- того, кто первым попался.
--
-- Пункт цеха, из которого сегодня никто не вышел, остаётся без исполнителя —
-- намеренно: молча отдать мойку кухни официанту хуже, чем показать менеджеру
-- строку «некому» и дать назначить руками.
create or replace function public.cleaning_start(p_filial text, p_employee_ids bigint[])
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id     bigint;
  t        record;
  v_people bigint[];
  v_idx    integer;
  v_next   jsonb := '{}'::jsonb;
  v_key    text;
  v_emp    bigint;
  v_name   text;
  v_sort   integer := 0;
begin
  if not exists (select 1 from profiles p
                  where p.user_id = auth.uid() and p.role = any(array['admin','manager'])) then
    raise exception 'Запускать генеральную уборку может только руководство';
  end if;

  insert into cleanings (filial, started_by, started_by_name)
  values (p_filial, auth.uid(),
          coalesce((select name from profiles where user_id = auth.uid()), '—'))
  returning id into v_id;

  for t in
    select * from cleaning_tasks
     where filial = p_filial and is_active
     order by coalesce(department,'я'), sort, id
  loop
    v_key := coalesce(t.department, '*');

    -- Участники этого цеха среди отмеченных менеджером. Пункт без цеха
    -- достаётся любому из участников — по тому же кругу.
    select array_agg(e.id order by e.name) into v_people
      from employees e
     where e.id = any(p_employee_ids)
       and (t.department is null or e.department = t.department);

    v_emp := null; v_name := null;
    if v_people is not null and array_length(v_people, 1) > 0 then
      v_idx := coalesce((v_next->>v_key)::int, 0);
      v_emp := v_people[(v_idx % array_length(v_people, 1)) + 1];
      select name into v_name from employees where id = v_emp;
      v_next := v_next || jsonb_build_object(v_key, v_idx + 1);
    end if;

    v_sort := v_sort + 1;
    insert into cleaning_items (cleaning_id, task_id, task_text, department,
                                employee_id, employee_name, sort)
    values (v_id, t.id, t.text, t.department, v_emp, v_name, v_sort);
  end loop;

  return v_id;
end $$;

-- Отметку ставит только тот, кому работа досталась (или руководство) — это же
-- сторожит политика; здесь проставляем время и имя, чтобы в отчёте было видно,
-- кто и когда закрыл пункт.
create or replace function public.cleaning_item_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.done and not coalesce(OLD.done, false) then
    NEW.done_at := now();
    NEW.done_by_name := coalesce((select name from profiles where user_id = auth.uid()), NEW.employee_name);
  elsif not NEW.done then
    NEW.done_at := null;
    NEW.done_by_name := null;
  end if;
  return NEW;
end $$;

drop trigger if exists cleaning_item_guard_trg on public.cleaning_items;
create trigger cleaning_item_guard_trg
  before update on public.cleaning_items
  for each row execute function public.cleaning_item_guard();
