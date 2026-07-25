-- Аттестация по меню внутри приложения: 10 случайных вопросов, 8 правильных = сдал.
-- Проходится ПО СУББОТАМ. Не сдал (или не проходил) — блок «Сервис» в процентах сгорает.
--
-- Ключевое решение: вопросы официанту отдаёт не клиент, а функции с security definer.
-- Клиент НИКОГДА не получает правильные ответы, проверка — на сервере. Поэтому у самой
-- таблицы вопросов политики на чтение только для руководства.

-- ===== вспомогательные функции =====

-- Кассовый день по Ташкенту (то же правило, что businessToday() в js/core.js: до 8 утра — вчера)
create or replace function public.business_today()
returns date language sql stable as $$
  select case
    when extract(hour from (now() at time zone 'Asia/Tashkent')) < 8
      then ((now() at time zone 'Asia/Tashkent')::date - 1)
    else (now() at time zone 'Asia/Tashkent')::date
  end;
$$;

-- Понедельник недели (как weekStartOf() в js/core.js)
create or replace function public.week_start_of(d date)
returns date language sql immutable as $$
  select d - (extract(isodow from d)::int - 1);
$$;

-- ===== таблицы =====

-- Банк вопросов. status: draft — предложено ИИ, ждёт проверки; active — в работе; archived — убрано.
create table if not exists public.quiz_questions (
  id              bigserial primary key,
  department      text not null default 'Официанты',
  question        text not null,
  options         jsonb not null,
  correct_index   integer not null check (correct_index between 0 and 3),
  source          text,                                  -- откуда взят (статья Базы знаний)
  status          text not null default 'draft' check (status in ('draft','active','archived')),
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  constraint quiz_questions_options_len check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4)
);
create index if not exists quiz_questions_pick_idx on public.quiz_questions (department, status);

-- Попытки. Одна незакрытая попытка на сотрудника в неделю (superseded = админ открыл пересдачу).
create table if not exists public.quiz_attempts (
  id            bigserial primary key,
  employee_id   bigint not null references public.employees(id) on delete cascade,
  employee_name text,
  filial        text,
  week_start    date not null,
  date          date not null,
  question_ids  bigint[] not null,
  answers       jsonb,
  score         integer,
  passed        boolean,
  superseded    boolean not null default false,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create unique index if not exists quiz_attempts_one_per_week
  on public.quiz_attempts (employee_id, week_start) where (not superseded);
create index if not exists quiz_attempts_week_idx on public.quiz_attempts (week_start, filial);

-- ===== логика (security definer: правильные ответы не покидают сервер) =====

-- Начать/продолжить аттестацию. Возвращает 10 вопросов БЕЗ правильных ответов.
create or replace function public.quiz_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp bigint; v_dept text; v_name text; v_filial text;
  v_today date; v_week date; v_attempt bigint; v_finished timestamptz;
  v_ids bigint[]; v_qs jsonb; v_reopened boolean;
begin
  select p.employee_id into v_emp from profiles p where p.user_id = auth.uid();
  if v_emp is null then return jsonb_build_object('error','no_employee'); end if;
  select e.department, e.name, coalesce(e.filials[1],'chekhov')
    into v_dept, v_name, v_filial from employees e where e.id = v_emp;

  v_today := business_today();
  v_week  := week_start_of(v_today);

  -- уже есть попытка на этой неделе: незавершённую продолжаем, завершённую второй раз не даём
  select a.id, a.finished_at into v_attempt, v_finished
    from quiz_attempts a where a.employee_id = v_emp and a.week_start = v_week and not a.superseded;
  if v_attempt is not null and v_finished is not null then
    return jsonb_build_object('error','already_done');
  end if;

  -- аттестация по субботам; исключение — админ открыл пересдачу (осталась погашенная попытка)
  v_reopened := exists (select 1 from quiz_attempts a
                        where a.employee_id = v_emp and a.week_start = v_week and a.superseded);
  if extract(isodow from v_today) <> 6 and not v_reopened then
    return jsonb_build_object('error','not_saturday');
  end if;

  if v_attempt is not null then
    select array_agg(q.id), jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'options',q.options))
      into v_ids, v_qs
      from quiz_questions q
      where q.id = any (select unnest(at2.question_ids) from quiz_attempts at2 where at2.id = v_attempt);
    return jsonb_build_object('attempt_id', v_attempt, 'questions', v_qs, 'resumed', true);
  end if;

  select array_agg(q.id), jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'options',q.options))
    into v_ids, v_qs
    from (select * from quiz_questions
          where status = 'active' and department = v_dept
          order by random() limit 10) q;

  if v_ids is null or array_length(v_ids,1) < 10 then
    return jsonb_build_object('error','not_enough_questions','have',coalesce(array_length(v_ids,1),0));
  end if;

  insert into quiz_attempts (employee_id, employee_name, filial, week_start, date, question_ids)
    values (v_emp, v_name, v_filial, v_week, v_today, v_ids)
    returning id into v_attempt;

  return jsonb_build_object('attempt_id', v_attempt, 'questions', v_qs);
end $$;

-- Сдать ответы. p_answers: [{"id":123,"a":2}, ...]. Считает сервер, клиенту уходит уже результат.
create or replace function public.quiz_submit(p_attempt_id bigint, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp bigint; v_score integer; v_details jsonb; v_total integer;
begin
  select p.employee_id into v_emp from profiles p where p.user_id = auth.uid();
  if not exists (select 1 from quiz_attempts a
                 where a.id = p_attempt_id and a.employee_id = v_emp and a.finished_at is null) then
    return jsonb_build_object('error','no_attempt');
  end if;

  select count(*)::int,
         count(*) filter (where x.a = q.correct_index)::int,
         jsonb_agg(jsonb_build_object(
           'id', q.id, 'question', q.question, 'ok', (x.a = q.correct_index),
           'yourText', q.options ->> x.a, 'correctText', q.options ->> q.correct_index))
    into v_total, v_score, v_details
    from jsonb_to_recordset(p_answers) as x(id bigint, a int)
    join quiz_questions q on q.id = x.id
   where q.id = any (select unnest(at2.question_ids) from quiz_attempts at2 where at2.id = p_attempt_id);

  update quiz_attempts
     set answers = p_answers, score = v_score, passed = (v_score >= 8), finished_at = now()
   where id = p_attempt_id;

  return jsonb_build_object('score', v_score, 'total', coalesce(v_total,0), 'passed', v_score >= 8, 'details', v_details);
end $$;

-- Открыть пересдачу (админ/управляющий). Старая попытка гасится, история остаётся.
create or replace function public.quiz_reopen(p_employee_id bigint, p_week_start date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles p
                 where p.user_id = auth.uid() and p.role = any(array['admin','manager'])) then
    return jsonb_build_object('error','forbidden');
  end if;
  update quiz_attempts set superseded = true
   where employee_id = p_employee_id and week_start = p_week_start and not superseded;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.quiz_start()                       from public, anon;
revoke all on function public.quiz_submit(bigint, jsonb)         from public, anon;
revoke all on function public.quiz_reopen(bigint, date)          from public, anon;
grant execute on function public.quiz_start()                    to authenticated;
grant execute on function public.quiz_submit(bigint, jsonb)      to authenticated;
grant execute on function public.quiz_reopen(bigint, date)       to authenticated;

-- ===== RLS =====

alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts  enable row level security;

-- Вопросы: видит и правит только руководство. Официант получает их через quiz_start().
drop policy if exists quiz_questions_select on public.quiz_questions;
create policy quiz_questions_select on public.quiz_questions for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager','boss'])));

drop policy if exists quiz_questions_insert on public.quiz_questions;
create policy quiz_questions_insert on public.quiz_questions for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

drop policy if exists quiz_questions_update on public.quiz_questions;
create policy quiz_questions_update on public.quiz_questions for update to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

drop policy if exists quiz_questions_delete on public.quiz_questions;
create policy quiz_questions_delete on public.quiz_questions for delete to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

-- Попытки: свои видит сам сотрудник, все — руководство. Пишутся только через функции выше.
drop policy if exists quiz_attempts_select on public.quiz_attempts;
create policy quiz_attempts_select on public.quiz_attempts for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager','boss']))
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.employee_id = quiz_attempts.employee_id)
  );

drop policy if exists quiz_attempts_delete on public.quiz_attempts;
create policy quiz_attempts_delete on public.quiz_attempts for delete to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));
