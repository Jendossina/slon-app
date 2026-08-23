-- Напоминание в 18:00 бару и кухне: заполнить го/стоп-лист.
--
-- Стоп — чего нет, го — что продаём в первую очередь. Ставит тот, кто отвечает
-- за продукт: повар по кухне, бармен по бару. К вечеру уже видно, что кончается
-- и что залежалось, а до вечернего наплыва ещё есть время предупредить зал.
--
-- Шлём ТОЛЬКО тем, кто сегодня в смене на этом филиале: напоминание выходному
-- обесценивает все остальные сообщения бота.
--
-- И только если за этот кассовый день по своей области ещё ничего не поставили.
-- Сделал — не дёргаем.

-- Есть ли что напоминать: p_area — 'kitchen' или 'bar'.
-- Вынесено отдельно, чтобы прогонять в транзакции с откатом, никому не отправляя.
create or replace function public.stoplist_needs_reminder(p_filial text, p_area text, p_bday date default public.business_today())
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from stoplist_items i
     where i.filial = p_filial
       and i.area = p_area
       -- кассовый день начинается в 08:00 и заканчивается в 08:00 следующего
       and i.created_at >= (public.bday_ts(p_bday, time '08:00') at time zone 'Asia/Tashkent')
       and i.created_at <  (public.bday_ts(p_bday + 1, time '08:00') at time zone 'Asia/Tashkent')
  );
$$;

create or replace function public.stoplist_remind()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  f text; a text; v_dept text; v_bday date := public.business_today();
  r record; v_text text; v_sent integer := 0;
begin
  foreach f in array array['chekhov','istikbol'] loop
    foreach a in array array['kitchen','bar'] loop
      continue when not public.stoplist_needs_reminder(f, a, v_bday);

      v_dept := case a when 'kitchen' then 'Повара' else 'Бармены' end;

      v_text := '📋 Го/стоп-лист на вечер' || chr(10) || chr(10)
             || 'Что закончилось — в стоп, что надо продать в первую очередь — в го.' || chr(10)
             || 'Зал увидит сразу: официантам уходит уведомление.' || chr(10) || chr(10)
             || 'Приложение → Ещё → Го/стоп-лист.';

      for r in
        select distinct p.telegram_id
          from schedules s
          join employees e on e.id = s.employee_id
          join profiles p  on p.employee_id = e.id
         where s.filial = f
           and s.date = v_bday
           and coalesce(s.is_day_off, false) = false
           and e.department = v_dept
           and coalesce(e.status, 'Активен') <> 'Уволен'
           and p.telegram_id is not null
      loop
        perform net.http_post(
          url := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
        v_sent := v_sent + 1;
      end loop;
    end loop;
  end loop;

  return v_sent;
end $$;

-- 13:00 UTC = 18:00 по Ташкенту.
select cron.unschedule('stoplist-remind')
 where exists (select 1 from cron.job where jobname = 'stoplist-remind');

select cron.schedule('stoplist-remind', '0 13 * * *', 'select public.stoplist_remind();');

-- Вызывать их из браузера незачем: это рассылка по расписанию.
revoke all on function public.stoplist_remind() from public, anon, authenticated;
revoke all on function public.stoplist_needs_reminder(text, text, date) from public, anon, authenticated;
