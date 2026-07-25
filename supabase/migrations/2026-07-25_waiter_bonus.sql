-- Проценты официантов (до 2% от личной выручки за неделю, 4 блока по 0,5%).
-- Пороги и расчёт живут в js/core.js (WAITER_BONUS / computeWaiterBonus).

-- 1) Штрафные баллы: сервис/стандарты и дисциплина. Ставит администратор/управляющий.
create table if not exists public.waiter_points (
  id              bigserial primary key,
  employee_id     bigint not null references public.employees(id) on delete cascade,
  employee_name   text,
  filial          text not null,
  date            date not null,                       -- кассовый день (businessToday)
  category        text not null check (category in ('service','discipline')),
  points          integer not null default 1 check (points > 0),
  reason          text,                                -- код причины (см. WAITER_POINT_REASONS)
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists waiter_points_week_idx on public.waiter_points (filial, date);
create index if not exists waiter_points_emp_idx  on public.waiter_points (employee_id, date);

-- 2) Недельные показатели официанта: выручка без кальяна + цифры из iiko + балл аттестации.
create table if not exists public.waiter_week_stats (
  id                bigserial primary key,
  employee_id       bigint not null references public.employees(id) on delete cascade,
  employee_name     text,
  filial            text not null,
  week_start        date not null,                     -- понедельник недели
  revenue           numeric not null default 0,        -- личная выручка БЕЗ кальяна
  checks            integer not null default 0,
  dishes            integer not null default 0,
  desserts          integer not null default 0,
  attestation_score integer,                           -- балл из 100; null = аттестация не проводилась
  updated_by        uuid,
  updated_by_name   text,
  updated_at        timestamptz not null default now(),
  unique (employee_id, week_start)
);
create index if not exists waiter_week_stats_idx on public.waiter_week_stats (filial, week_start);

alter table public.waiter_points     enable row level security;
alter table public.waiter_week_stats enable row level security;

-- Политики — тем же паттерном, что у premiums: по одной на команду, роль берём из profiles.
-- Отличие от premiums: читать может ещё и сам официант, но ТОЛЬКО свои строки —
-- экран «Проценты» показывает ему собственный прогресс, чужие показатели не отдаём.

drop policy if exists waiter_points_select on public.waiter_points;
create policy waiter_points_select on public.waiter_points for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager','boss']))
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.employee_id = waiter_points.employee_id)
  );

drop policy if exists waiter_points_insert on public.waiter_points;
create policy waiter_points_insert on public.waiter_points for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

drop policy if exists waiter_points_delete on public.waiter_points;
create policy waiter_points_delete on public.waiter_points for delete to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

drop policy if exists waiter_week_stats_select on public.waiter_week_stats;
create policy waiter_week_stats_select on public.waiter_week_stats for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager','boss']))
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.employee_id = waiter_week_stats.employee_id)
  );

drop policy if exists waiter_week_stats_insert on public.waiter_week_stats;
create policy waiter_week_stats_insert on public.waiter_week_stats for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

-- update нужен отдельно: показатели недели сохраняются через upsert (insert + update)
drop policy if exists waiter_week_stats_update on public.waiter_week_stats;
create policy waiter_week_stats_update on public.waiter_week_stats for update to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

drop policy if exists waiter_week_stats_delete on public.waiter_week_stats;
create policy waiter_week_stats_delete on public.waiter_week_stats for delete to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));
