-- Позиции официантов: ручная правка и «с какого часа делим зал».
--
-- 1) ЗАЛ ОБЩИЙ ДО ПОСЛЕДНЕЙ СМЕНЫ. В будни официанты выходят в 11:00, 15:00 и
--    18:00, и до 18:00 делить нечего: сначала один человек тянет весь зал,
--    потом двое. Позиции начинают работать, когда смена в полном составе.
--    Час не зашиваем: берём самое позднее начало смены официантов в этот день,
--    поэтому в субботу, когда все выходят разом, общего периода не будет вовсе.
--    Кладём в строку раздачи, чтобы телефон не делал ещё один запрос к графику.
--
-- 2) РУЧНАЯ ПРАВКА. Живой зал непредсказуем — банкет, стажёр, кто-то заболел, —
--    и управляющий должен иметь возможность переставить людей. Правки помечаются
--    source='manual' и попадают в статистику наравне с авторасстановкой: иначе
--    она будет врать про то, кто где на самом деле стоял.
--
--    Пересчёт с p_force затирает ручные правки, поэтому право на него — только у
--    управляющего и менеджера. Изнутри базы (cron) auth.uid() пуст, там разрешаем:
--    почасовой прогон всё равно идёт без force и молчит, если раздача уже есть.

alter table public.waiter_position_assignments add column if not exists split_from time;

create or replace function public.waiter_positions_assign(
  p_bday date default null, p_filial text default 'chekhov', p_force boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hist_days constant integer := 14;   -- окно истории «сколько хорошего досталось»
  v_bday date;
  v_emp_ids bigint[]; v_emp_names text[]; v_emp_last bigint[];
  v_n integer; v_k integer; i integer; j integer;
  v_first bigint; v_split time;
  v_ids_i bigint[]; v_w_i integer;
  v_ids_j bigint[]; v_w_j integer;
  v_done integer := 0;
begin
  v_bday := coalesce(p_bday, business_today());

  -- Пересчёт поверх ручной расстановки — только руководству
  if p_force and auth.uid() is not null
     and not exists (select 1 from profiles p
                      where p.user_id = auth.uid() and p.role = any(array['admin','manager'])) then
    raise exception 'Пересчёт позиций доступен только управляющему';
  end if;

  if not p_force and exists (select 1 from waiter_position_assignments
                              where date = v_bday and filial = p_filial) then
    return 0;   -- на сегодня уже роздано
  end if;

  -- Официанты в смене, от «меньше всего доставалось» к «больше всего».
  -- История — накопленный вес за две недели: именно его и выравниваем.
  select array_agg(x.id order by x.hist, x.name),
         array_agg(x.name order by x.hist, x.name),
         array_agg(x.last_pos order by x.hist, x.name)
    into v_emp_ids, v_emp_names, v_emp_last
    from (
      select e.id, e.name,
             coalesce((select sum(a.weight) from waiter_position_assignments a
                        where a.employee_id = e.id and a.filial = p_filial
                          and a.date between v_bday - v_hist_days and v_bday - 1), 0) as hist,
             (select a.position_ids[1] from waiter_position_assignments a
               where a.employee_id = e.id and a.filial = p_filial and a.date < v_bday
               order by a.date desc limit 1) as last_pos
        from schedules s
        join employees e on e.id = s.employee_id
       where s.date = v_bday and s.filial = p_filial
         and not s.is_day_off and e.department = 'Официанты'
    ) x;

  v_n := coalesce(array_length(v_emp_ids, 1), 0);
  if v_n = 0 then return 0; end if;

  -- С какого часа зал делится: последний вышедший официант и есть полный состав
  select max(safe_time(s.shift_start)) into v_split
    from schedules s join employees e on e.id = s.employee_id
   where s.date = v_bday and s.filial = p_filial
     and not s.is_day_off and e.department = 'Официанты';

  create temp table if not exists wp_lots (idx integer primary key, ids bigint[], w integer) on commit drop;
  delete from pg_temp.wp_lots;

  insert into pg_temp.wp_lots (idx, ids, w)
  select row_number() over (order by p.weight desc, p.sort), array[p.id], p.weight
    from waiter_positions p
   where p.filial = p_filial and p.is_active;

  select count(*) into v_k from pg_temp.wp_lots;
  if v_k = 0 then return 0; end if;

  -- Официантов меньше, чем позиций: склеиваем два слабейших лота, пока не
  -- сойдётся. При двоих и наших весах это даёт «топовая одному, средняя со
  -- слабой другому» — 3 против 3, ровно пополам.
  while v_k > v_n loop
    select ids, w into v_ids_i, v_w_i from pg_temp.wp_lots where idx = v_k;
    update pg_temp.wp_lots set ids = ids || v_ids_i, w = w + v_w_i where idx = v_k - 1;
    delete from pg_temp.wp_lots where idx = v_k;
    v_k := v_k - 1;
  end loop;

  -- Официантов больше, чем позиций: у нас не бывает, но пусть лишний встаёт
  -- вторым на самую тяжёлую позицию, а не остаётся без зала вовсе.
  while v_k < v_n loop
    v_k := v_k + 1;
    insert into pg_temp.wp_lots (idx, ids, w) select v_k, ids, w from pg_temp.wp_lots where idx = 1;
  end loop;

  -- Жадно: первый в списке (кому меньше всего доставалось) берёт лучший лот.
  -- Дальше чиним повторы: выпала та же позиция, что в прошлую смену — меняемся
  -- с тем, кому от обмена повтор тоже не грозит.
  --
  -- Меняемся с БЛИЖАЙШИМ по очереди, а не с первым попавшимся. Первый в списке —
  -- самый обделённый, и обмен с ним отдавал лучшую позицию тому, у кого история
  -- и так тяжелее всех.
  for i in 1..v_n loop
    continue when v_emp_last[i] is null;
    select l.ids[1] into v_first from pg_temp.wp_lots l where l.idx = i;
    continue when v_first is distinct from v_emp_last[i];

    select l.idx into j
      from pg_temp.wp_lots l
     where l.idx <> i
       and l.ids[1] is distinct from v_emp_last[i]
       and (v_emp_last[l.idx] is null or v_first is distinct from v_emp_last[l.idx])
     order by abs(l.idx - i), l.idx
     limit 1;
    continue when j is null;

    select ids, w into v_ids_i, v_w_i from pg_temp.wp_lots where idx = i;
    select ids, w into v_ids_j, v_w_j from pg_temp.wp_lots where idx = j;
    update pg_temp.wp_lots set ids = v_ids_j, w = v_w_j where idx = i;
    update pg_temp.wp_lots set ids = v_ids_i, w = v_w_i where idx = j;
  end loop;

  for i in 1..v_n loop
    select ids, w into v_ids_i, v_w_i from pg_temp.wp_lots where idx = i;
    insert into waiter_position_assignments (date, filial, employee_id, employee_name, position_ids, weight, split_from, source)
    values (v_bday, p_filial, v_emp_ids[i], v_emp_names[i], v_ids_i, v_w_i, v_split, 'auto')
    on conflict (date, filial, employee_id) do update
      set position_ids = excluded.position_ids, weight = excluded.weight,
          split_from = excluded.split_from, source = 'auto';
    v_done := v_done + 1;
  end loop;

  return v_done;
end $$;

grant execute on function public.waiter_positions_assign(date, text, boolean) to authenticated;

-- Проставим час деления в уже розданное сегодня, чтобы карточка не молчала до
-- завтрашнего прогона
update public.waiter_position_assignments a
   set split_from = (select max(safe_time(s.shift_start))
                       from schedules s join employees e on e.id = s.employee_id
                      where s.date = a.date and s.filial = a.filial
                        and not s.is_day_off and e.department = 'Официанты')
 where a.split_from is null;
