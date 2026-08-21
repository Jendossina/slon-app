-- Цех не может потеряться у того, чья должность его подразумевает.
--
-- Проблема, повторившаяся трижды. У Игоря (Шеф бармен) и Самариддина (Шеф
-- кальянной станции) поле «цех» оказывалось пустым после сохранения карточки из
-- приложения. Внешне карточка выглядит целой — должность на месте, — но с
-- пустым цехом человек перестаёт быть старшим цеха: не правит график, не
-- одобряет заявки, не получает ни одного уведомления по своим людям. Никакой
-- ошибки при этом не показывается, и заметить можно только по жалобе.
--
-- Воспроизвести на форме не удалось: в тесте карточка подставляет цех верно.
-- Поэтому лечим не форму, а инвариант: «Шеф бармен» без цеха «Бармены» — это
-- сломанная карточка, откуда бы запись ни пришла. Правило живёт в базе, а не в
-- интерфейсе, чтобы его нельзя было обойти ни из другого экрана, ни из чужого
-- клиента, ни правкой напрямую.
--
-- Должности без своего цеха (Управляющий, BOSS, Охранник, Уборщик) не
-- затрагиваются: у них цеха и не должно быть.
--
-- Следствие, которое надо знать: чтобы убрать человека из графика, недостаточно
-- очистить цех — нужно сменить должность или поставить статус «Уволен».
create or replace function public.department_of_role(p_role text)
returns text language sql immutable as $$
  select case
    when p_role = 'Официант' then 'Официанты'
    when p_role in ('Бармен','Старший бармен','Бар менеджер','Шеф бармен') then 'Бармены'
    when p_role in ('Кальянный мастер','Старший кальянный мастер','Шеф кальянной станции') then 'Кальянные мастера'
    when p_role in ('Повар','Су-шеф','Шеф повар') then 'Повара'
    when p_role = 'Менеджер' then 'Менеджеры'
    else null
  end;
$$;

-- Текст взят из базы (pg_get_functiondef) и дополнен одним блоком в начале —
-- проверка цеха должна работать и для руководства, которое дальше выходит
-- ранним return, поэтому блок стоит до него.
CREATE OR REPLACE FUNCTION public.employees_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_privileged boolean; v_self boolean;
begin
  -- Цех подразумевается должностью: пустое поле у «Шефа бармена» — это потеря
  -- данных, а не осознанный выбор. Восстанавливаем до всех прочих проверок,
  -- потому что руководство ниже уходит ранним return.
  if coalesce(NEW.department, '') = '' then
    NEW.department := coalesce(public.department_of_role(NEW.role), NEW.department);
  end if;

  select exists (
    select 1 from profiles p
     where p.user_id = auth.uid() and p.role = any(array['admin','manager'])
  ) into v_privileged;

  if v_privileged or auth.uid() is null then
    return NEW;                       -- руководство и служебные правки — без ограничений
  end if;

  select exists (
    select 1 from profiles p where p.user_id = auth.uid() and p.employee_id = OLD.id
  ) into v_self;

  if v_self then
    NEW.salary := OLD.salary;         -- себе ставку не поднимаем
    NEW.role   := OLD.role;
  end if;
  NEW.department := OLD.department;   -- цех человека меняет только руководство
  return NEW;
end $function$;

-- Чиним то, что уже сломалось
update employees set department = public.department_of_role(role)
 where status <> 'Уволен'
   and coalesce(department, '') = ''
   and public.department_of_role(role) is not null;
