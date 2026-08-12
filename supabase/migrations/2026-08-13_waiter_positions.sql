-- Позиции официантов: кто какие столы обслуживает сегодня.
--
-- Раньше это делили вечером на словах и неровно: топовая позиция могла достаться
-- одному и тому же несколько смен подряд. Теперь раздача считается заранее и
-- смотрит на историю.
--
-- Решения владельца (13.08.2026):
--   • только Чехов;
--   • позиции неравноценные, выравниваем не число смен, а «сколько хорошего
--     досталось» — у позиции есть вес;
--   • официантов всегда трое, изредка двое, четверых не бывает;
--   • раздаёт автомат, управляющий может переставить.
--
-- Вес задаётся числом, а не считается по выручке: выручку в разрезе столов
-- приложение не видит, она живёт в iiko. Топовая 3, средняя 2, слабая 1.

create table if not exists public.waiter_positions (
  id          bigserial primary key,
  filial      text    not null default 'chekhov',
  name        text    not null,
  tables_list text    not null,          -- как показываем человеку: «1, 2, 3, 4, 15»
  weight      integer not null default 1,
  sort        integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (filial, name)
);

-- Раздача на кассовый день. Одна строка на официанта: позиций может быть
-- несколько, когда официантов меньше, чем позиций.
create table if not exists public.waiter_position_assignments (
  id            bigserial primary key,
  date          date    not null,
  filial        text    not null,
  employee_id   bigint  not null,
  employee_name text,
  position_ids  bigint[] not null,
  weight        integer not null default 0,   -- сумма весов доставшегося, для статистики
  source        text    not null default 'auto' check (source in ('auto','manual')),
  created_at    timestamptz not null default now(),
  unique (date, filial, employee_id)
);
create index if not exists waiter_pos_assign_date_idx on public.waiter_position_assignments (date, filial);

alter table public.waiter_positions enable row level security;
alter table public.waiter_position_assignments enable row level security;

drop policy if exists waiter_positions_select on public.waiter_positions;
create policy waiter_positions_select on public.waiter_positions for select to authenticated using (true);
drop policy if exists waiter_positions_write on public.waiter_positions;
create policy waiter_positions_write on public.waiter_positions for all to authenticated
  using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])))
  with check (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

-- Раздачу видят все: официанту важно знать не только свою позицию, но и кто
-- рядом. Менять — только руководство.
drop policy if exists waiter_pos_assign_select on public.waiter_position_assignments;
create policy waiter_pos_assign_select on public.waiter_position_assignments for select to authenticated using (true);
drop policy if exists waiter_pos_assign_write on public.waiter_position_assignments;
create policy waiter_pos_assign_write on public.waiter_position_assignments for all to authenticated
  using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])))
  with check (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

-- Карта зала. Повторный прогон файла не плодит дубли и не затирает вес, если
-- его успели поправить руками.
insert into public.waiter_positions (filial, name, tables_list, weight, sort)
values ('chekhov', 'Позиция 1', '1, 2, 3, 4, 15',        2, 1),
       ('chekhov', 'Позиция 2', '5, 6, 7, 8, 9, 10, 11', 3, 2),
       ('chekhov', 'Позиция 3', '12, 13, 14, 16, 17',    1, 3)
on conflict (filial, name) do nothing;

-- ===== Раздача =====
-- В двух словах: кому за последние две недели меньше всего досталось хорошего —
-- тому лучшая позиция, но не та же, что в прошлую смену.
--
-- Лоты держим во временной таблице, а не в массиве: лот — это набор позиций
-- переменной длины (при двух официантах слабые склеиваются в один), а массивы
-- в PostgreSQL обязаны быть прямоугольными и такого не позволяют. Обращаемся к
-- ней всегда как pg_temp.wp_lots: функция security definer, и полагаться на
-- search_path тут нельзя.
--
-- Считается один раз на день: если раздача уже есть, функция молчит. Иначе
-- официант, посмотревший позицию утром, к вечеру увидел бы другую.
create or replace function public.waiter_positions_assign(
  p_bday date default null, p_filial text default 'chekhov', p_force boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hist_days constant integer := 14;   -- окно истории «сколько хорошего досталось»
  v_bday date;
  v_emp_ids bigint[]; v_emp_names text[]; v_emp_last bigint[];
  v_n integer; v_k integer; i integer; j integer;
  v_first bigint;
  v_ids_i bigint[]; v_w_i integer;
  v_ids_j bigint[]; v_w_j integer;
  v_done integer := 0;
begin
  v_bday := coalesce(p_bday, business_today());

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
  -- и так тяжелее всех: на проверке 16 августа топовая позиция уходила Вахабову
  -- вместо Нурмухамедовой. Соседний обмен ломает очередь минимально.
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
    insert into waiter_position_assignments (date, filial, employee_id, employee_name, position_ids, weight, source)
    values (v_bday, p_filial, v_emp_ids[i], v_emp_names[i], v_ids_i, v_w_i, 'auto')
    on conflict (date, filial, employee_id) do update
      set position_ids = excluded.position_ids, weight = excluded.weight, source = 'auto';
    v_done := v_done + 1;
  end loop;

  return v_done;
end $$;

-- Раз в час: график могли дописать позже. Раздача идемпотентна — если она уже
-- есть, функция молчит и ничего не перетасовывает.
select cron.unschedule('waiter-positions') where exists (select 1 from cron.job where jobname = 'waiter-positions');
select cron.schedule('waiter-positions', '5 * * * *', 'select public.waiter_positions_assign();');
