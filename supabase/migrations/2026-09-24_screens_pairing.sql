-- Привязка экрана без ввода длинной ссылки.
--
-- Как было: на боксе надо было вручную набрать пультом адрес вида
-- /tv.html?code=A1B2C3. Пять минут тыканья в экранную клавиатуру — и это при
-- каждой перенастройке. Теперь наоборот: на боксе набирают короткий адрес
-- (один раз в жизни), страница сама придумывает себе код, показывает его
-- крупно и заявляет о себе в базу. В приложении новый экран появляется сам,
-- его остаётся назвать и настроить.
--
-- pending = экран заявился, но им ещё не занялись. Пока он pending, страница
-- показывает свой код и ничего больше: пустой телевизор в зале лучше, чем
-- телевизор с чужими акциями.

alter table public.screens add column if not exists pending boolean not null default false;
alter table public.screens add column if not exists user_agent text;

comment on column public.screens.pending is
  'Экран заявился сам и ждёт, пока его настроят в приложении';

-- Заявка о себе. Отдельной функцией, потому что писать в screens со стороны
-- зала нельзя: иначе с бокса можно было бы переписать чужие настройки.
create or replace function public.screen_announce(p_code text, p_agent text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_code text := upper(trim(p_code));
begin
  -- Код придумывает сама страница, поэтому проверяем его форму: шесть знаков,
  -- буквы и цифры. Иначе в таблицу приедет что угодно.
  if v_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'плохой код экрана';
  end if;

  if exists (select 1 from public.screens where code = v_code) then
    update public.screens
       set last_seen_at = now(),
           user_agent = coalesce(p_agent, user_agent)
     where code = v_code;
  else
    insert into public.screens (code, name, pending, user_agent, last_seen_at)
    values (v_code, 'Новый экран ' || v_code, true, p_agent, now());
  end if;
end $$;

revoke all on function public.screen_announce(text, text) from public;
grant execute on function public.screen_announce(text, text) to anon, authenticated;
