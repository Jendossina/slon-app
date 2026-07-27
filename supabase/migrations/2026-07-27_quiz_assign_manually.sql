-- Назначение аттестации вручную, в любой день.
--
-- Было: quiz_reopen только ГАСИЛА существующие попытки. Если на этой неделе у
-- официанта попыток ещё не было, гасить нечего — функция молча ничего не делала,
-- и открыть тест вне субботы было нельзя (пришлось делать это руками в базе).
--
-- Стало: функция гарантирует наличие метки-разрешения. quiz_start() пускает вне
-- субботы именно при её наличии, поэтому назначение работает в любой день.

create or replace function public.quiz_reopen(p_employee_id bigint, p_week_start date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_filial text; v_had boolean;
begin
  if not exists (select 1 from profiles p
                 where p.user_id = auth.uid() and p.role = any(array['admin','manager'])) then
    return jsonb_build_object('error','forbidden');
  end if;

  select e.name, coalesce(e.filials[1],'chekhov') into v_name, v_filial
    from employees e where e.id = p_employee_id;
  if v_name is null then return jsonb_build_object('error','no_employee'); end if;

  -- была ли уже пройденная/начатая попытка на этой неделе (для ответа клиенту)
  v_had := exists (select 1 from quiz_attempts
                    where employee_id = p_employee_id and week_start = p_week_start and not superseded);

  -- гасим текущую попытку: её результат перестаёт учитываться, но остаётся в истории
  update quiz_attempts set superseded = true
   where employee_id = p_employee_id and week_start = p_week_start and not superseded;

  -- метка-разрешение: без неё quiz_start вне субботы откажет
  if not exists (select 1 from quiz_attempts
                  where employee_id = p_employee_id and week_start = p_week_start and superseded) then
    insert into quiz_attempts (employee_id, employee_name, filial, week_start, date, question_ids, superseded)
    values (p_employee_id, v_name, v_filial, p_week_start, business_today(), '{}'::bigint[], true);
  end if;

  return jsonb_build_object('ok', true, 'replaced', v_had);
end $$;

revoke all on function public.quiz_reopen(bigint, date) from public, anon;
grant execute on function public.quiz_reopen(bigint, date) to authenticated;
