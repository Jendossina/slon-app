-- Владелец ставит задачи кому угодно.
--
-- BOSS заведён как наблюдатель: смотрит всё, не правит ничего. Для отчётов это
-- верно, но поручение — не правка чужой записи, а его прямая работа, и до сих
-- пор он мог только попросить менеджера завести задачу за себя.
--
-- Наблюдателем он остаётся во всём остальном: отмечать выполнение, править
-- карточки и финансы по-прежнему нельзя. Снять он может только свою задачу —
-- это уже разрешает tasks_delete по created_by.

create or replace function public.can_assign_task_to(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- руководство и владелец — кому угодно
  select exists (
      select 1 from profiles p
       where p.user_id = auth.uid() and p.role = any(array['admin','manager','boss'])
    )
    -- старший цеха — своему отделу и менеджерам
    or exists (
      select 1
        from profiles  me_p
        join employees me  on me.id = me_p.employee_id
        join profiles  t_p on t_p.user_id = p_user
        join employees t   on t.id = t_p.employee_id
       where me_p.user_id = auth.uid()
         and public.is_dept_lead(me.department)
         and (t.department = me.department or t.department = 'Менеджеры')
    );
$$;

comment on function public.can_assign_task_to(uuid) is
  'Может ли текущий пользователь поставить задачу этому сотруднику: руководство и владелец — всем, старший цеха — своему отделу и менеджерам.';
