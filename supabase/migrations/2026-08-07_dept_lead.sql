-- Старший цеха ведёт свой отдел, не получая прав управляющего.
--
-- Повод: Самариддину завели карточку управляющего, чтобы он мог вести кальянную
-- станцию. Управляющий видит и правит всё — финансы, зарплаты, чужие цеха,
-- учётные записи. Нужно ровно обратное: полный хозяин внутри своего отдела и
-- никакого доступа за его пределами.
--
-- Механизм в приложении уже был — старшие цеха ведут график своего отдела
-- (can_edit_schedule_of, миграция 2026-08-03). Здесь тот же принцип
-- распространяется на карточки сотрудников и статьи Базы знаний.
--
-- Списки должностей обязаны совпадать с DEPT_LEADS в js/core.js.

create or replace function public.is_dept_lead(p_dept text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_dept is not null and exists (
    select 1
      from profiles p
      join employees me on me.id = p.employee_id
     where p.user_id = auth.uid()
       and coalesce(me.status, 'Активен') <> 'Уволен'
       and me.department = p_dept
       and (
         (p_dept = 'Бармены'           and me.role = any(array['Старший бармен','Бар менеджер','Шеф бармен'])) or
         (p_dept = 'Повара'            and me.role = any(array['Су-шеф','Шеф повар'])) or
         (p_dept = 'Кальянные мастера' and me.role = any(array['Старший кальянный мастер','Шеф кальянной станции']))
       )
  );
$$;

revoke all on function public.is_dept_lead(text) from public, anon;
grant execute on function public.is_dept_lead(text) to authenticated;

-- ===== Карточки сотрудников =====
-- Старший может править своих. Заводить и удалять людей — по-прежнему нет:
-- это решение руководства, а не цеха.
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update
using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
  or public.is_dept_lead(employees.department)
)
with check (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
  or public.is_dept_lead(employees.department)
);

-- Что именно старшему менять нельзя. Политика проверяет строку целиком, а не
-- отдельные поля, поэтому лишнее возвращает триггер — тем же приёмом, что и
-- attendance_guard: ставка, должность и отдел откатываются к прежним значениям.
-- Иначе старший цеха мог бы поднять себе ставку или перевести человека к себе.
create or replace function public.employees_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_privileged boolean;
begin
  select exists (
    select 1 from profiles p
     where p.user_id = auth.uid() and p.role = any(array['admin','manager'])
  ) into v_privileged;

  if v_privileged or auth.uid() is null then
    return NEW;                       -- руководство и служебные правки — без ограничений
  end if;

  NEW.salary     := OLD.salary;       -- деньги — не к цеху
  NEW.role       := OLD.role;         -- должность = ставка, меняет руководство
  NEW.department := OLD.department;   -- переводить людей между цехами нельзя
  return NEW;
end $$;

drop trigger if exists employees_guard_trg on public.employees;
create trigger employees_guard_trg
  before update on public.employees
  for each row execute function public.employees_guard();

-- ===== База знаний =====
-- Право на статьи задаётся у книги (миграция 2026-08-05). Добавляем третий
-- вариант: книгу ведёт старший конкретного цеха.
alter table public.kb_books add column if not exists edit_dept text;

drop policy if exists kb_articles_write on public.kb_articles;
create policy kb_articles_write on public.kb_articles for all
using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'admin')
  or exists (
    select 1 from profiles p join kb_books b on b.id = kb_articles.book_id
     where p.user_id = auth.uid() and p.role = 'manager' and b.edit_role = 'manager')
  or exists (
    select 1 from kb_books b
     where b.id = kb_articles.book_id and public.is_dept_lead(b.edit_dept))
)
with check (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'admin')
  or exists (
    select 1 from profiles p join kb_books b on b.id = kb_articles.book_id
     where p.user_id = auth.uid() and p.role = 'manager' and b.edit_role = 'manager')
  or exists (
    select 1 from kb_books b
     where b.id = kb_articles.book_id and public.is_dept_lead(b.edit_dept))
);
