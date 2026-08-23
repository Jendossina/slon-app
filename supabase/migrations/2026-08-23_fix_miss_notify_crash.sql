-- Чинит запись невыполнений: она не работала с 15.08.
--
-- Что случилось. Миграция 2026-08-15_dept_lead_notifications добавила триггер,
-- который пишет старшим цеха о несданном чек-листе. В тексте сообщения он звал
-- array_length(NEW.employee_names, 1), считая колонку массивом. Она text.
-- Postgres не находит array_length(text, integer) и роняет ВСЮ вставку —
-- а вставку делает checklist_check_overdue по расписанию.
--
-- Итог: последняя запись о невыполнении — 14.08. Девять дней ни невыполнений,
-- ни баллов, ни уведомлений старшим. Истикбол открылся 16.08 и не увидел
-- ни одного — весь его срок жизни пришёлся на сломанное окно.
--
-- Почему обработчик ошибок не спас: он стоял вокруг ОТПРАВКИ, а упало
-- составление текста — строкой выше. Поэтому теперь под защитой весь блок,
-- включая сборку сообщения: запись о невыполнении не должна зависеть ни от
-- одной строчки, которая нужна только для письма.
--
-- Проверять такие вещи надо вставкой в транзакции с откатом, а не чтением кода:
-- ошибка типов живёт до первого настоящего вызова.

create or replace function public.checklist_miss_notify_leads()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
  v_text text;
  v_filial text;
begin
  if NEW.department is null then return NEW; end if;

  -- Всё, что нужно только для письма, — под обработчиком ошибок. Это триггер на
  -- вставке: любое падение здесь откатывает саму запись о невыполнении, а учёт
  -- важнее письма.
  begin
    select f.name into v_filial from filials f where f.id = NEW.filial;

    v_text := '❌ Чек-лист не сдан вовремя' || chr(10) || chr(10)
           || coalesce(NEW.template_name, '') || chr(10)
           || 'Цех: ' || NEW.department || chr(10)
           || 'Филиал: ' || coalesce(v_filial, NEW.filial) || chr(10)
           || 'Срок был: ' || to_char(NEW.due_time, 'HH24:MI')
           -- employee_names — строка с именами через запятую, а не массив
           || (case when coalesce(NEW.employee_names, '') <> ''
                    then chr(10) || 'Ответственные: ' || NEW.employee_names
                    else '' end);

    -- Тем, кто сам был ответственным, письмо уже ушло из checklist_check_overdue —
    -- второй раз не шлём.
    for r in
      select l.telegram_id
        from public.dept_leads_with_telegram(NEW.department) l
       where not (l.employee_id = any(coalesce(NEW.employee_ids, array[]::bigint[])))
    loop
      perform net.http_post(
        url := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
    end loop;
  exception when others then
    raise warning 'checklist_miss_notify_leads: % (%)', sqlerrm, sqlstate;
  end;

  return NEW;
end $$;
