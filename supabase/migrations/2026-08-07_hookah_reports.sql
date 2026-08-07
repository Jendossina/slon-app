-- 1) Старший цеха получает внутри своего отдела права уровня руководства
--    (решение владельца: «права как у меня, но только в сторону кальянщиков»).
-- 2) Отчёт по кальянам за день: сколько продано и на какую сумму, с фото.

-- ===== 1. Полные права внутри своего цеха =====
-- Было: старший правил только имя/телефон/статус/филиалы, а ставку и должность
-- откатывал триггер. Теперь он ведёт своих людей целиком — включая ставку и
-- должность. Две границы остаются:
--   • свою собственную ставку поднять нельзя (иначе это уже не управление цехом);
--   • отдел не меняется — переводить людей между цехами решает руководство.
create or replace function public.employees_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_privileged boolean; v_self boolean;
begin
  select exists (
    select 1 from profiles p
     where p.user_id = auth.uid() and p.role = any(array['admin','manager'])
  ) into v_privileged;

  if v_privileged or auth.uid() is null then
    return NEW;                       -- руководство и служебные правки — без ограничений
  end if;

  select exists (
    select 1 from profiles p where p.user_id = auth.uid() and p.employee_id = OLD.id
  ) into v_self;

  if v_self then
    NEW.salary := OLD.salary;         -- себе ставку не поднимаем
    NEW.role   := OLD.role;
  end if;
  NEW.department := OLD.department;   -- цех человека меняет только руководство
  return NEW;
end $$;

-- Заводить людей в свой цех старший тоже может: новый кальянщик — забота станции.
drop policy if exists employees_write on public.employees;
create policy employees_write on public.employees for insert
with check (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
  or public.is_dept_lead(employees.department)
);

-- Удаление своих — тоже (в приложении оно нужно ещё и для отката, когда логин
-- не создался и карточка осталась бы сиротой).
drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees for delete
using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
  or public.is_dept_lead(employees.department)
);

-- Учётная запись новому сотруднику. Старший заводит только рядовых: выдать
-- кому-то права управляющего он не может — иначе это обход собственных границ.
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
with check (
  ((user_id = auth.uid()) and (role = 'admin') and not exists (select 1 from profiles p2 where p2.role = 'admin'))
  or exists (select 1 from profiles p2 where p2.user_id = auth.uid() and p2.role = any(array['admin','manager']))
  or (
    role = 'employee'
    and exists (select 1 from employees e where e.id = profiles.employee_id and public.is_dept_lead(e.department))
  )
);

-- ===== 2. Отчёт по кальянам =====
-- Кальянный мастер в конце смены вносит: сколько кальянов продано, на какую
-- сумму и фото — как касса, только по своей станции. Одна запись на день и
-- филиал: повторное внесение правит ту же строку, иначе выручка задвоится.
create table if not exists public.hookah_reports (
  id              bigserial primary key,
  date            date not null default public.business_today(),
  filial          text not null,
  count           integer not null default 0,
  amount          numeric not null default 0,
  photo_url       text,
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (date, filial)
);

alter table public.hookah_reports enable row level security;

-- Кто ведёт кальянную станцию: сами мастера своего филиала, старший цеха и
-- руководство. Владелец — только смотрит.
create or replace function public.is_hookah_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join employees e on e.id = p.employee_id
     where p.user_id = auth.uid()
       and e.department = 'Кальянные мастера'
       and coalesce(e.status,'Активен') <> 'Уволен'
  );
$$;
revoke all on function public.is_hookah_staff() from public, anon;
grant execute on function public.is_hookah_staff() to authenticated;

drop policy if exists hookah_select on public.hookah_reports;
create policy hookah_select on public.hookah_reports for select
using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager','boss']))
  or public.is_hookah_staff()
);

drop policy if exists hookah_write on public.hookah_reports;
create policy hookah_write on public.hookah_reports for insert
with check (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
  or public.is_hookah_staff()
);

drop policy if exists hookah_update on public.hookah_reports;
create policy hookah_update on public.hookah_reports for update
using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
  or public.is_hookah_staff()
)
with check (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
  or public.is_hookah_staff()
);

-- Удалять отчёты — только руководство: цифры за день, за ними идут деньги.
drop policy if exists hookah_delete on public.hookah_reports;
create policy hookah_delete on public.hookah_reports for delete
using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

-- Дату ставит сервер: часы телефона можно перевести, и отчёт уедет на другой день
create or replace function public.hookah_report_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    NEW.date := coalesce(NEW.date, public.business_today());
  else
    NEW.date := OLD.date;
    NEW.filial := OLD.filial;
    NEW.updated_at := now();
  end if;
  return NEW;
end $$;

drop trigger if exists hookah_report_guard_trg on public.hookah_reports;
create trigger hookah_report_guard_trg
  before insert or update on public.hookah_reports
  for each row execute function public.hookah_report_guard();
