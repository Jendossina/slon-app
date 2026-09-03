-- Приоритет задачи: обычная / важная / срочная.
--
-- Хранится числом, а не текстом, по одной причине: список сортирует база, а
-- текстовые коды она отсортирует по алфавиту (high, normal, urgent) — пришлось
-- бы городить CASE в каждом запросе. Число сортируется само.
--   0 — обычная (по умолчанию, все прежние задачи такие)
--   1 — важная
--   2 — срочная
-- Названия, цвета и значки живут на клиенте (TASK_PRIORITY в js/tasks.js) —
-- как уровни должностей и дни аттестации: в базе число, в интерфейсе слово.
--
-- «Срочную» ставит только руководство и владелец. Иначе через месяц срочным
-- станет всё: пометка ценна ровно до тех пор, пока её ставят редко. Правило
-- стоит в политике на вставку, а не только в интерфейсе.

alter table public.tasks
  add column if not exists priority smallint not null default 0;

alter table public.tasks
  drop constraint if exists tasks_priority_range;
alter table public.tasks
  add constraint tasks_priority_range check (priority between 0 and 2);

comment on column public.tasks.priority is
  '0 обычная, 1 важная, 2 срочная. Срочную ставит только admin/manager/boss.';

-- Список фильтруется по дате и сортируется по приоритету внутри дня
create index if not exists tasks_due_priority_idx
  on public.tasks (due_date, priority desc);

create or replace function public.can_set_urgent()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles p
     where p.user_id = auth.uid()
       and p.role = any(array['admin','manager','boss'])
  );
$$;

revoke all on function public.can_set_urgent() from public, anon;
grant execute on function public.can_set_urgent() to authenticated;

-- Проверку срочности вешаем на вставку. На обновление не вешаем намеренно:
-- политика не видит старое значение, и правило «нельзя срочную» заодно
-- запретило бы исполнителю закрыть уже поставленную срочную задачу.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    public.can_assign_task_to(assigned_to_id)
    and (coalesce(priority, 0) < 2 or public.can_set_urgent())
  );
