-- У рабочего аккаунта владельца в имени профиля стояла почта, поэтому он
-- подписывался как «vorobeyxxx@inbox.ru» в чек-листах, уведомлениях и отчётах.
-- Ставим настоящее имя и переподписываем уже сохранённые отметки.

update public.profiles
   set name = 'Самойлов Евгений Евгеньевич'
 where name = 'vorobeyxxx@inbox.ru';

-- Кто заполнял чек-лист (подпись строки)
update public.checklist_logs
   set user_name = 'Самойлов Евгений Евгеньевич'
 where user_name = 'vorobeyxxx@inbox.ru';

-- Кто отметил каждый пункт: items_by — объект {id_пункта: имя}
update public.checklist_logs l
   set items_by = (
     select jsonb_object_agg(kv.k, case when kv.v = 'vorobeyxxx@inbox.ru'
                                        then '"Самойлов Евгений Евгеньевич"'::jsonb
                                        else to_jsonb(kv.v) end)
       from jsonb_each_text(l.items_by) kv(k, v)
   )
 where l.items_by is not null
   and l.items_by::text like '%vorobeyxxx@inbox.ru%';
