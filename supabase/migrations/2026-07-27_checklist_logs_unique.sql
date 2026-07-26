-- Галочки в чек-листах «слетали»: на один чек-лист за день могло появиться
-- НЕСКОЛЬКО строк (двое отмечают одновременно — каждый создаёт свою). Приложение
-- при загрузке берёт одну из них, и отметки из остальных пропадали.
-- В данных это видно прямо: 3 галочки против 25 за один и тот же день.
--
-- Сначала сливаем дубликаты в одну строку, потом запрещаем их появление.

do $$
declare r record; v_keep bigint; v_done jsonb; v_by jsonb; v_total int;
begin
  for r in
    select template_id, date, filial
      from checklist_logs
     group by template_id, date, filial
    having count(*) > 1
  loop
    -- оставляем самую заполненную строку
    select id into v_keep from checklist_logs
     where template_id = r.template_id and date = r.date and filial = r.filial
     order by jsonb_array_length(coalesce(items_done,'[]'::jsonb)) desc, id
     limit 1;

    -- объединение отметок из всех дублей
    select coalesce(jsonb_agg(distinct e), '[]'::jsonb) into v_done
      from checklist_logs l, jsonb_array_elements(coalesce(l.items_done,'[]'::jsonb)) e
     where l.template_id = r.template_id and l.date = r.date and l.filial = r.filial;

    -- кто что отметил: при конфликте берём запись из более ранней строки
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_by
      from (
        select distinct on (kv.k) kv.k, kv.v
          from checklist_logs l, jsonb_each(coalesce(l.items_by,'{}'::jsonb)) as kv(k, v)
         where l.template_id = r.template_id and l.date = r.date and l.filial = r.filial
         order by kv.k, l.id
      ) s;

    select jsonb_array_length(coalesce(items,'[]'::jsonb)) into v_total
      from checklist_templates where id = r.template_id;

    update checklist_logs
       set items_done = v_done,
           items_by   = v_by,
           completed  = (coalesce(v_total,0) > 0 and jsonb_array_length(v_done) >= v_total)
     where id = v_keep;

    delete from checklist_logs
     where template_id = r.template_id and date = r.date and filial = r.filial and id <> v_keep;
  end loop;
end $$;

-- Один чек-лист на отдел/филиал в день. Второй вставке база теперь откажет,
-- и приложение подхватит уже существующую строку вместо создания своей.
create unique index if not exists checklist_logs_one_per_day
  on public.checklist_logs (template_id, date, filial);
