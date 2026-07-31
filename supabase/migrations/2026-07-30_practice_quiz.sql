-- Тренировочная аттестация: любое число вопросов, результат НЕ идёт в учёт.
--
-- Зачем: перед настоящей субботней аттестацией официанта иногда нужно прогнать
-- по расширенному тесту (например 30 вопросов) — так видно реальные пробелы.
-- Такой прогон не должен ни тратить недельную попытку, ни сжигать блок «Сервис»,
-- ни влиять на проценты.
--
-- Что меняется:
--   1) у попытки появляются practice (не в учёт) и q_total (сколько вопросов);
--   2) уникальный индекс «одна попытка в неделю» тренировочные не считает —
--      зачётная субботняя попытка остаётся нетронутой;
--   3) назначение (quiz_assign) несёт с собой число вопросов и признак тренировки
--      и РАСХОДУЕТСЯ при старте — назначили один раз, прошёл один раз;
--   4) порог «сдал» больше не константа 8, а 80% от числа вопросов.

-- ===== схема =====

alter table public.quiz_attempts add column if not exists practice boolean not null default false;
alter table public.quiz_attempts add column if not exists q_total  integer;

comment on column public.quiz_attempts.practice is 'тренировочная попытка: в проценты и в недельный зачёт не идёт';
comment on column public.quiz_attempts.q_total  is 'сколько вопросов в попытке (у назначения — сколько назначено)';

-- старым попыткам вопросов ровно столько, сколько в них лежит
update public.quiz_attempts set q_total = cardinality(question_ids)
 where q_total is null and cardinality(question_ids) > 0;

-- Одна незачтённая попытка в неделю — но только среди ЗАЧЁТНЫХ.
-- Тренировочная теперь может лежать рядом и никому не мешать.
drop index if exists public.quiz_attempts_one_per_week;
create unique index if not exists quiz_attempts_one_per_week
  on public.quiz_attempts (employee_id, week_start) where (not superseded and not practice);

-- ===== порог сдачи =====

-- 8 из 10 = 80%. Теперь то же правило для любого числа вопросов.
create or replace function public.quiz_pass_score(p_total integer)
returns integer language sql immutable as $$
  select greatest(1, ceil(coalesce(p_total, 10) * 0.8)::int);
$$;

-- ===== назначение аттестации =====

-- Назначение — это погашенная строка с пустым question_ids: она разрешает старт
-- вне субботы и хранит параметры теста. finished_at на ней = «израсходовано».
create or replace function public.quiz_assign(
  p_employee_id bigint, p_week_start date,
  p_count integer default 10, p_practice boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_dept text; v_filial text; v_had boolean; v_have integer; v_count integer;
begin
  if not exists (select 1 from profiles p
                 where p.user_id = auth.uid() and p.role = any(array['admin','manager'])) then
    return jsonb_build_object('error','forbidden');
  end if;

  v_count := greatest(1, least(coalesce(p_count, 10), 100));

  select e.name, e.department, coalesce(e.filials[1],'chekhov')
    into v_name, v_dept, v_filial from employees e where e.id = p_employee_id;
  if v_name is null then return jsonb_build_object('error','no_employee'); end if;

  -- проверяем банк заранее: иначе официант откроет карточку и получит отказ
  select count(*) into v_have from quiz_questions where status = 'active' and department = v_dept;
  if v_have < v_count then
    return jsonb_build_object('error','not_enough_questions','have',v_have,'need',v_count);
  end if;

  -- Зачётное назначение гасит текущую попытку (результат остаётся в истории).
  -- Тренировочное не трогает её вовсе — иначе «не в учёт» съедало бы сданный тест.
  if p_practice then
    v_had := false;
  else
    v_had := exists (select 1 from quiz_attempts
                      where employee_id = p_employee_id and week_start = p_week_start
                        and not superseded and not practice);
    update quiz_attempts set superseded = true
     where employee_id = p_employee_id and week_start = p_week_start
       and not superseded and not practice;
  end if;

  -- прежние неизрасходованные назначения закрываем, чтобы не копились
  update quiz_attempts set finished_at = now()
   where employee_id = p_employee_id and week_start = p_week_start
     and superseded and cardinality(question_ids) = 0 and finished_at is null;

  insert into quiz_attempts (employee_id, employee_name, filial, week_start, date,
                             question_ids, q_total, practice, superseded)
  values (p_employee_id, v_name, v_filial, p_week_start, business_today(),
          '{}'::bigint[], v_count, p_practice, true);

  return jsonb_build_object('ok', true, 'replaced', v_had, 'count', v_count, 'practice', p_practice);
end $$;

-- Прежняя кнопка «назначить тест / открыть пересдачу» — обычные 10 вопросов в зачёт.
create or replace function public.quiz_reopen(p_employee_id bigint, p_week_start date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return quiz_assign(p_employee_id, p_week_start, 10, false);
end $$;

-- ===== старт =====

create or replace function public.quiz_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp bigint; v_dept text; v_name text; v_filial text;
  v_today date; v_week date;
  v_attempt bigint; v_ids bigint[]; v_qs jsonb;
  v_marker bigint; v_count integer; v_practice boolean;
begin
  select p.employee_id into v_emp from profiles p where p.user_id = auth.uid();
  if v_emp is null then return jsonb_build_object('error','no_employee'); end if;
  select e.department, e.name, coalesce(e.filials[1],'chekhov')
    into v_dept, v_name, v_filial from employees e where e.id = v_emp;

  v_today := business_today();
  v_week  := week_start_of(v_today);

  -- 1) недоигранная попытка — продолжаем её.
  -- Тренировочную доигрываем только в тот же день, иначе брошенная тренировка
  -- в субботу подменила бы собой зачётный тест.
  select a.id, a.question_ids, coalesce(a.q_total, cardinality(a.question_ids)), a.practice
    into v_attempt, v_ids, v_count, v_practice
    from quiz_attempts a
   where a.employee_id = v_emp and a.week_start = v_week
     and a.finished_at is null and cardinality(a.question_ids) > 0
     and (not a.practice or a.date = v_today)
   order by a.started_at desc limit 1;

  if v_attempt is not null then
    select jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'options',q.options))
      into v_qs from quiz_questions q where q.id = any (v_ids);
    return jsonb_build_object('attempt_id', v_attempt, 'questions', v_qs, 'resumed', true,
      'total', v_count, 'pass', quiz_pass_score(v_count), 'practice', v_practice);
  end if;

  -- 2) назначение от руководства: разрешает старт в любой день, расходуется ниже
  select a.id, coalesce(a.q_total, 10), a.practice
    into v_marker, v_count, v_practice
    from quiz_attempts a
   where a.employee_id = v_emp and a.week_start = v_week
     and a.superseded and cardinality(a.question_ids) = 0 and a.finished_at is null
   order by a.started_at desc limit 1;

  -- 3) без назначения — обычный порядок: суббота и одна зачётная попытка в неделю
  if v_marker is null then
    if exists (select 1 from quiz_attempts a
                where a.employee_id = v_emp and a.week_start = v_week
                  and not a.superseded and not a.practice and a.finished_at is not null) then
      return jsonb_build_object('error','already_done');
    end if;
    if extract(isodow from v_today) <> 6 then
      return jsonb_build_object('error','not_saturday');
    end if;
    v_count := 10; v_practice := false;
  end if;

  -- Сначала по одному вопросу из каждой темы (в случайном порядке), и только
  -- если тем не хватило — добираем вторыми вопросами из тех же тем.
  with pool as (
    select q.id, q.question, q.options, coalesce(q.topic, 'q' || q.id::text) as topic
      from quiz_questions q
     where q.status = 'active' and q.department = v_dept
  ),
  ranked as (
    select p.id, p.question, p.options,
           row_number() over (partition by p.topic order by random()) as rn
      from pool p
  ),
  picked as (
    select r.id, r.question, r.options
      from ranked r
     order by r.rn, random()
     limit v_count
  )
  select array_agg(p.id), jsonb_agg(jsonb_build_object('id',p.id,'question',p.question,'options',p.options))
    into v_ids, v_qs
    from picked p;

  if v_ids is null or array_length(v_ids,1) < v_count then
    return jsonb_build_object('error','not_enough_questions',
      'have', coalesce(array_length(v_ids,1),0), 'need', v_count);
  end if;

  insert into quiz_attempts (employee_id, employee_name, filial, week_start, date,
                             question_ids, q_total, practice)
    values (v_emp, v_name, v_filial, v_week, v_today, v_ids, v_count, v_practice)
    returning id into v_attempt;

  -- назначение израсходовано: второй раз без нового не пустит
  if v_marker is not null then
    update quiz_attempts set finished_at = now() where id = v_marker;
  end if;

  return jsonb_build_object('attempt_id', v_attempt, 'questions', v_qs,
    'total', v_count, 'pass', quiz_pass_score(v_count), 'practice', v_practice);
end $$;

-- ===== сдача =====

create or replace function public.quiz_submit(p_attempt_id bigint, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp bigint; v_ids bigint[]; v_total integer; v_pass integer; v_practice boolean;
  v_score integer; v_answered integer; v_details jsonb;
begin
  select p.employee_id into v_emp from profiles p where p.user_id = auth.uid();

  select a.question_ids, coalesce(a.q_total, cardinality(a.question_ids)), a.practice
    into v_ids, v_total, v_practice
    from quiz_attempts a
   where a.id = p_attempt_id and a.employee_id = v_emp
     and a.finished_at is null and cardinality(a.question_ids) > 0;
  if v_ids is null then return jsonb_build_object('error','no_attempt'); end if;
  v_pass := quiz_pass_score(v_total);

  select count(*)::int,
         count(*) filter (where x.a = q.correct_index)::int,
         jsonb_agg(jsonb_build_object(
           'id', q.id, 'question', q.question, 'ok', (x.a = q.correct_index),
           'yourText', q.options ->> x.a, 'correctText', q.options ->> q.correct_index))
    into v_answered, v_score, v_details
    from jsonb_to_recordset(p_answers) as x(id bigint, a int)
    join quiz_questions q on q.id = x.id
   where q.id = any (v_ids);

  v_score := coalesce(v_score, 0);

  update quiz_attempts
     set answers = p_answers, score = v_score, passed = (v_score >= v_pass), finished_at = now()
   where id = p_attempt_id;

  return jsonb_build_object('score', v_score, 'total', v_total, 'answered', coalesce(v_answered,0),
    'pass', v_pass, 'passed', v_score >= v_pass, 'practice', v_practice, 'details', v_details);
end $$;

-- ===== права =====

revoke all on function public.quiz_start()                                   from public, anon;
revoke all on function public.quiz_submit(bigint, jsonb)                     from public, anon;
revoke all on function public.quiz_reopen(bigint, date)                      from public, anon;
revoke all on function public.quiz_assign(bigint, date, integer, boolean)    from public, anon;
grant execute on function public.quiz_start()                                to authenticated;
grant execute on function public.quiz_submit(bigint, jsonb)                  to authenticated;
grant execute on function public.quiz_reopen(bigint, date)                   to authenticated;
grant execute on function public.quiz_assign(bigint, date, integer, boolean) to authenticated;
