-- Старший цеха ставит задачи ещё и менеджерам.
--
-- Задача снизу вверх — обычное дело: у бара кончился сироп, сломалась мойка,
-- нужен заказ. Раньше старший мог поручить работу только внутри своего цеха,
-- а до менеджера это доходило голосом и терялось.
--
-- Отдел «Менеджеры» открыт всем старшим целиком. Управляющий и BOSS сюда не
-- попадают: они заведены без отдела, и это намеренно — им задачи не ставят.

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
  'Может ли текущий пользователь поставить задачу этому сотруднику: руководство — всем, старший цеха — своему отделу и менеджерам.';
