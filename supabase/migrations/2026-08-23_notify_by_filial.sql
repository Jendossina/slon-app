-- Уведомления по филиалу.
--
-- Что было сломано. Клиент рассылал уведомления двумя функциями, и обе не знали
-- про филиалы:
--   * notifyAdminsAll выбирал профили только с ролью admin. Менеджер филиала
--     (роль manager) не получал НИЧЕГО о своём филиале — ни опозданий, ни заявок,
--     ни негативных отзывов. На Истикболе это два человека из руководства.
--   * notifyDeptSeniors искал старших по цеху без фильтра филиала, поэтому отметки
--     Истикбола уходили чеховским старшим вперемешку со своими.
--
-- Выбор получателей — правило, а не оформление, поэтому он переезжает в базу:
-- клиент не должен решать, кому положено знать о событии.
--
-- Правило принадлежности к филиалу здесь то же, что в cleaning_remind: пустой
-- список филиалов или отсутствие карточки = получает по всем филиалам (владелец,
-- управляющий). Пропустить уведомление хуже, чем прислать лишнее.

-- Уровень должности. Дублирует JOB_TITLE_LEVEL из js/tasks.js — списки обязаны
-- совпадать, как и DEPT_LEADS с is_dept_lead.
create or replace function public.job_level(p_role text)
returns integer language sql immutable as $$
  select case p_role
    when 'Официант' then 1
    when 'Бармен' then 1
    when 'Старший бармен' then 2
    when 'Бар менеджер' then 3
    when 'Шеф бармен' then 4
    when 'Кальянный мастер' then 1
    when 'Старший кальянный мастер' then 2
    when 'Шеф кальянной станции' then 3
    when 'Повар' then 1
    when 'Су-шеф' then 2
    when 'Шеф повар' then 3
    when 'Охранник' then 1
    when 'Уборщик' then 1
    when 'Менеджер' then 50
    when 'Управляющий' then 100
    when 'BOSS' then 100
    else 0
  end;
$$;

-- Руководство филиала: владелец, управляющие, менеджеры этого филиала.
-- p_filial = null — все, независимо от филиала (для событий вне филиала).
create or replace function public.notify_chiefs(p_filial text default null)
returns table(user_id uuid, telegram_id text, notify_prefs jsonb)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.telegram_id, p.notify_prefs
    from profiles p
    left join employees e on e.id = p.employee_id
   where p.telegram_id is not null
     and p.role = any(array['admin','manager','boss'])
     and coalesce(e.status, 'Активен') <> 'Уволен'
     and (
       p_filial is null
       or e.id is null
       or coalesce(array_length(e.filials, 1), 0) = 0
       or p_filial = any(e.filials)
     );
$$;

-- Старшие по цеху выше указанного уровня — в пределах филиала события.
create or replace function public.notify_dept_seniors(p_dept text, p_above integer default 0, p_filial text default null)
returns table(user_id uuid, telegram_id text, notify_prefs jsonb)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.telegram_id, p.notify_prefs
    from employees e
    join profiles p on p.employee_id = e.id
   where p.telegram_id is not null
     and coalesce(e.status, 'Активен') <> 'Уволен'
     and e.department = p_dept
     and public.job_level(e.role) > coalesce(p_above, 0)
     and (
       p_filial is null
       or coalesce(array_length(e.filials, 1), 0) = 0
       or p_filial = any(e.filials)
     );
$$;

grant execute on function public.job_level(text) to authenticated;
grant execute on function public.notify_chiefs(text) to authenticated;
grant execute on function public.notify_dept_seniors(text, integer, text) to authenticated;
