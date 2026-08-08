-- Инвентаризация посуды силами официантов.
--
-- Как это работает вживую:
--   1. Управляющий открывает инвентаризацию по филиалу — одну за раз.
--   2. Официанты берут телефон, ходят по залу/бару/кухне и вбивают фактическое
--      количество каждой позиции. Учётный остаток им не показывается: считаем
--      вслепую, иначе человек подгоняет цифру под систему, а не пересчитывает.
--   3. Управляющий смотрит расхождения (было / стало / убыток) и утверждает.
--      Только в этот момент правятся остатки — до утверждения каталог не трогаем.
--
-- Почему пересчёт лежит отдельной таблицей, а не пишется сразу в dishware_items:
-- иначе ошибка ввода («118» вместо «181») мгновенно становится учётным остатком,
-- и откатить её можно только руками, вспоминая, что там было до этого.

-- ===== Сессия инвентаризации =====
create table if not exists public.dishware_inventories (
  id              bigserial primary key,
  filial          text not null,
  date            date not null default public.business_today(),
  status          text not null default 'open',   -- open | applied | cancelled
  started_by      uuid,
  started_by_name text,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  closed_by       uuid,
  closed_by_name  text,
  note            text
);

-- Открытая инвентаризация в филиале может быть только одна: две параллельные
-- означают, что половина официантов считает в одну, половина в другую, и итог
-- не сходится ни с чем.
create unique index if not exists dishware_inventories_one_open
  on public.dishware_inventories (filial) where status = 'open';

-- ===== Пересчёт одной позиции =====
create table if not exists public.dishware_counts (
  id           bigserial primary key,
  inventory_id bigint not null references public.dishware_inventories(id) on delete cascade,
  item_id      bigint not null references public.dishware_items(id) on delete cascade,
  qty          numeric not null,
  expected_qty numeric,                  -- учётный остаток на момент ввода, для разбора спорных случаев
  user_id      uuid,
  user_name    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (inventory_id, item_id)         -- пересчитали вдвоём — остаётся последняя цифра
);

create index if not exists dishware_counts_inventory_idx on public.dishware_counts (inventory_id);

alter table public.dishware_inventories enable row level security;
alter table public.dishware_counts      enable row level security;

-- Видят все: официанту нужно знать, идёт ли инвентаризация и что уже посчитано.
drop policy if exists dishware_inv_select on public.dishware_inventories;
create policy dishware_inv_select on public.dishware_inventories for select using (true);

-- Открывает, отменяет и утверждает — только руководство.
drop policy if exists dishware_inv_write on public.dishware_inventories;
create policy dishware_inv_write on public.dishware_inventories for insert
with check (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

drop policy if exists dishware_inv_update on public.dishware_inventories;
create policy dishware_inv_update on public.dishware_inventories for update
using      (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])))
with check (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

drop policy if exists dishware_inv_delete on public.dishware_inventories;
create policy dishware_inv_delete on public.dishware_inventories for delete
using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

drop policy if exists dishware_counts_select on public.dishware_counts;
create policy dishware_counts_select on public.dishware_counts for select using (true);

-- Писать факт можно только в открытую инвентаризацию. Закрытая — это документ:
-- дописать в неё цифру задним числом нельзя никому, включая руководство.
drop policy if exists dishware_counts_write on public.dishware_counts;
create policy dishware_counts_write on public.dishware_counts for insert
with check (exists (select 1 from dishware_inventories i where i.id = inventory_id and i.status = 'open'));

drop policy if exists dishware_counts_update on public.dishware_counts;
create policy dishware_counts_update on public.dishware_counts for update
using      (exists (select 1 from dishware_inventories i where i.id = inventory_id and i.status = 'open'))
with check (exists (select 1 from dishware_inventories i where i.id = inventory_id and i.status = 'open'));

drop policy if exists dishware_counts_delete on public.dishware_counts;
create policy dishware_counts_delete on public.dishware_counts for delete
using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])));

-- Автора пересчёта ставит сервер, а не клиент: подписаться чужим именем нельзя.
create or replace function public.dishware_count_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    NEW.user_id := auth.uid();
    NEW.user_name := coalesce((select p.name from profiles p where p.user_id = auth.uid()), NEW.user_name);
  end if;
  if TG_OP = 'UPDATE' then
    NEW.inventory_id := OLD.inventory_id;
    NEW.item_id := OLD.item_id;
    NEW.updated_at := now();
  end if;
  return NEW;
end $$;

drop trigger if exists dishware_count_guard_trg on public.dishware_counts;
create trigger dishware_count_guard_trg
  before insert or update on public.dishware_counts
  for each row execute function public.dishware_count_guard();

-- ===== Утверждение =====
-- Одной транзакцией: правим остатки, пишем движения «инвентаризация» и закрываем
-- сессию. Клиенту это отдавать нельзя — шесть десятков позиций уходили бы шестью
-- десятками запросов, и обрыв связи на середине оставил бы половину каталога
-- поправленной, а половину нет.
--
-- Остаток становится равен факту: смысл инвентаризации в том, что истина — то,
-- что человек пересчитал руками. Позиции, которые никто не посчитал, не трогаем.
create or replace function public.apply_dishware_inventory(p_inventory_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_inv       public.dishware_inventories;
  v_name      text;
  v_counted   int := 0;
  v_changed   int := 0;
  v_diff_qty  numeric := 0;
  v_diff_loss numeric := 0;
  r           record;
begin
  if not exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = any(array['admin','manager'])) then
    raise exception 'Утверждать инвентаризацию может только управляющий';
  end if;

  select * into v_inv from dishware_inventories where id = p_inventory_id for update;
  if v_inv.id is null then raise exception 'Инвентаризация не найдена'; end if;
  if v_inv.status <> 'open' then raise exception 'Эта инвентаризация уже закрыта'; end if;

  select p.name into v_name from profiles p where p.user_id = auth.uid();

  for r in
    select c.item_id, c.qty as fact, i.qty as stock, i.cost
      from dishware_counts c
      join dishware_items i on i.id = c.item_id
     where c.inventory_id = p_inventory_id
  loop
    v_counted := v_counted + 1;
    if r.fact is distinct from r.stock then
      update dishware_items set qty = r.fact where id = r.item_id;
      insert into dishware_moves (item_id, move_type, qty, cost_at_moment, filial, user_id, user_name, note)
      values (r.item_id, 'inventory', r.fact - coalesce(r.stock,0), r.cost, v_inv.filial,
              auth.uid(), coalesce(v_name,'—'),
              'Инвентаризация ' || to_char(v_inv.date, 'DD.MM.YYYY'));
      v_changed   := v_changed + 1;
      v_diff_qty  := v_diff_qty + (r.fact - coalesce(r.stock,0));
      v_diff_loss := v_diff_loss + (r.fact - coalesce(r.stock,0)) * coalesce(r.cost,0);
    end if;
  end loop;

  update dishware_inventories
     set status = 'applied', closed_at = now(), closed_by = auth.uid(), closed_by_name = coalesce(v_name,'—')
   where id = p_inventory_id;

  return json_build_object('counted', v_counted, 'changed', v_changed,
                           'diff_qty', v_diff_qty, 'diff_loss', v_diff_loss);
end $$;

revoke all on function public.apply_dishware_inventory(bigint) from public, anon;
grant execute on function public.apply_dishware_inventory(bigint) to authenticated;
