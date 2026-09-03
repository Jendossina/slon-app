-- Дайджест без строки про подтверждение присутствия.
-- Само подтверждение убрано (2026-09-04_drop_attendance_confirm), а функция
-- дайджеста ещё считала неподтверждённых — упала бы на несуществующей колонке.

create or replace function public.checkin_digest(p_part text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_day date; v_from text; v_to text; v_sent integer := 0;
  f text; r record; v_media jsonb; v_head text; v_total integer; v_off integer;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_day := public.business_today();
  if p_part = 'day' then v_from := '00:00'; v_to := '16:00';
  else                   v_from := '16:00'; v_to := '99:99'; end if;

  foreach f in array array['chekhov','istikbol'] loop
    select count(*) into v_total
      from attendance a
     where a.date = v_day and a.filial = f
       and a.check_in_time >= v_from and a.check_in_time < v_to;
    continue when v_total = 0;

    select '📹 <b>Приход · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || '</b>' || chr(10)
           || 'Отметок: ' || v_total
           || coalesce((select chr(10) || '⚠️ Без видео: ' || string_agg(a2.user_name, ', ')
                          from attendance a2
                         where a2.date = v_day and a2.filial = f
                           and a2.check_in_time >= v_from and a2.check_in_time < v_to
                           and a2.checkin_video is null), '')
      into v_head;

    for r in select * from public.notify_chiefs(f)
             where coalesce(notify_prefs ->> 'checkin', 'true') <> 'false'
    loop
      insert into checkin_digest_notices (date, part, filial, recipient, marks)
        values (v_day, p_part, f, r.user_id::text, v_total)
        on conflict (date, part, filial, recipient) do nothing;
      continue when not found;

      perform net.http_post(url := v_fn, timeout_milliseconds := 60000,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_head));

      v_off := 0;
      loop
        select jsonb_agg(jsonb_build_object('type','video','media', x.checkin_video,
                 'caption', x.user_name || ' · ' || x.check_in_time
                            || case when x.is_late then ' · опоздание' else '' end))
          into v_media
          from (select a.user_name, a.check_in_time, a.checkin_video, a.is_late
                  from attendance a
                 where a.date = v_day and a.filial = f
                   and a.check_in_time >= v_from and a.check_in_time < v_to
                   and a.checkin_video is not null
                 order by a.check_in_time
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
