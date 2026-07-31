-- Разовая ТРЕНИРОВОЧНАЯ аттестация Соснину Владиславу: 30 вопросов, не в учёт.
--
-- Ставим назначение вручную (а не через quiz_assign) потому, что функция проверяет
-- роль вызывающего по auth.uid(), а миграция идёт от имени сервиса.
--
-- Что это даёт: тест открывается на Главной сразу, в любой день; 30 случайных
-- вопросов; порог «сдал» 24 из 30. Результат помечен practice — в проценты за
-- неделю он не идёт и субботнюю зачётную попытку не расходует.
-- Назначение одноразовое: quiz_start() гасит его при старте.

insert into public.quiz_attempts (employee_id, employee_name, filial, week_start, date,
                                  question_ids, q_total, practice, superseded)
select e.id, e.name, coalesce(e.filials[1],'chekhov'),
       week_start_of(business_today()), business_today(),
       '{}'::bigint[], 30, true, true
  from public.employees e
 where e.name = 'Соснин Владислав Николаевич'
   and not exists (
     select 1 from public.quiz_attempts a
      where a.employee_id = e.id
        and a.week_start = week_start_of(business_today())
        and a.superseded and cardinality(a.question_ids) = 0 and a.finished_at is null
   );
