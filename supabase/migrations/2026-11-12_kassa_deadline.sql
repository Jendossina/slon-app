-- Касса дня: ответственный и срок (владелец, 12.11.2026).
--
-- С 03.11 кассу не внёс никто: карточка на главной была, а ответственного и
-- срока не было. Теперь:
--   • отвечает ЗАКРЫВАЮЩИЙ менеджер — у кого в графике отдела «Менеджеры»
--     самый поздний конец смены в этот кассовый день (смена через полночь
--     считается до утра). Если менеджеров в графике нет — все менеджеры
--     филиала (employees.filials);
--   • за 30 минут до конца его смены — напоминание «внеси кассу и расходы»;
--   • срок — 08:00 следующего утра (конец кассового дня, см. business_today).
--     Если к 08:00 кассы нет — сообщение ему и управляющему (role admin).
--   • штрафа нет, только напоминания.
--
-- kassa_notices — чтобы каждое сообщение уходило один раз. Окно в 3 часа
-- (как у чек-листов): после простоя cron не рассылает старые напоминания.

create table if not exists public.kassa_notices (
  filial  text not null,
  date    date not null,
  kind    text not null,            -- 'remind' | 'overdue'
  sent_at timestamptz not null default now(),
  primary key (filial, date, kind)
);
alter table public.kassa_notices enable row level security;   -- клиентам не нужна

-- Закрывающий менеджер(ы) кассового дня и конец его смены (местное время)
create or replace function public.kassa_closer(p_filial text, p_date date)
returns table (employee_id bigint, shift_end_at timestamp)
language sql stable security definer
set search_path to 'public'
as $$
  with m as (
    select s.employee_id,
           (p_date + s.shift_end::time)
             + case when s.shift_end::time <= s.shift_start::time then interval '1 day' else interval '0' end as end_at
      from schedules s join employees e on e.id = s.employee_id
     where s.date = p_date and s.filial = p_filial
       and not coalesce(s.is_day_off, false)
       and nullif(s.shift_start, '') is not null and nullif(s.shift_end, '') is not null
       and e.department = 'Менеджеры' and coalesce(e.status, 'Активен') <> 'Уволен'
  )
  select employee_id, end_at from m where end_at = (select max(end_at) from m);
$$;

create or replace function public.kassa_remind()
returns integer
language plpgsql security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_fn    text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
  v_now   timestamp := (now() at time zone 'Asia/Tashkent');
  v_today date := business_today();
  v_sent  int := 0;
  f text; v_name text; v_day date; v_end timestamp; v_ids bigint[]; v_text text; v_open boolean;
  r record;
begin
  foreach f in array array['istikbol','chekhov'] loop
    v_name := case f when 'chekhov' then 'Чехов' else 'Истикбол' end;

    -- ===== 1. Напоминание закрывающему: за 30 минут до конца смены =====
    v_day := v_today;
    select exists (select 1 from schedules s where s.date = v_day and s.filial = f
                    and not coalesce(s.is_day_off, false)) into v_open;
    if v_open and not exists (select 1 from finances x where x.filial = f and x.date = v_day
                                 and x.type = 'income' and x.category = 'Выручка')
       and not exists (select 1 from kassa_notices k where k.filial = f and k.date = v_day and k.kind = 'remind') then
      select array_agg(c.employee_id), max(c.shift_end_at) into v_ids, v_end from kassa_closer(f, v_day) c;
      -- без менеджера в графике — ориентируемся на 03:00 (обычное закрытие)
      v_end := coalesce(v_end, v_day + time '03:00' + interval '1 day');
      if v_now >= v_end - interval '30 minutes' and v_now < v_end + interval '3 hours' then
        v_text := '💰 <b>Касса за ' || to_char(v_day, 'DD.MM') || '</b> · ' || v_name || chr(10) || chr(10)
               || 'После закрытия смены внеси в приложение кассу: фото Z-отчёта, выручку, гостей и расходы за день.' || chr(10)
               || 'Главная → карточка «Касса». Срок — до 08:00 утра.';
        for r in
          select distinct p.telegram_id from profiles p join employees e on e.id = p.employee_id
           where p.telegram_id is not null and coalesce((p.notify_prefs->>'kassa')::boolean, true)
             and ((v_ids is not null and p.employee_id = any(v_ids))
               or (v_ids is null and p.role = 'manager' and e.filials @> array[f]))
        loop
          perform net.http_post(url := v_fn, headers := '{"Content-Type":"application/json"}'::jsonb,
                                body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
          v_sent := v_sent + 1;
        end loop;
        insert into kassa_notices (filial, date, kind) values (f, v_day, 'remind') on conflict do nothing;
      end if;
    end if;

    -- ===== 2. Просрочка: к 08:00 кассы за вчерашний кассовый день нет =====
    v_day := v_today - 1;
    if v_now >= v_today + time '08:00' and v_now < v_today + time '11:00'
       and exists (select 1 from schedules s where s.date = v_day and s.filial = f and not coalesce(s.is_day_off, false))
       and not exists (select 1 from finances x where x.filial = f and x.date = v_day
                          and x.type = 'income' and x.category = 'Выручка')
       and not exists (select 1 from kassa_notices k where k.filial = f and k.date = v_day and k.kind = 'overdue') then
      select array_agg(c.employee_id) into v_ids from kassa_closer(f, v_day) c;
      v_text := '⚠️ <b>Касса за ' || to_char(v_day, 'DD.MM') || ' не внесена</b> · ' || v_name || chr(10) || chr(10)
             || 'Срок был до 08:00. Ответственный — закрывающий менеджер: '
             || coalesce((select string_agg(e.name, ', ') from employees e where e.id = any(v_ids)), 'в графике менеджеров никого нет') || '.' || chr(10)
             || 'Внести: Главная → карточка «Касса» → день в красном списке.';
      for r in
        select distinct p.telegram_id from profiles p left join employees e on e.id = p.employee_id
         where p.telegram_id is not null and coalesce((p.notify_prefs->>'kassa')::boolean, true)
           and (p.role = 'admin'
             or (v_ids is not null and p.employee_id = any(v_ids))
             or (v_ids is null and p.role = 'manager' and e.filials @> array[f]))
      loop
        perform net.http_post(url := v_fn, headers := '{"Content-Type":"application/json"}'::jsonb,
                              body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
        v_sent := v_sent + 1;
      end loop;
      insert into kassa_notices (filial, date, kind) values (f, v_day, 'overdue') on conflict do nothing;
    end if;
  end loop;
  return v_sent;
end $$;

revoke all on function public.kassa_remind() from public, anon, authenticated;
revoke all on function public.kassa_closer(text, date) from public, anon, authenticated;

select cron.unschedule('kassa-remind') where exists (select 1 from cron.job where jobname = 'kassa-remind');
select cron.schedule('kassa-remind', '*/15 * * * *', 'select public.kassa_remind();');

-- Пункт чек-листа закрытия менеджера: теперь и расходы
update public.checklist_templates
   set items = (select jsonb_agg(case when (i->>'id')::int = 2209
                  then jsonb_set(i, '{text}', to_jsonb('Сфотографировал Z-отчёт и внёс кассу в приложение: выручка, гости и расходы за день'::text))
                  else i end order by n)
                  from jsonb_array_elements(items) with ordinality as x(i, n))
 where type = 'mgr_close';
