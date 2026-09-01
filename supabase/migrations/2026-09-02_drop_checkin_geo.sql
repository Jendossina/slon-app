-- Убираем мёртвую колонку attendance.checkin_geo.
--
-- Гео-проверку прихода сняли ещё 06.08.2026 (коммит 76a9e06): на части
-- андроидов местоположение не определялось вовсе, и человек не мог отметиться.
-- Место с тех пор подтверждает видео. Колонка осталась, но клиент в неё ничего
-- не пишет — заполнены 6 записей за 5-6 августа, всё остальное пусто.
--
-- Чем мешала: единственное поле в attendance, про которое непонятно, работает
-- оно или нет. Плюс это координаты людей — хранить их без применения незачем.
--
-- Порядок важен: сначала триггер перестаёт про неё знать, потом колонка
-- исчезает. Наоборот нельзя — plpgsql проверяет поля при выполнении, и отметка
-- прихода в промежутке упала бы с ошибкой.

create or replace function public.attendance_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_local  timestamp := (now() at time zone 'Asia/Tashkent');
  v_time   text      := to_char((now() at time zone 'Asia/Tashkent'), 'HH24:MI');
  v_min    int;
  v_date   date;
  v_start  text;
  v_late   int := 0;
  v_pen    int := 0;
  v_excused boolean := false;
  v_privileged boolean;
begin
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  if TG_OP = 'INSERT' then
    v_date := public.business_today();   -- смена до 8 утра относится ко вчерашнему дню
    NEW.date := v_date;
    NEW.check_in_time := v_time;

    -- Смена сотрудника на этот кассовый день. Выходной не берём: на него отметку
    -- и не предлагают, а shift_start там пустой — без этого условия пустое время
    -- превратилось бы в опоздание на весь день.
    select s.shift_start into v_start
      from schedules s
     where s.employee_id = NEW.employee_id
       and s.date = v_date
       and coalesce(s.is_day_off, false) = false
       and s.shift_start is not null
     limit 1;

    if v_start is not null then
      v_late := greatest(0, v_min - (split_part(v_start, ':', 1)::int * 60 + split_part(v_start, ':', 2)::int));
      v_pen := case when v_late <= 5  then 0
                    when v_late <= 15 then 30000
                    when v_late <= 60 then 50000
                    else 100000 end;
    end if;

    -- Предупредил заранее и заявку одобрили — опоздание фиксируем, штраф нет.
    if v_pen > 0 and exists (
         select 1 from shift_requests r
          where r.kind = 'late' and r.status = 'approved'
            and r.employee_id = NEW.employee_id and r.date = v_date) then
      v_pen := 0;
      v_excused := true;
    end if;

    NEW.late_minutes := v_late;
    NEW.penalty      := v_pen;
    NEW.is_late      := v_late > 5;
    NEW.late_excused := v_excused;
    return NEW;
  end if;

  -- UPDATE
  -- Прощение штрафа по одобренной заявке приходит из shift_requests_decide и
  -- проходит без проверки прав: решение уже принял тот, кто вправе его принять.
  if coalesce(current_setting('slon.excuse_late', true), '') = '1' then
    return NEW;
  end if;

  select exists (select 1 from profiles p
                  where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
    into v_privileged;
  if v_privileged then
    return NEW;                          -- руководство правит запись как раньше
  end if;

  NEW.employee_id   := OLD.employee_id;
  NEW.date          := OLD.date;
  NEW.check_in_time := OLD.check_in_time;
  NEW.is_late       := OLD.is_late;
  NEW.late_minutes  := OLD.late_minutes;
  NEW.penalty       := OLD.penalty;
  NEW.late_excused  := OLD.late_excused;

  -- Видео можно только ДОСЛАТЬ: пока его нет — принимаем, дальше не трогаем.
  -- Именно это правило и потерялось 14.08.
  if OLD.checkin_video is not null then
    NEW.checkin_video := OLD.checkin_video;
  end if;

  -- Единственное, что сотрудник вправе изменить помимо этого — закрыть смену
  if OLD.check_out_time is null and NEW.check_out_time is not null then
    NEW.check_out_time := v_time;
  else
    NEW.check_out_time := OLD.check_out_time;
  end if;
  return NEW;
end $function$;

alter table public.attendance drop column if exists checkin_geo;
