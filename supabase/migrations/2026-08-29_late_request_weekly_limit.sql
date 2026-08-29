-- Одна заявка на опоздание в неделю на человека.
--
-- Зачем. Предупреждение об опоздании задумано как исключение, а стало нормой:
-- за неделю 23–29.08 отклонено 14 заявок, из них 4 — у одного человека
-- (24.08 дважды, 26.08, 29.08). Заявка при этом не бесплатная: одобренная
-- снимает штраф за опоздание, а каждая новая дёргает уведомлением всех
-- старших цеха и управляющих.
--
-- Правило (решение владельца 29.08.2026): в календарной неделе (пн–вс) у
-- сотрудника может быть только одна заявка на опоздание. Неделя считается по
-- ДНЮ СМЕНЫ, а не по дате подачи: заявку подают и заранее, и в день смены, а
-- ограничиваем мы именно опоздания на смены этой недели. Понедельник как
-- начало недели — та же граница, что у процентной премии официантов
-- (weekStartOf в js/core.js), чтобы у людей не было двух разных «недель».
--
-- Отозванная заявка (cancelled) попытку не тратит: человек сам её снял, до
-- руководства она не дошла. Отклонённая — тратит, иначе ограничение ничего не
-- меняет: сейчас как раз и подают по три-четыре подряд, пока не одобрят.
--
-- Проверка живёт в триггере, а не в приложении: писать в shift_requests может
-- любой авторизованный сотрудник (политика shift_requests_insert), поэтому
-- клиентская проверка — только удобство, а правило должно быть в базе.

create or replace function public.shift_requests_late_weekly_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_week_start date;
  v_prev_date  date;
  v_prev_status text;
begin
  if NEW.kind <> 'late' then return NEW; end if;

  -- date_trunc('week') в Postgres — ISO-неделя, начинается с понедельника
  v_week_start := date_trunc('week', NEW.date)::date;

  select r.date, r.status into v_prev_date, v_prev_status
    from shift_requests r
   where r.employee_id = NEW.employee_id
     and r.kind = 'late'
     and r.status <> 'cancelled'
     and r.date >= v_week_start
     and r.date <  v_week_start + 7
   order by r.created_at
   limit 1;

  if v_prev_date is not null then
    raise exception 'На этой неделе заявка на опоздание уже была — % (%). Следующую можно подать с понедельника %.',
      to_char(v_prev_date, 'DD.MM'),
      case v_prev_status when 'approved' then 'одобрена'
                         when 'rejected' then 'отклонена'
                         else 'на рассмотрении' end,
      to_char(v_week_start + 7, 'DD.MM');
  end if;

  return NEW;
end $$;

drop trigger if exists shift_requests_late_limit_trg on public.shift_requests;
create trigger shift_requests_late_limit_trg
  before insert on public.shift_requests
  for each row execute function public.shift_requests_late_weekly_limit();

-- Отдельной функции-помощника для приложения намеренно нет. Свои заявки
-- сотрудник и так видит по политике shift_requests_select, поэтому телефон
-- считает израсходованные недели обычным запросом; заводить ради этого
-- security definer со свободным employee_id значило бы отдать всем чтение
-- чужих заявок ради удобства формы.
