-- С 12.11.2026 график пишут и правят только менеджеры (и управляющий).
-- Старшие цехов больше не редактируют график своего отдела.
--
-- can_edit_schedule_of остаётся как есть: на ней держится видимость и решение
-- заявок на замену/опоздание (shift_requests_select / _update) для шефов цехов.
-- Одобренная заявка меняет график через shift_requests_decide (security definer,
-- владелец postgres обходит RLS), поэтому замены работают и дальше.
create or replace function public.can_write_schedules()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles p
     where p.user_id = auth.uid() and p.role = any(array['admin','manager'])
  );
$$;
revoke all on function public.can_write_schedules() from public, anon;
grant execute on function public.can_write_schedules() to authenticated;

drop policy if exists schedules_write on public.schedules;
create policy schedules_write on public.schedules for insert to authenticated
  with check (public.can_write_schedules());

drop policy if exists schedules_update on public.schedules;
create policy schedules_update on public.schedules for update to authenticated
  using (public.can_write_schedules())
  with check (public.can_write_schedules());

drop policy if exists schedules_delete on public.schedules;
create policy schedules_delete on public.schedules for delete to authenticated
  using (public.can_write_schedules());
