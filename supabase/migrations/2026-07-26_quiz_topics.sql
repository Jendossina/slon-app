-- Фикс: в одну аттестацию попадали два вопроса одного шаблона
-- («Сколько готовится X?» с почти одинаковыми вариантами) — читается как дубль.
--
-- Решение: у вопроса появляется «тема». В один тест берём максимум ОДИН вопрос
-- из темы; вторым по счёту из темы добираем только если тем меньше десяти.
-- Вопросы без темы считаются каждый своей темой — то есть ведут себя как раньше.

alter table public.quiz_questions add column if not exists topic text;
create index if not exists quiz_questions_topic_idx on public.quiz_questions (department, status, topic);

-- ===== Темы для существующего банка =====
-- Формульные вопросы группируем по ШАБЛОНУ: именно они выглядят одинаково.
update public.quiz_questions set topic = 'время приготовления' where question ilike 'Сколько готов%';
update public.quiz_questions set topic = 'аллергены'           where question ilike '%аллерген%';

-- Остальные — по блюду/теме, чтобы не спрашивать дважды об одном и том же.
update public.quiz_questions set topic = 'песто'   where question in (
  'Что подаётся в пасте с соусом песто?', 'Из чего готовится соус песто?');
update public.quiz_questions set topic = 'том ям'  where question in (
  'Что входит в Том ям с морепродуктами?', 'Что рекомендуем дополнительно к Том яму?');
update public.quiz_questions set topic = 'фастфуд' where question in (
  'Что хрустит в классическом гамбургере?',
  'Что предлагаем дополнительно к бургерам и чиабаттам?',
  'Какой соус в чиабатте с рваной говядиной?');
update public.quiz_questions set topic = 'крылья'  where question = 'Сколько соусов в ассорти из куриных крыльев и какие?';

-- ===== Выдача вопросов с учётом темы =====
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

  select a.id, a.finished_at into v_attempt, v_finished
    from quiz_attempts a where a.employee_id = v_emp and a.week_start = v_week and not a.superseded;
  if v_attempt is not null and v_finished is not null then
    return jsonb_build_object('error','already_done');
  end if;

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

  -- Сначала по одному вопросу из каждой темы (в случайном порядке), и только
  -- если тем не хватило на десять — добираем вторыми вопросами из тех же тем.
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
     limit 10
  )
  select array_agg(p.id), jsonb_agg(jsonb_build_object('id',p.id,'question',p.question,'options',p.options))
    into v_ids, v_qs
    from picked p;

  if v_ids is null or array_length(v_ids,1) < 10 then
    return jsonb_build_object('error','not_enough_questions','have',coalesce(array_length(v_ids,1),0));
  end if;

  insert into quiz_attempts (employee_id, employee_name, filial, week_start, date, question_ids)
    values (v_emp, v_name, v_filial, v_week, v_today, v_ids)
    returning id into v_attempt;

  return jsonb_build_object('attempt_id', v_attempt, 'questions', v_qs);
end $$;

revoke all on function public.quiz_start() from public, anon;
grant execute on function public.quiz_start() to authenticated;
