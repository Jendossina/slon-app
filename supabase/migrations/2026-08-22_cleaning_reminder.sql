-- Напоминание о генеральной уборке в 12:00.
--
-- Уборка идёт по субботам в Чехове и по воскресеньям в Истикболе, и запускает
-- её менеджер руками. Забыть легко: день выходной, людей много, а кнопка одна.
-- В полдень напоминаем — до конца смены остаётся время и раздать работы, и их
-- сделать.
--
-- Напоминаем ТОЛЬКО если уборку ещё не запускали: сообщение о том, что и так
-- сделано, обесценивает все остальные напоминания бота.
--
-- Проверка вынесена в отдельную функцию, а не спрятана внутри рассылки: так её
-- можно прогнать в транзакции с откатом, не отправляя людям ничего.
-- Прежняя версия с одним аргументом убирается: рядом с новой (у которой дата
-- со значением по умолчанию) вызов с одним аргументом стал бы неоднозначным.
drop function if exists public.cleaning_needs_reminder(text);

-- Дата параметром, а не только business_today(): иначе положительную ветку не
-- проверить — уборочный день наступает раз в неделю, и до него не дождаться.
create or replace function public.cleaning_needs_reminder(p_filial text, p_date date default public.business_today())
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- день уборки этого филиала: Чехов — суббота (6), Истикбол — воскресенье (0)
    extract(dow from p_date) =
      case p_filial when 'chekhov' then 6 when 'istikbol' then 0 else -1 end
    -- и её в этот день ещё не начинали (отменённая не считается — можно заново)
    and not exists (
      select 1 from cleanings c
       where c.filial = p_filial
         and c.date = p_date
         and c.status in ('open', 'done')
    );
$$;

create or replace function public.cleaning_remind()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  f text;
  r record;
  v_text text;
  v_tasks integer;
  v_sent integer := 0;
begin
  foreach f in array array['chekhov','istikbol'] loop
    continue when not public.cleaning_needs_reminder(f);

    select count(*) into v_tasks from cleaning_tasks where filial = f and is_active;

    v_text := '🧹 Сегодня генеральная уборка' || chr(10) || chr(10)
           || '📍 ' || coalesce((select name from filials where id = f), f) || chr(10)
           || 'Уборку ещё не запускали.' || chr(10) || chr(10)
           || case when v_tasks = 0
                   then '⚠️ Список работ пуст — сначала заполни его: Ещё → Ген-уборка → Список работ.'
                   else 'Открой приложение → Ещё → Ген-уборка и раздай работы тем, кто сегодня в смене.' end;

    -- Запускать уборку может только руководство, значит и напоминание — ему.
    -- Но не всему: менеджеру Истикбола незачем знать, что в Чехове не начали.
    -- Управляющие без карточки сотрудника (владелец) получают по обоим филиалам —
    -- у них нет привязки, и пропустить им напоминание хуже, чем прислать лишнее.
    for r in
      select distinct p.telegram_id
        from profiles p
        left join employees e on e.id = p.employee_id
       where p.telegram_id is not null
         and p.role = any(array['admin','manager'])
         and (e.id is null or coalesce(array_length(e.filials, 1), 0) = 0 or f = any(e.filials))
    loop
      perform net.http_post(
        url := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
      v_sent := v_sent + 1;
    end loop;
  end loop;

  return v_sent;
end $$;

-- 07:00 UTC = 12:00 по Ташкенту. Смещение не переносит день: и час, и день
-- недели остаются субботой/воскресеньем по местному времени.
select cron.unschedule('cleaning-remind')
 where exists (select 1 from cron.job where jobname = 'cleaning-remind');

select cron.schedule('cleaning-remind', '0 7 * * *', 'select public.cleaning_remind();');
