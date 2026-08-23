-- Признак «ставить в график».
--
-- Сетка графика показывает всех, у кого заполнен цех. Цех же выдаёт права
-- старшего и уведомления по своим людям — поэтому у шефа бармена и шефа
-- кальянной станции он обязан быть заполнен (см. миграцию
-- 2026-08-21_department_from_role: у Игоря его трижды стирали, и он терял
-- права и уведомления). Из-за этого руководители цехов каждую неделю
-- всплывали в графике пустыми строками, хотя смен не работают вовсе — ни
-- одной строки в schedules у них нет и не было.
--
-- Разводим два смысла: цех остаётся «чьи люди», а новый флаг отвечает за
-- «выходит в смены». По умолчанию true — обычный сотрудник в графике.

alter table public.employees
  add column if not exists in_schedule boolean not null default true;

comment on column public.employees.in_schedule is
  'Показывать в сетке графика и в выборе сотрудника для смены. false — руководитель цеха, который смен не работает.';

-- Шеф бармен и шеф кальянной станции смен не работают.
update public.employees
   set in_schedule = false
 where role in ('Шеф бармен', 'Шеф кальянной станции');

-- Представление отдаёт флаг клиенту: сетка графика читает именно его.
create or replace view public.employees_view as
 SELECT id,
    name,
    role,
    department,
    phone,
    status,
    filials,
    created_at,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM profiles p
              WHERE p.user_id = auth.uid() AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])))) OR id = (( SELECT p2.employee_id
               FROM profiles p2
              WHERE p2.user_id = auth.uid())) THEN salary
            ELSE NULL::double precision
        END AS salary,
    -- новая колонка идёт последней: create or replace view умеет только
    -- дописывать в конец, вставка в середину ломает замену
    in_schedule
   FROM employees e;
