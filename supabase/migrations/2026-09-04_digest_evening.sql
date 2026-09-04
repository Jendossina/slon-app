-- Вечерний выпуск дайджеста прихода — в 19:00.
--
-- 3 сентября вечерний выпуск сняли: он уходил в 23:30 и ловил бы пустоту, когда
-- смены с 18:00 закончатся. Единственный выпуск в 16:00 стал брать сутки целиком.
-- Но тогда отметившийся в 16:10 попадает в отчёт только завтра днём, а смотреть
-- ролик смены имеет смысл в тот же вечер, пока человек ещё на месте.
--
-- Поэтому выпуска снова два, но вечерний сдвинут с 23:30 на 19:00 — сразу после
-- того, как вечерняя смена отметилась (за месяц в окно 16:00–19:00 попала 31
-- отметка из 428, после 19:00 — одна).
--
-- Окна не пересекаются и вместе покрывают сутки без дыр:
--   день   (16:00) — вчера с 19:00 и сегодня до 16:00
--   вечер  (19:00) — сегодня с 16:00 до 19:00
-- Один ролик не придёт дважды: окна разные, плюс checkin_digest_notices держит
-- по строке на (дата, выпуск, филиал, получатель).

create or replace function public.checkin_digest(p_part text default 'day')
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_day date; v_prev date; v_sent integer := 0;
  v_from text; v_to text; v_prev_from text; v_tail text;
  f text; r record; v_media jsonb; v_head text; v_total integer; v_off integer;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_day  := public.business_today();
  v_prev := v_day - 1;

  if p_part = 'evening' then
    -- Хвост дня: только сегодняшние 16:00–19:00, вчерашнего не берём
    v_from := '16:00'; v_to := '19:00'; v_prev_from := '99:99'; v_tail := ' · вечер';
  else
    -- Всё остальное: сегодня до 16:00 плюс вчерашний хвост после 19:00
    v_from := '00:00'; v_to := '16:00'; v_prev_from := '19:00'; v_tail := '';
  end if;

  foreach f in array array['chekhov','istikbol'] loop
    select count(*) into v_total
      from attendance a
     where a.filial = f
       and ((a.date = v_day  and a.check_in_time >= v_from and a.check_in_time < v_to)
         or (a.date = v_prev and a.check_in_time >= v_prev_from));
    continue when v_total = 0;

    select '📹 <b>Приход · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end)
           || v_tail || '</b>' || chr(10)
           || 'Отметок: ' || v_total
           || coalesce((select chr(10) || '⚠️ Без видео: ' || string_agg(a2.user_name, ', ')
                          from attendance a2
                         where a2.filial = f and a2.checkin_video is null
                           and ((a2.date = v_day  and a2.check_in_time >= v_from and a2.check_in_time < v_to)
                             or (a2.date = v_prev and a2.check_in_time >= v_prev_from))), '')
      into v_head;

    -- Только управляющие: видео смены — материал для разбора, шире не расходится
    for r in select p.user_id, p.telegram_id
               from profiles p
              where p.telegram_id is not null
                and p.role = 'admin'
                and coalesce(p.notify_prefs ->> 'checkin', 'true') <> 'false'
    loop
      insert into checkin_digest_notices (date, part, filial, recipient, marks)
        values (v_day, p_part, f, r.user_id::text, v_total)
        on conflict (date, part, filial, recipient) do nothing;
      continue when not found;

      perform net.http_post(url := v_fn, timeout_milliseconds := 60000,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_head));

      -- Альбом Telegram вмещает 10 роликов — шлём пачками по 10
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
                   and ((a.date = v_day  and a.check_in_time >= v_from and a.check_in_time < v_to)
                     or (a.date = v_prev and a.check_in_time >= v_prev_from))
                 order by a.date, a.check_in_time
                 offset v_off limit 10) x;
        exit when v_media is null;

        perform net.http_post(url := v_fn, timeout_milliseconds := 120000,
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object('chat_id', r.telegram_id, 'media', v_media));
        v_off := v_off + 10;
        exit when v_off > 60;   -- предохранитель от бесконечного цикла
      end loop;

      v_sent := v_sent + 1;
    end loop;
  end loop;

  return v_sent;
end $function$;

revoke all on function public.checkin_digest(text) from public, anon, authenticated;

-- 11:00 UTC = 16:00 Ташкент · 14:00 UTC = 19:00 Ташкент
select cron.unschedule('checkin-digest-night')
 where exists (select 1 from cron.job where jobname = 'checkin-digest-night');
select cron.unschedule('checkin-digest-evening')
 where exists (select 1 from cron.job where jobname = 'checkin-digest-evening');
select cron.unschedule('checkin-digest-day')
 where exists (select 1 from cron.job where jobname = 'checkin-digest-day');
select cron.schedule('checkin-digest-day',     '0 11 * * *', $cron$select public.checkin_digest('day');$cron$);
select cron.schedule('checkin-digest-evening', '0 14 * * *', $cron$select public.checkin_digest('evening');$cron$);
