-- Чек-листы жили по КАЛЕНДАРНОЙ дате, а смена идёт до ~03:00. Поэтому чек-лист
-- закрытия, заполненный после полуночи, попадал в следующий день: заполнили в
-- 01:35 в ночь на 27-е — записалось 27-м, хотя это смена 26-го.
--
-- Приложение переведено на кассовый день (businessToday, граница 08:00). Здесь
-- переносим уже записанное. Если на дне назначения запись есть — сливаем.

do $$
declare r record; v_target date; v_exists bigint; v_done jsonb; v_by jsonb; v_media jsonb; v_total int;
begin
  for r in
    select l.*, (l.created_at at time zone 'Asia/Tashkent')::date as created_day
      from checklist_logs l
     where extract(hour from (l.created_at at time zone 'Asia/Tashkent')) < 8
     order by l.id
  loop
    -- переносим только те, что записались днём своего создания: до 08:00 это ещё вчерашняя смена
    continue when r.date <> r.created_day;
    v_target := r.date - 1;

    select id into v_exists from checklist_logs
     where template_id = r.template_id and date = v_target and filial = r.filial
     limit 1;

    if v_exists is null then
      update checklist_logs set date = v_target where id = r.id;
    else
      -- на целевом дне уже есть запись: объединяем отметки, фото и авторство
      select coalesce(jsonb_agg(distinct e), '[]'::jsonb) into v_done
        from (
          select e from checklist_logs l, jsonb_array_elements(coalesce(l.items_done,'[]'::jsonb)) e
           where l.id in (r.id, v_exists)
        ) s;
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_by
        from (select distinct on (kv.k) kv.k, kv.v
                from checklist_logs l, jsonb_each(coalesce(l.items_by,'{}'::jsonb)) kv(k, v)
               where l.id in (r.id, v_exists) order by kv.k, l.id) s;
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_media
        from (select distinct on (kv.k) kv.k, kv.v
                from checklist_logs l, jsonb_each(coalesce(l.items_media,'{}'::jsonb)) kv(k, v)
               where l.id in (r.id, v_exists) order by kv.k, l.id) s;

      select jsonb_array_length(coalesce(items,'[]'::jsonb)) into v_total
        from checklist_templates where id = r.template_id;

      update checklist_logs
         set items_done = v_done, items_by = v_by, items_media = v_media,
             completed = (coalesce(v_total,0) > 0 and jsonb_array_length(v_done) >= v_total)
       where id = v_exists;
      delete from checklist_logs where id = r.id;
    end if;
  end loop;
end $$;
