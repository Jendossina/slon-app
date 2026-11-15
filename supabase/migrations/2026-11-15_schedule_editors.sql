-- 15.11.2026 владелец вернул право вести график двум старшим — только их цех:
--   Доос Никита (бар-менеджер, id 44)  → Бармены
--   Макаев Дамир (шеф-повар, id 154)   → Повара
-- Остальные старшие цехов график по-прежнему не правят (см. 2026-11-12_schedule_managers_only.sql).
-- Список дублируется в js/core.js (SCHEDULE_EDITORS) — менять в обоих местах.
create table if not exists public.schedule_editors (
  employee_id bigint primary key references public.employees(id) on delete cascade,
  department  text not null
);
alter table public.schedule_editors enable row level security;
insert into public.schedule_editors (employee_id, department) values (44, 'Бармены'), (154, 'Повара')
  on conflict (employee_id) do update set department = excluded.department;

create or replace function public.can_write_schedule_of(p_employee_id bigint)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select public.can_write_schedules()
      or exists (
        select 1
          from profiles p
          join schedule_editors se on se.employee_id = p.employee_id
          join employees target on target.id = p_employee_id
         where p.user_id = auth.uid() and target.department = se.department
      );
$$;
revoke all on function public.can_write_schedule_of(bigint) from public, anon;
grant execute on function public.can_write_schedule_of(bigint) to authenticated;

drop policy if exists schedules_write on public.schedules;
create policy schedules_write on public.schedules for insert to authenticated
  with check (public.can_write_schedule_of(employee_id));
drop policy if exists schedules_update on public.schedules;
create policy schedules_update on public.schedules for update to authenticated
  using (public.can_write_schedule_of(employee_id)) with check (public.can_write_schedule_of(employee_id));
drop policy if exists schedules_delete on public.schedules;
create policy schedules_delete on public.schedules for delete to authenticated
  using (public.can_write_schedule_of(employee_id));
