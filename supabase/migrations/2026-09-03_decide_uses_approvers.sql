-- Решение по заявке — по карте одобряющих, а не по праву на график.
--
-- Единственная правка: can_edit_schedule_of заменён на can_decide_request_of.
-- Всё остальное тело функции прежнее, включая правило «свою заявку старший цеха
-- не утверждает» и прощение штрафа задним числом через slon.excuse_late.

CREATE OR REPLACE FUNCTION public.shift_requests_decide()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mine       boolean := OLD.employee_id = public.my_employee_id();
  v_privileged boolean := exists (select 1 from profiles p
                                   where p.user_id = auth.uid() and p.role = any(array['admin','manager']));
  v_a_row  bigint;
  v_b_row  bigint;
  v_a_name text;
  v_b_name text;
begin
  if OLD.status <> 'pending' then
    raise exception 'Заявка уже обработана (%)', OLD.status;
  end if;

  -- Содержание заявки после подачи неприкосновенно: решение — это только
  -- статус и подпись. Иначе одобряющий мог бы подменить день или напарника.
  NEW.kind          := OLD.kind;
  NEW.filial        := OLD.filial;
  NEW.department    := OLD.department;
  NEW.employee_id   := OLD.employee_id;
  NEW.employee_name := OLD.employee_name;
  NEW.date          := OLD.date;
  NEW.swap_kind     := OLD.swap_kind;
  NEW.partner_id    := OLD.partner_id;
  NEW.partner_name  := OLD.partner_name;
  NEW.partner_date  := OLD.partner_date;
  NEW.late_minutes  := OLD.late_minutes;
  NEW.reason        := OLD.reason;
  NEW.created_at    := OLD.created_at;

  -- Автор вправе только отозвать заявку, пока её не рассмотрели
  if NEW.status = 'cancelled' then
    if not v_mine then raise exception 'Отозвать заявку может только её автор'; end if;
    NEW.decided_at := now();
    return NEW;
  end if;

  if not public.can_decide_request_of(OLD.employee_id) then
    raise exception 'Нет прав решать по этой заявке';
  end if;
  -- Старший цеха ведёт свой цех, но не самого себя: свою заявку он отправляет
  -- наверх. Иначе право на замену превращается в право менять себе график.
  if v_mine and not v_privileged then
    raise exception 'Свою заявку утверждает руководство';
  end if;

  NEW.decided_by   := auth.uid();
  NEW.decided_at   := now();
  NEW.decided_by_name := coalesce(
    (select p.name from profiles p where p.user_id = auth.uid()), NEW.decided_by_name);

  if NEW.status <> 'approved' then
    return NEW;                       -- отказ: график не трогаем
  end if;

  -- ===== Одобрено: правим график =====
  if OLD.kind = 'swap' then
    select s.id into v_a_row from schedules s
     where s.employee_id = OLD.employee_id and s.date = OLD.date
       and coalesce(s.is_day_off, false) = false
     order by s.id limit 1;
    if v_a_row is null then
      raise exception 'В графике нет смены % на %', coalesce(OLD.employee_name,''), to_char(OLD.date,'DD.MM');
    end if;

    select e.name into v_a_name from employees e where e.id = OLD.employee_id;
    select e.name into v_b_name from employees e where e.id = OLD.partner_id;

    if OLD.swap_kind = 'exchange' then
      select s.id into v_b_row from schedules s
       where s.employee_id = OLD.partner_id and s.date = OLD.partner_date
         and coalesce(s.is_day_off, false) = false
       order by s.id limit 1;
      if v_b_row is null then
        raise exception 'В графике нет смены % на %', coalesce(OLD.partner_name,''), to_char(OLD.partner_date,'DD.MM');
      end if;
      -- Меняем владельцев строк, а не даты: время смены принадлежит дню, а не
      -- человеку. Кто в этот день выходит — то и меняется.
      update schedules set employee_id = OLD.partner_id,  employee_name = coalesce(v_b_name, OLD.partner_name)  where id = v_a_row;
      update schedules set employee_id = OLD.employee_id, employee_name = coalesce(v_a_name, OLD.employee_name) where id = v_b_row;
    else
      -- Подмена: смена целиком переходит напарнику. Двух смен в один день у
      -- него быть не должно — это не подмена, а двойной выход.
      if exists (select 1 from schedules s
                  where s.employee_id = OLD.partner_id and s.date = OLD.date
                    and coalesce(s.is_day_off, false) = false) then
        raise exception 'У % уже есть смена %', coalesce(OLD.partner_name,''), to_char(OLD.date,'DD.MM');
      end if;
      update schedules set employee_id = OLD.partner_id, employee_name = coalesce(v_b_name, OLD.partner_name) where id = v_a_row;
    end if;

  elsif OLD.kind = 'late' then
    -- Обычный случай — заявку одобрили до прихода, и штраф просто не начислится
    -- (см. attendance_guard). Но одобрить могут и после того, как человек уже
    -- отметился: тогда прощаем задним числом здесь.
    --
    -- Отметку правит триггер attendance_guard, и рядовому пользователю он
    -- возвращает прежние значения — иначе сотрудник обнулял бы себе штраф сам.
    -- Старший цеха рядовой и есть, поэтому на время этой правки поднимаем флаг:
    -- пишет не человек, а одобренная заявка.
    perform set_config('slon.excuse_late', '1', true);
    update attendance
       set penalty = 0, late_excused = true
     where employee_id = OLD.employee_id and date = OLD.date;
    perform set_config('slon.excuse_late', '', true);
  end if;

  return NEW;
end $function$
;
