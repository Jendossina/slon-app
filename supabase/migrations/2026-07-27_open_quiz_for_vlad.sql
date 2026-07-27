-- Разовое открытие аттестации официанту Соснину Владиславу вне субботы.
--
-- Как это работает: quiz_start() пускает вне субботы, если на текущей неделе есть
-- ПОГАШЕННАЯ попытка — это и есть «разрешение на пересдачу», которое ставит админ.
-- У Влада на этой неделе попыток нет вообще, поэтому создаём саму метку-разрешение.
-- Уникальный индекс на попытки частичный (where not superseded), так что погашенная
-- строка не мешает ему потом создать настоящую.
--
-- Одноразово: пройдёт тест — появится обычная непогашенная попытка, и второй раз
-- без нового разрешения он уже не зайдёт.

insert into public.quiz_attempts (employee_id, employee_name, filial, week_start, date, question_ids, superseded)
select e.id, e.name, 'chekhov', week_start_of(business_today()), business_today(), '{}'::bigint[], true
  from public.employees e
 where e.name = 'Соснин Владислав Николаевич'
   and not exists (
     select 1 from public.quiz_attempts a
      where a.employee_id = e.id and a.week_start = week_start_of(business_today())
   );
