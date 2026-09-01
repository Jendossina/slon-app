-- День аттестации теперь свой у каждого филиала.
--
-- Было: quiz_start() пускал только в субботу — день был зашит числом 6 для всех.
-- В Истикболе аттестация проходит в воскресенье, поэтому официанты филиала
-- в свой день упирались в отказ not_saturday, а карточка на Главной у них
-- вообще не появлялась. Единственные, кто проходил тест, — те, кто случайно
-- начал его в субботу: недоигранную попытку функция подхватывает в любой день.
--
-- Стало: день берётся из quiz_weekday(филиал). Чехов — суббота (6),
-- Истикбол — воскресенье (7). Значения ISO: 1 = понедельник, 7 = воскресенье.
-- Тот же список продублирован на клиенте (QUIZ_WEEKDAY в js/core.js) — меняя
-- день филиала, правим оба места.

create or replace function public.quiz_weekday(p_filial text)
returns integer language sql immutable as $$
  select case p_filial when 'istikbol' then 7 else 6 end;
$$;

comment on function public.quiz_weekday(text) is
  'День недели аттестации в филиале (ISO: 1=пн … 7=вс). Дубль QUIZ_WEEKDAY из js/core.js.';

create or replace function public.quiz_start()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_emp bigint; v_dept text; v_name text; v_filial text;
  v_today date; v_week date; v_day integer;
  v_attempt bigint; v_ids bigint[]; v_qs jsonb;
  v_marker bigint; v_count integer; v_practice boolean; v_areas text[];
begin
  select p.employee_id into v_emp from profiles p where p.user_id = auth.uid();
  if v_emp is null then return jsonb_build_object('error','no_employee'); end if;
  select e.department, e.name, coalesce(e.filials[1],'chekhov')
    into v_dept, v_name, v_filial from employees e where e.id = v_emp;

  v_today := business_today();
  v_week  := week_start_of(v_today);
  v_day   := quiz_weekday(v_filial);

  -- 1) недоигранная попытка — продолжаем её.
  -- Тренировочную доигрываем только в тот же день, иначе брошенная тренировка
  -- в день аттестации подменила бы собой зачётный тест.
  select a.id, a.question_ids, coalesce(a.q_total, cardinality(a.question_ids)), a.practice, a.areas
    into v_attempt, v_ids, v_count, v_practice, v_areas
    from quiz_attempts a
   where a.employee_id = v_emp and a.week_start = v_week
     and a.finished_at is null and cardinality(a.question_ids) > 0
     and (not a.practice or a.date = v_today)
   order by a.started_at desc limit 1;

  if v_attempt is not null then
    select jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'options',q.options))
      into v_qs from quiz_questions q where q.id = any (v_ids);
    return jsonb_build_object('attempt_id', v_attempt, 'questions', v_qs, 'resumed', true,
      'total', v_count, 'pass', quiz_pass_score(v_count), 'practice', v_practice, 'areas', v_areas);
  end if;

  -- 2) назначение от руководства: разрешает старт в любой день, расходуется ниже
  select a.id, coalesce(a.q_total, 10), a.practice, a.areas
    into v_marker, v_count, v_practice, v_areas
    from quiz_attempts a
   where a.employee_id = v_emp and a.week_start = v_week
     and a.superseded and cardinality(a.question_ids) = 0 and a.finished_at is null
   order by a.started_at desc limit 1;

  -- 3) без назначения — обычный порядок: день аттестации филиала, весь банк,
  --    одна попытка в неделю
  if v_marker is null then
    if exists (select 1 from quiz_attempts a
                where a.employee_id = v_emp and a.week_start = v_week
                  and not a.superseded and not a.practice and a.finished_at is not null) then
      return jsonb_build_object('error','already_done');
    end if;
    if extract(isodow from v_today) <> v_day then
      -- day отдаём наружу, чтобы клиент назвал в отказе верный день филиала
      return jsonb_build_object('error','not_quiz_day', 'day', v_day);
    end if;
    v_count := 10; v_practice := false; v_areas := null;
  end if;

  -- Сначала по одному вопросу из каждой темы (в случайном порядке), и только
  -- если тем не хватило — добираем вторыми вопросами из тех же тем.
  -- Области, если назначены, сужают банк до себя.
  with pool as (
    select q.id, q.question, q.options, coalesce(q.topic, 'q' || q.id::text) as topic
      from quiz_questions q
     where q.status = 'active' and q.department = v_dept
       and (v_areas is null or q.area = any(v_areas))
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
                             question_ids, q_total, practice, areas)
    values (v_emp, v_name, v_filial, v_week, v_today, v_ids, v_count, v_practice, v_areas)
    returning id into v_attempt;

  -- назначение израсходовано: второй раз без нового не пустит
  if v_marker is not null then
    update quiz_attempts set finished_at = now() where id = v_marker;
  end if;

  return jsonb_build_object('attempt_id', v_attempt, 'questions', v_qs,
    'total', v_count, 'pass', quiz_pass_score(v_count), 'practice', v_practice, 'areas', v_areas);
end $function$;

revoke all on function public.quiz_weekday(text) from public, anon;
grant execute on function public.quiz_weekday(text) to authenticated;
revoke all on function public.quiz_start() from public, anon;
grant execute on function public.quiz_start() to authenticated;
