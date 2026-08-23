-- Привязка Telegram в одно нажатие.
--
-- Как было: найди @userinfobot, напиши ему /start, перепиши оттуда числовой ID,
-- вернись в приложение, вставь в поле. Четыре шага и посторонний бот. Итог —
-- на Истикболе шесть человек из смены так и не привязали чат, и бот для них
-- не существовал: ни напоминаний о чек-листах, ни задач, ни штрафов.
--
-- Как стало: приложение выдаёт разовый код и открывает t.me/SlonShishaBot?start=<код>.
-- Человек жмёт «Старт», бот сам находит по коду, чей это аккаунт, и записывает
-- chat_id. Ничего никуда не переписывается.
--
-- Код одноразовый и живёт 15 минут: это ключ от чужих уведомлений, и утёкший
-- код не должен работать вечно.

create table if not exists public.tg_link_codes (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

create index if not exists tg_link_codes_user on public.tg_link_codes(user_id);

-- Политик нет намеренно: таблицу читают и пишут только функции ниже
-- (security definer) и вебхук сервисным ключом. Клиенту в ней делать нечего —
-- чужой код = чужие уведомления.
alter table public.tg_link_codes enable row level security;

-- Выдать себе новый код. Прежние неиспользованные гасим: действующим должен быть
-- ровно один, иначе старая вкладка привяжет чат к неожиданному коду.
create or replace function public.tg_link_code_new()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_code text;
begin
  if auth.uid() is null then
    raise exception 'нужна авторизация';
  end if;
  delete from tg_link_codes where user_id = auth.uid();
  delete from tg_link_codes where created_at < now() - interval '1 day';
  v_code := lower(encode(gen_random_bytes(5), 'hex'));
  insert into tg_link_codes(code, user_id) values (v_code, auth.uid());
  return v_code;
end $$;

-- Применить код: вызывает вебхук после «Старта» в боте.
-- Возвращает имя привязанного человека или null, если код не подошёл.
create or replace function public.tg_link_apply(p_code text, p_chat_id text)
returns text language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_name text;
begin
  select user_id into v_user
    from tg_link_codes
   where code = lower(trim(p_code))
     and used_at is null
     and created_at > now() - interval '15 minutes';
  if v_user is null then return null; end if;

  update tg_link_codes set used_at = now() where code = lower(trim(p_code));

  -- Один чат — один сотрудник. Иначе уведомления двоих сойдутся в одном чате,
  -- и человек будет читать чужие смены как свои.
  update profiles set telegram_id = null
   where telegram_id = p_chat_id and user_id <> v_user;

  update profiles set telegram_id = p_chat_id where user_id = v_user
  returning name into v_name;

  return coalesce(v_name, 'сотрудник');
end $$;

revoke all on function public.tg_link_apply(text, text) from public, anon, authenticated;
grant execute on function public.tg_link_code_new() to authenticated;
