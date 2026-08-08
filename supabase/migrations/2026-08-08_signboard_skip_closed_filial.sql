-- Вывеска: не напоминать про филиал, который сегодня не работает.
--
-- Было: функция шла циклом по обоим филиалам. В Истикболе смен нет вообще (ни
-- одной за всё время — филиал не запущен), поэтому список официантов выходил
-- пустым и срабатывала запасная ветка «официантов в смене нет — пишем
-- руководству». Владельцу каждый вечер приходило «💡 Включите уличную вывеску ·
-- 📍 Истикбол», а настоящее напоминание по Чехову уходило официантам смены и до
-- него не доходило — со стороны выглядело как «показывает не тот филиал».
--
-- Стало: сначала смотрим, поставлен ли на сегодня хоть кто-то на этот филиал.
-- Никого — вывеску там включать некому, филиал пропускаем. Запасная ветка
-- остаётся для случая, ради которого её и делали: филиал работает, но официанта
-- в смене нет, и без напоминания вывеска провисит всю ночь.

create or replace function public.signboard_reminder(p_action text)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
  v_bday date := business_today();
  v_sent int := 0;
  f text;
  v_open boolean;
  v_ids bigint[];
  v_text text;
  r record;
begin
  foreach f in array array['istikbol','chekhov'] loop
    -- Работает ли филиал сегодня: есть ли хоть одна невыходная смена
    select exists (
      select 1 from schedules s
       where s.date = v_bday and s.filial = f and not coalesce(s.is_day_off, false)
    ) into v_open;
    continue when not v_open;

    select array_agg(e.id) into v_ids
      from schedules s join employees e on e.id = s.employee_id
     where s.date = v_bday and s.filial = f and not coalesce(s.is_day_off, false)
       and e.department = 'Официанты' and coalesce(e.status,'Активен') <> 'Уволен';

    v_text := (case when p_action = 'off'
                    then '🌙 <b>Выключите уличную вывеску</b>' || chr(10) || 'Время — 23:00.'
                    else '💡 <b>Включите уличную вывеску</b>' || chr(10) || 'Время — 18:00.' end)
           || chr(10) || '📍 ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end);

    for r in
      select distinct p.telegram_id
        from profiles p
       where p.telegram_id is not null
         and coalesce((p.notify_prefs->>'signboard')::boolean, true)
         and (
           -- официанты сегодняшней смены, а если их нет — руководство
           (v_ids is not null and p.employee_id = any(v_ids))
           or (v_ids is null and p.role = any(array['admin','manager']))
         )
    loop
      perform net.http_post(
        url := v_fn,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
      v_sent := v_sent + 1;
    end loop;
  end loop;

  return v_sent;
end $$;

revoke all on function public.signboard_reminder(text) from public, anon;
grant execute on function public.signboard_reminder(text) to authenticated;
