-- Один выпуск дайджеста вместо двух.
--
-- Вечерний убран: со следующей недели смен с 18:00 не будет, и он ловил бы
-- пустоту. За три недели в его окно попадало 25 отметок из 350 — все между
-- 16:11 и 18:45, то есть ровно поздние смены, которых больше не будет.
--
-- Но просто снять вечерний запуск нельзя: отметки после 16:00 остались бы без
-- выпуска вообще — опоздавший на дневную смену пропал бы из отчёта молча.
-- Поэтому единственный выпуск в 16:00 берёт сутки целиком: со вчерашних 16:00
-- по сегодняшние. Хвост вчерашнего дня попадает в него с датой в подписи, и
-- ничего не теряется.
--
-- Параметр p_part оставлен ради совместимости с расписанием, но игнорируется:
-- выпуск ровно один.

create or replace function public.checkin_digest(p_part text default 'day')
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_day date; v_prev date; v_sent integer := 0;
  f text; r record; v_media jsonb; v_head text; v_total integer; v_off integer;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_day  := public.business_today();
  v_prev := v_day - 1;

  foreach f in array array['chekhov','istikbol'] loop
    -- Окно: вчера с 16:00 и сегодня до 16:00
    select count(*) into v_total
      from attendance a
     where a.filial = f
       and ((a.date = v_day  and a.check_in_time <  '16:00')
         or (a.date = v_prev and a.check_in_time >= '16:00'));
    continue when v_total = 0;

    select '📹 <b>Приход · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || '</b>' || chr(10)
           || 'Отметок: ' || v_total
           || coalesce((select chr(10) || '⚠️ Без видео: ' || string_agg(a2.user_name, ', ')
                          from attendance a2
                         where a2.filial = f and a2.checkin_video is null
                           and ((a2.date = v_day  and a2.check_in_time <  '16:00')
                             or (a2.date = v_prev and a2.check_in_time >= '16:00'))), '')
      into v_head;

    -- Только управляющие: видео смены — материал для разбора, шире не расходится
    for r in select p.user_id, p.telegram_id
               from profiles p
              where p.telegram_id is not null
                and p.role = 'admin'
                and coalesce(p.notify_prefs ->> 'checkin', 'true') <> 'false'
    loop
      insert into checkin_digest_notices (date, part, filial, recipient, marks)
        values (v_day, 'day', f, r.user_id::text, v_total)
        on conflict (date, part, filial, recipient) do nothing;
      continue when not found;

      perform net.http_post(url := v_fn, timeout_milliseconds := 60000,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_head));

      v_off := 0;
      loop
        select jsonb_agg(jsonb_build_object('type','video','media', x.checkin_video,
                 'caption', x.user_name || ' · ' || x.check_in_time
                            || case when x.date <> v_day then ' · ' || to_char(x.date,'DD.MM') else '' end
                            || case when x.is_late then ' · опоздание' else '' end))
          into v_media
          from (select a.user_name, a.check_in_time, a.checkin_video, a.is_late, a.date
                  from attendance a
                 where a.filial = f and a.checkin_video is not null
                   and ((a.date = v_day  and a.check_in_time <  '16:00')
                     or (a.date = v_prev and a.check_in_time >= '16:00'))
                 order by a.date, a.check_in_time
                 offset v_off limit 10) x;
        exit when v_media is null;

        perform net.http_post(url := v_fn, timeout_milliseconds := 120000,
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object('chat_id', r.telegram_id, 'media', v_media));
        v_off := v_off + 10;
        exit when v_off > 60;
      end loop;

      v_sent := v_sent + 1;
    end loop;
  end loop;

  return v_sent;
end $function$;

select cron.unschedule('checkin-digest-night')
 where exists (select 1 from cron.job where jobname = 'checkin-digest-night');
