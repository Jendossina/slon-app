-- Подтверждение присутствия менеджером смены.
--
-- Видео показывает, где человек был в момент отметки. Подтверждение отвечает на
-- другой вопрос: был ли он на месте всю смену. Отметиться можно откуда угодно,
-- а вот пройти мимо менеджера — нет.
--
-- Ставится в дневной ведомости («Люди» → день): менеджер и так разбирает там,
-- кто во сколько пришёл, и видео смотрит там же. Отдельного экрана не заводим.
--
-- Кто подтвердил и когда — проставляет триггер по auth.uid(), а не клиент:
-- подпись под чужим именем не должна зависеть от честности телефона.
-- Сотруднику своё присутствие не подтвердить: политика пускает его в свою
-- строку (он дописывает видео), поэтому новые поля откатывает attendance_guard.

alter table public.attendance
  add column if not exists present_confirmed boolean,
  add column if not exists confirmed_by uuid,
  add column if not exists confirmed_at timestamptz;

comment on column public.attendance.present_confirmed is
  'true — менеджер подтвердил присутствие, false — отметил, что человека не было, null — не смотрели';

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
    -- присутствие подтверждает человек, а не вставка
    NEW.present_confirmed := null;
    NEW.confirmed_by := null;
    NEW.confirmed_at := null;
    return NEW;
  end if;

  -- UPDATE
  if coalesce(current_setting('slon.excuse_late', true), '') = '1' then
    return NEW;
  end if;

  select exists (select 1 from profiles p
                  where p.user_id = auth.uid() and p.role = any(array['admin','manager']))
    into v_privileged;

  if v_privileged then
    -- Подпись ставим сами: кто и когда подтвердил, клиент прислать не может
    if NEW.present_confirmed is distinct from OLD.present_confirmed then
      NEW.confirmed_by := auth.uid();
      NEW.confirmed_at := now();
    else
      NEW.confirmed_by := OLD.confirmed_by;
      NEW.confirmed_at := OLD.confirmed_at;
    end if;
    return NEW;                          -- руководство правит запись как раньше
  end if;

  NEW.employee_id   := OLD.employee_id;
  NEW.date          := OLD.date;
  NEW.check_in_time := OLD.check_in_time;
  NEW.is_late       := OLD.is_late;
  NEW.late_minutes  := OLD.late_minutes;
  NEW.penalty       := OLD.penalty;
  NEW.late_excused  := OLD.late_excused;
  -- своё присутствие сотрудник себе не подтверждает
  NEW.present_confirmed := OLD.present_confirmed;
  NEW.confirmed_by      := OLD.confirmed_by;
  NEW.confirmed_at      := OLD.confirmed_at;

  -- Видео можно только ДОСЛАТЬ: пока его нет — принимаем, дальше не трогаем.
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
