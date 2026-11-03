-- employees_view: закрыть запись и анонимное чтение, ставки — владельцу.
--
-- 1. ДЫРА (найдена 03.11.2026). Представление создано владельцем таблиц и
--    обходит RLS у employees, а Postgres делает такие простые представления
--    обновляемыми. У anon и authenticated были INSERT/UPDATE/DELETE, поэтому
--    любой сотрудник — и кто угодно с публичным ключом сайта, без входа, —
--    мог переписать карточки всех сотрудников (должность, отдел, телефон,
--    статус, филиалы). Проверено в откатываемой транзакции: рядовой сотрудник
--    через представление задевал 61 строку, через саму таблицу — 0. И anon
--    читал имена и телефоны всех сотрудников.
--    Приложение представление только читает, и только после входа.
--
-- 2. Владелец (boss) не видел ставок: в интерфейсе ведомость ему открыта
--    (canSeeSalaryRole), а база отдавала salary = null, и ФОТ в дашборде
--    «Касса» у него был бы нулевым. Владелец 03.11.2026: кассу, ФОТ и средний
--    чек видят управляющие и владелец.

revoke all on public.employees_view from anon;
revoke insert, update, delete, truncate, references, trigger on public.employees_view from authenticated;
grant select on public.employees_view to authenticated;

create or replace view public.employees_view as
 select id, name, role, department, phone, status, filials, created_at,
        case
          when exists (select 1 from public.profiles p
                        where p.user_id = auth.uid() and p.role = any (array['admin', 'manager', 'boss']))
            or id = (select p2.employee_id from public.profiles p2 where p2.user_id = auth.uid())
          then salary
          else null::double precision
        end as salary,
        in_schedule
   from public.employees e;
