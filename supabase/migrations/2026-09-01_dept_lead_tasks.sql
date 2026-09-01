-- Старший цеха ставит задачи своим людям.
--
-- Было: вставку в tasks разрешала политика только admin и manager. Старший
-- бармен, су-шеф, старший кальянщик давно ведут график своего цеха и правят
-- карточки своих людей, а поручить им работу не могли — шли просить менеджера.
-- Восемь человек упирались в это каждый день.
--
-- Стало: право даёт та же связка «отдел + должность», что и в графике
-- (is_dept_lead). Чужой отдел закрыт: границей служит отдел получателя задачи,
-- а не доверие к клиенту. На клиенте то же правило (canCreateTasks и фильтр
-- цеха в форме) — списки обязаны совпадать.

create or replace function public.can_assign_task_to(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- руководство — кому угодно
  select exists (
      select 1 from profiles p
       where p.user_id = auth.uid() and p.role = any(array['admin','manager'])
    )
    -- старший цеха — только своему отделу
    or exists (
      select 1
        from profiles  me_p
        join employees me  on me.id = me_p.employee_id
        join profiles  t_p on t_p.user_id = p_user
        join employees t   on t.id = t_p.employee_id
       where me_p.user_id = auth.uid()
         and public.is_dept_lead(me.department)
         and t.department = me.department
    );
$$;

comment on function public.can_assign_task_to(uuid) is
  'Может ли текущий пользователь поставить задачу этому сотруднику: руководство — всем, старший цеха — своему отделу.';

revoke all on function public.can_assign_task_to(uuid) from public, anon;
grant execute on function public.can_assign_task_to(uuid) to authenticated;

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.can_assign_task_to(assigned_to_id));
