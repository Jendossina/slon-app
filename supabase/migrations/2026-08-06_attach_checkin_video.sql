-- Отметка прихода записывается СРАЗУ, видео прикрепляется следом.
--
-- Что было: сначала на сервер уезжало видео (десятки мегабайт с камеры), и
-- только потом писалась отметка. На слабой связи загрузка шла минутами, а на
-- недорогих андроидах система успевала выгрузить приложение из памяти, пока
-- открыта камера. Запрос обрывался на полуслове — в логах остаётся preflight
-- без самого POST, — и человек не отмечался вовсе, сколько ни пробовал.
--
-- Стало: приложение пишет отметку (время ставит триггер по серверным часам),
-- а видео догружает после и дописывает ссылку в ту же строку. Если загрузка
-- сорвалась, отметка уже засчитана, а видео сотрудник дошлёт с главного экрана.
--
-- Для этого рядовому сотруднику нужно право дописать checkin_video, пока он
-- пустой. Всё остальное триггер по-прежнему возвращает к прежним значениям:
-- переписать уже приложенное видео, время прихода, опоздание или штраф нельзя.

create or replace function public.attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_local  timestamp := (now() at time zone 'Asia/Tashkent');
  v_time   text      := to_char((now() at time zone 'Asia/Tashkent'), 'HH24:MI');
  v_min    int;
  v_date   date;
  v_start  text;
  v_late   int := 0;
  v_pen    int := 0;
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

    NEW.late_minutes := v_late;
    NEW.penalty      := v_pen;
    NEW.is_late      := v_pen > 0;
    return NEW;
  end if;

  -- UPDATE
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
  NEW.checkin_geo   := OLD.checkin_geo;

  -- Видео можно только ДОСЛАТЬ: пока его нет — принимаем, дальше не трогаем
  if OLD.checkin_video is null then
    NEW.checkin_video := NEW.checkin_video;
  else
    NEW.checkin_video := OLD.checkin_video;
  end if;

  -- Единственное, что сотрудник вправе изменить помимо этого — закрыть смену
  if OLD.check_out_time is null and NEW.check_out_time is not null then
    NEW.check_out_time := v_time;
  else
    NEW.check_out_time := OLD.check_out_time;
  end if;
  return NEW;
end $$;
