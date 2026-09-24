-- Экраны в гостевой зоне: своя витрина вместо ютуба с флешки.
--
-- Как устроено. На телевизорах в зале крутится ролик с YouTube (обычно на два
-- часа). Раз в несколько минут приложение ставит его на паузу, показывает
-- карточку с акцией на двадцать секунд и продолжает ролик с той же секунды.
-- Звук с телевизоров в зал не идёт (музыка играет отдельно, через колонки),
-- поэтому пауза в картинке ничего не рвёт.
--
-- Экран в этой таблице — это ПЛЕЕР, а не панель. В Чехове один бокс раздаёт
-- картинку по HDMI сразу на два телевизора и проектор — это одна строка.
--
-- Страница плеера (/tv.html?code=...) открывается на боксе без логина, поэтому
-- читать обе таблицы разрешено всем: там нет ничего, кроме того, что и так
-- висит на стене в зале. Писать может только управляющий, а отметку «экран на
-- связи» плеер ставит через функцию screen_ping — чтобы из зала нельзя было
-- переписать ничего другого.

create table if not exists public.screens (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  -- код в адресе страницы: /tv.html?code=A1B2C3
  code             text not null unique default upper(substr(md5(random()::text), 1, 6)),
  name             text not null,
  filial           text,
  youtube_url      text,
  insert_every_min integer not null default 15,   -- как часто врезаться
  slide_seconds    integer not null default 20,   -- сколько держать карточку
  slides_per_break integer not null default 1,    -- сколько карточек за один раз
  is_active        boolean not null default true,
  last_seen_at     timestamptz,                   -- когда плеер последний раз отозвался
  last_slide       text                           -- что показывал в тот момент
);

create table if not exists public.screen_slides (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  -- пусто в обоих полях — врезка идёт на всех экранах
  screen_id    bigint references public.screens(id) on delete cascade,
  filial       text,
  kind         text not null default 'card',      -- card | image
  title        text,
  body         text,
  note         text,                              -- цена или короткая подпись
  image_url    text,
  sort         integer not null default 100,
  duration_sec integer,                           -- пусто — берём длительность с экрана
  is_active    boolean not null default true,
  -- «настраиваем заранее»: показывать только в эти дни и часы
  date_from    date,
  date_to      date,
  hour_from    smallint,                          -- 0..23, пусто — весь день
  hour_to      smallint,
  weekdays     smallint[]                         -- 0=вс .. 6=сб, пусто — все дни
);

create index if not exists screen_slides_sort_idx on public.screen_slides (sort, id);

alter table public.screens enable row level security;
alter table public.screen_slides enable row level security;

-- ===== Читать может кто угодно: это витрина для гостей =====
drop policy if exists screens_select on public.screens;
create policy screens_select on public.screens for select to anon, authenticated using (true);

drop policy if exists screen_slides_select on public.screen_slides;
create policy screen_slides_select on public.screen_slides for select to anon, authenticated using (true);

-- ===== Писать — только управляющий =====
do $$
declare t text; c text;
begin
  foreach t in array array['screens','screen_slides'] loop
    foreach c in array array['insert','update','delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_' || c, t);
      if c = 'insert' then
        execute format($p$create policy %I on public.%I for insert to authenticated
          with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))$p$, t || '_' || c, t);
      elsif c = 'update' then
        execute format($p$create policy %I on public.%I for update to authenticated
          using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
          with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))$p$, t || '_' || c, t);
      else
        execute format($p$create policy %I on public.%I for delete to authenticated
          using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))$p$, t || '_' || c, t);
      end if;
    end loop;
  end loop;
end $$;

-- ===== Пульс экрана =====
-- Отдельной функцией, а не политикой на update: иначе из зала можно было бы
-- переписать ссылку на ролик и настройки врезок.
create or replace function public.screen_ping(p_code text, p_slide text default null)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.screens
     set last_seen_at = now(),
         last_slide = coalesce(p_slide, last_slide)
   where code = upper(p_code);
$$;

revoke all on function public.screen_ping(text, text) from public;
grant execute on function public.screen_ping(text, text) to anon, authenticated;
