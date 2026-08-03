-- Отметка прихода: время считает сервер, а не телефон.
--
-- Дыра: check_in_time, дата, опоздание и штраф приходили с клиента из
-- new Date() телефона. Достаточно было перевести часы назад — и приход
-- записывался «вовремя», без опоздания и без штрафа.
--
-- Вторая дыра рядом: политика attendance_update разрешает сотруднику менять
-- СВОЮ запись целиком, без ограничения по колонкам. То есть отметиться с
-- опозданием, а следом обнулить penalty и is_late.
--
-- Лечим обе триггером: при вставке дата, время, опоздание и штраф всегда
-- проставляются из времени сервера (Asia/Tashkent), что бы ни прислал клиент;
-- при обновлении рядовой сотрудник может только закрыть смену (check_out_time
-- ставится тоже серверным временем), остальные поля возвращаются к прежним
-- значениям. Управляющий и менеджер правки делать по-прежнему могут — на случай
-- «забыл отметиться, поставьте руками».
--
-- Лестница штрафов (до 5 минут — 0, до 15 — 30 000, до часа — 50 000, дальше
-- 100 000) теперь живёт ТОЛЬКО здесь: одноимённый расчёт из js/home.js удалён,
-- чтобы телефон снова не стал источником правды.

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
  NEW.checkin_video := OLD.checkin_video;
  NEW.checkin_geo   := OLD.checkin_geo;

  -- Единственное, что сотрудник вправе изменить — закрыть смену, и то один раз
  if OLD.check_out_time is null and NEW.check_out_time is not null then
    NEW.check_out_time := v_time;
  else
    NEW.check_out_time := OLD.check_out_time;
  end if;
  return NEW;
end $$;

drop trigger if exists attendance_guard_trg on public.attendance;
create trigger attendance_guard_trg
  before insert or update on public.attendance
  for each row execute function public.attendance_guard();

-- Одна отметка на сотрудника в кассовый день: иначе вторая вставка обходит
-- проверку «уже отметился», которая живёт только в интерфейсе.
create unique index if not exists attendance_one_per_day
  on public.attendance (employee_id, date);
