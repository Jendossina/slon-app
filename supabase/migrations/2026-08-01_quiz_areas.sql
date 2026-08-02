-- Аттестация по выбранным областям: бар / кухня / сервис.
--
-- Зачем: руководство хочет прогнать официантов «только по бару и кухне», а вопросы
-- про стандарты обслуживания в такой тест не пускать. Раньше quiz_start брал ВЕСЬ
-- активный банк отдела и отфильтровать его было нечем.
--
-- Что появляется:
--   1) у вопроса — area ('kitchen' | 'bar' | 'service'), проставляется по книге
--      Базы знаний, из которой вопрос взят (Food Book / Bar Book / остальное);
--   2) у назначения (quiz_assign) — список областей; quiz_start берёт вопросы
--      только из них. Пусто = как раньше, весь банк отдела.
--
-- Правило «один вопрос из темы» не меняется: оно работает уже внутри выбранных
-- областей.

-- ===== 1. Область у вопроса =====

alter table public.quiz_questions add column if not exists area text;

do $$ begin
  alter table public.quiz_questions
    add constraint quiz_questions_area_chk check (area is null or area in ('kitchen','bar','service'));
exception when duplicate_object then null; end $$;

comment on column public.quiz_questions.area is 'область: kitchen | bar | service. Пусто — вопрос не попадёт в тест с фильтром по областям';
create index if not exists quiz_questions_area_idx on public.quiz_questions (department, status, area);

-- Проставляем по источнику: source — это заголовок статьи Базы знаний, иногда
-- с уточнением через тире («Джин — Hendricks»), поэтому берём и точное совпадение,
-- и совпадение по началу строки.
update public.quiz_questions q
   set area = m.area
  from (
    select a.title,
           case b.title when 'Bar Book'  then 'bar'
                        when 'Food Book' then 'kitchen'
                        else 'service' end as area
      from public.kb_articles a join public.kb_books b on b.id = a.book_id
  ) m
 where q.area is null
   and q.source is not null
   and (q.source = m.title or q.source like m.title || ' %');

-- ===== 2. Область у назначения и попытки =====

alter table public.quiz_attempts add column if not exists areas text[];
comment on column public.quiz_attempts.areas is 'области вопросов (kitchen/bar/service); пусто — весь банк отдела';

-- ===== 3. Назначение =====

-- Сигнатура меняется (добавились области), поэтому старую версию сносим:
-- иначе вызов с четырьмя аргументами станет неоднозначным.
drop function if exists public.quiz_assign(bigint, date, integer, boolean);

create or replace function public.quiz_assign(
  p_employee_id bigint, p_week_start date,
  p_count integer default 10, p_practice boolean default false,
  p_areas text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_dept text; v_filial text; v_had boolean;
        v_have integer; v_count integer; v_areas text[];
begin
  if not exists (select 1 from profiles p
                 where p.user_id = auth.uid() and p.role = any(array['admin','manager'])) then
    return jsonb_build_object('error','forbidden');
  end if;

  v_count := greatest(1, least(coalesce(p_count, 10), 100));
  -- пустой массив = «без ограничения», чтобы клиенту не пришлось слать null
  v_areas := case when p_areas is null or cardinality(p_areas) = 0 then null else p_areas end;
  if v_areas is not null and exists (select 1 from unnest(v_areas) a
                                      where a not in ('kitchen','bar','service')) then
    return jsonb_build_object('error','bad_area');
  end if;

  select e.name, e.department, coalesce(e.filials[1],'chekhov')
    into v_name, v_dept, v_filial from employees e where e.id = p_employee_id;
  if v_name is null then return jsonb_build_object('error','no_employee'); end if;

  -- проверяем банк заранее: иначе официант откроет карточку и получит отказ
  select count(*) into v_have from quiz_questions
   where status = 'active' and department = v_dept
     and (v_areas is null or area = any(v_areas));
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
                             question_ids, q_total, practice, areas, superseded)
  values (p_employee_id, v_name, v_filial, p_week_start, business_today(),
          '{}'::bigint[], v_count, p_practice, v_areas, true);

  return jsonb_build_object('ok', true, 'replaced', v_had, 'count', v_count,
                            'practice', p_practice, 'areas', v_areas);
end $$;

-- Прежняя кнопка «назначить тест / открыть пересдачу» — обычные 10 вопросов в зачёт
-- по всему банку.
create or replace function public.quiz_reopen(p_employee_id bigint, p_week_start date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return quiz_assign(p_employee_id, p_week_start, 10, false, null);
end $$;

-- ===== 4. Старт =====

create or replace function public.quiz_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp bigint; v_dept text; v_name text; v_filial text;
  v_today date; v_week date;
  v_attempt bigint; v_ids bigint[]; v_qs jsonb;
  v_marker bigint; v_count integer; v_practice boolean; v_areas text[];
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

  -- 3) без назначения — обычный порядок: суббота, весь банк, одна попытка в неделю
  if v_marker is null then
    if exists (select 1 from quiz_attempts a
                where a.employee_id = v_emp and a.week_start = v_week
                  and not a.superseded and not a.practice and a.finished_at is not null) then
      return jsonb_build_object('error','already_done');
    end if;
    if extract(isodow from v_today) <> 6 then
      return jsonb_build_object('error','not_saturday');
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
end $$;

-- ===== 5. Права =====

revoke all on function public.quiz_start()                                          from public, anon;
revoke all on function public.quiz_reopen(bigint, date)                             from public, anon;
revoke all on function public.quiz_assign(bigint, date, integer, boolean, text[])   from public, anon;
grant execute on function public.quiz_start()                                       to authenticated;
grant execute on function public.quiz_reopen(bigint, date)                          to authenticated;
grant execute on function public.quiz_assign(bigint, date, integer, boolean, text[]) to authenticated;
