-- Старшему цеха — уведомления обо всех движениях своих людей.
--
-- Повод: завели шеф-бармена, который отвечает за бар целиком. Приходы, опоздания
-- и заявки своих он уже получал (notifyDeptSeniors в приложении), а вот
-- невыполненные чек-листы — нет: функция checklist_check_overdue шлёт только тем,
-- кто сегодня на смене, плюс управляющим. Старший цеха, если он сегодня выходной,
-- узнавал о провале постфактум и случайно.
--
-- Делаем ОТДЕЛЬНЫМ триггером, не трогая checklist_check_overdue. Эта функция уже
-- переписывалась пятью миграциями подряд, и вчерашняя правка attendance_guard
-- показала, чем кончается очередное копирование её текста целиком: потерялось
-- разрешение досылать видео, и сутки отметки оставались без записи. Дописывать
-- рядом безопаснее, чем переписывать.

-- Старшие цеха с привязанным телеграмом. Список должностей тот же, что в
-- is_dept_lead и в DEPT_LEADS на клиенте — три места обязаны совпадать.
create or replace function public.dept_leads_with_telegram(p_dept text)
returns table (employee_id bigint, telegram_id text)
language sql stable security definer set search_path = public as $$
  select e.id, p.telegram_id
    from employees e
    join profiles p on p.employee_id = e.id
   where p.telegram_id is not null
     and coalesce(e.status, 'Активен') <> 'Уволен'
     and e.department = p_dept
     and (
       (p_dept = 'Бармены'           and e.role = any(array['Старший бармен','Бар менеджер','Шеф бармен'])) or
       (p_dept = 'Повара'            and e.role = any(array['Су-шеф','Шеф повар'])) or
       (p_dept = 'Кальянные мастера' and e.role = any(array['Старший кальянный мастер','Шеф кальянной станции']))
     );
$$;

-- Невыполненный чек-лист: строка в checklist_misses появляется ровно один раз на
-- случай, поэтому и письмо уйдёт один раз.
create or replace function public.checklist_miss_notify_leads()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
  v_text text;
  v_filial text;
begin
  if NEW.department is null then return NEW; end if;

  select f.name into v_filial from filials f where f.id = NEW.filial;

  v_text := '❌ Чек-лист не сдан вовремя' || chr(10) || chr(10)
         || coalesce(NEW.template_name, '') || chr(10)
         || 'Цех: ' || NEW.department || chr(10)
         || 'Филиал: ' || coalesce(v_filial, NEW.filial) || chr(10)
         || 'Срок был: ' || to_char(NEW.due_time, 'HH24:MI')
         || (case when coalesce(array_length(NEW.employee_names, 1), 0) > 0
                  then chr(10) || 'Ответственные: ' || array_to_string(NEW.employee_names, ', ')
                  else '' end);

  -- Тем, кто сам был ответственным, письмо уже ушло из checklist_check_overdue —
  -- второй раз не шлём.
  --
  -- Вся отправка под обработчиком ошибок: это триггер на вставку, и падение
  -- уведомления откатило бы саму запись о невыполнении. Учёт важнее письма.
  begin
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

drop trigger if exists checklist_miss_notify_leads_trg on public.checklist_misses;
create trigger checklist_miss_notify_leads_trg
  after insert on public.checklist_misses
  for each row execute function public.checklist_miss_notify_leads();
