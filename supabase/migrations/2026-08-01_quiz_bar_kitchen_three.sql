-- Разовая ТРЕНИРОВОЧНАЯ аттестация на 30 вопросов ТОЛЬКО по бару и кухне —
-- Атаханову, Вахабову и Соснину.
--
-- Ставим назначение напрямую, а не через quiz_assign(), потому что функция
-- проверяет роль вызывающего по auth.uid(), а миграция идёт от имени сервиса.
--
-- Что это даёт: тест открывается на Главной сразу, в любой день; 30 случайных
-- вопросов из областей kitchen и bar (вопросы про стандарт обслуживания зала
-- не попадут); порог «сдал» — 24 из 30. Результат помечен practice: в проценты
-- за неделю не идёт и субботнюю зачётную попытку не расходует.
-- Назначение одноразовое: quiz_start() гасит его при старте.
--
-- Требует применённой миграции 2026-08-01_quiz_areas.sql.

insert into public.quiz_attempts (employee_id, employee_name, filial, week_start, date,
                                  question_ids, q_total, practice, areas, superseded)
select e.id, e.name, coalesce(e.filials[1],'chekhov'),
       week_start_of(business_today()), business_today(),
       '{}'::bigint[], 30, true, array['kitchen','bar'], true
  from public.employees e
 where e.name in ('Атаханов Агабек Пайзуллаевич',
                  'Вахабов Даврон Равшанович',
                  'Соснин Владислав Николаевич')
   and not exists (
     select 1 from public.quiz_attempts a
      where a.employee_id = e.id
        and a.week_start = week_start_of(business_today())
        and a.superseded and cardinality(a.question_ids) = 0 and a.finished_at is null
   );
