-- График своего цеха: старшие смогли не только видеть кнопки, но и сохранять.
--
-- Что было: приложение (canEditScheduleDept в js/core.js) уже разрешало старшему
-- бармену, су-шефу и старшему кальянщику вести график своего отдела — кнопки и
-- ячейки им показывались. А политики на schedules пускали к записи только
-- profiles.role in ('admin','manager'), и у старшего бармена роль employee.
-- Insert отклонялся, delete молча удалял ноль строк — человек нажимал «Сохранить»
-- и ничего не происходило (у Лиона Голубенко, старшего бармена, ровно это).
--
-- Что делаем: право на запись считает одна функция, где перечислены те же цеха
-- и должности, что и в SCHEDULE_DEPT_EDITORS (js/core.js) — списки должны
-- совпадать. Старший правит только свой отдел: смена принадлежит сотруднику,
-- и его department сверяется с department редактора.
--
-- Владелец (boss) правами на запись по-прежнему не обладает — только чтение.

create or replace function public.can_edit_schedule_of(p_employee_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- управляющий и менеджер — любой отдел
    exists (
      select 1 from profiles p
       where p.user_id = auth.uid() and p.role = any(array['admin','manager'])
    )
    -- старший цеха — только сотрудники своего отдела
    or exists (
      select 1
        from profiles p
        join employees me     on me.id = p.employee_id
        join employees target on target.id = p_employee_id
       where p.user_id = auth.uid()
         and me.department = target.department
         and (
              (me.department = 'Бармены'           and me.role = any(array['Старший бармен','Бар менеджер','Шеф бармен']))
           or (me.department = 'Повара'            and me.role = any(array['Су-шеф','Шеф повар']))
           or (me.department = 'Кальянные мастера' and me.role = any(array['Старший кальянный мастер','Шеф кальянной станции']))
         )
    );
$$;

revoke all on function public.can_edit_schedule_of(bigint) from public, anon;
grant execute on function public.can_edit_schedule_of(bigint) to authenticated;

-- Чтение графика оставляем как было — его видят все сотрудники.

drop policy if exists schedules_write on public.schedules;
create policy schedules_write on public.schedules for insert to authenticated
  with check (public.can_edit_schedule_of(schedules.employee_id));

drop policy if exists schedules_update on public.schedules;
create policy schedules_update on public.schedules for update to authenticated
  using (public.can_edit_schedule_of(schedules.employee_id))
  with check (public.can_edit_schedule_of(schedules.employee_id));

drop policy if exists schedules_delete on public.schedules;
create policy schedules_delete on public.schedules for delete to authenticated
  using (public.can_edit_schedule_of(schedules.employee_id));
