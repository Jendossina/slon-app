-- Наблюдатель цеха: один человек получает всё по своему отделу.
--
-- Просьба владельца 06.09.2026: Махмудов Нодир (старший кальянный мастер) должен
-- получать все приходы и опоздания кальянщиков, сдачу и несдачу их чек-листов, а
-- в 16:00 — видео прихода только кальянных мастеров.
--
-- Готовые лестницы для этого не годятся:
--   notify_dept_seniors шлёт только про тех, кто НИЖЕ по должности, — приход
--     второго старшего или шефа станции мимо него проходил;
--   невыполнение чек-листа уходило смене и управляющим, старшего цеха там не было;
--   дайджест видео — только управляющим и по всему заведению разом.
--
-- Поэтому заводим отдельный список: кто за каким цехом смотрит. Привязка к
-- человеку, а не к должности — это именно поручение конкретному человеку, а не
-- право должности (в отличие от REQUEST_APPROVERS). Добавить второго — одна
-- строка в dept_watchers, код трогать не нужно.

create table if not exists public.dept_watchers (
  employee_id bigint  not null references public.employees(id) on delete cascade,
  department  text    not null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (employee_id, department)
);

comment on table public.dept_watchers is
  'Кто получает все уведомления по цеху: приходы, опоздания, чек-листы, видео-дайджест в 16:00.';

alter table public.dept_watchers enable row level security;
-- Политик намеренно нет: таблицу читают только SECURITY DEFINER-функции
-- уведомлений, из приложения она не нужна.

insert into public.dept_watchers (employee_id, department, note)
select e.id, 'Кальянные мастера', 'Махмудов Нодир — просьба владельца 06.09.2026'
  from public.employees e
 where e.name = 'Махмудов Нодир Сабирович'
on conflict (employee_id, department) do nothing;

-- Старшие цеха плюс наблюдатели. Наблюдателю уровень должности не важен: он
-- смотрит за цехом целиком, включая равных себе и старших по должности, — и
-- сам может быть заведён в другом отделе, поэтому отдельной веткой, а не
-- условием внутри первой.
create or replace function public.notify_dept_seniors(p_dept text, p_above integer default 0, p_filial text default null)
returns table(user_id uuid, telegram_id text, notify_prefs jsonb)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.user_id, p.telegram_id, p.notify_prefs
    from employees e
    join profiles p on p.employee_id = e.id
   where p.telegram_id is not null
     and coalesce(e.status, 'Активен') <> 'Уволен'
     and e.department = p_dept
     and public.job_level(e.role) > coalesce(p_above, 0)
     and (
       p_filial is null
       or coalesce(array_length(e.filials, 1), 0) = 0
       or p_filial = any(e.filials)
     )
  union
  select p.user_id, p.telegram_id, p.notify_prefs
    from dept_watchers w
    join employees e on e.id = w.employee_id
    join profiles  p on p.employee_id = e.id
   where w.department = p_dept
     and p.telegram_id is not null
     and coalesce(e.status, 'Активен') <> 'Уволен'
     and (
       p_filial is null
       or coalesce(array_length(e.filials, 1), 0) = 0
       or p_filial = any(e.filials)
     );
$function$;

-- Невыполнение чек-листа: получатели плюс наблюдатели цеха.
CREATE OR REPLACE FUNCTION public.checklist_check_overdue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_fine constant integer := 50000;
  v_fine_from constant date := date '2026-08-13';
  v_now timestamp; v_bday date; v_found integer := 0;
  t record; f text; v_due timestamp; v_deadline timestamp; v_own record; o record;
  v_att_id bigint; v_miss_id bigint;
  v_points integer; v_notified integer; v_fined integer;
  v_paid text; v_capped text; v_nomark text;
  v_text text; r record;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_now  := now() at time zone 'Asia/Tashkent';
  v_bday := business_today();

  for t in
    select id, name, type, department, due_time, owner_shift_start
      from checklist_templates
     where is_active and due_time is not null
  loop
    -- Чек-листы закрытия не проверяем вовсе: ни невыполнения, ни штрафа, ни
    -- уведомления. Смена видит их в приложении, спрашивает менеджер.
    continue when checklist_is_closing(v_bday, t.due_time, t.owner_shift_start);

    foreach f in array array['istikbol','chekhov'] loop
      begin  -- сбой на одном чек-листе не должен ронять проверку остальных
        continue when checklist_duplicate_shift(t.id, v_bday, t.due_time, t.owner_shift_start, t.department, f);

        v_due := checklist_due_effective(v_bday, t.due_time, t.owner_shift_start, t.department, f);
        v_deadline := v_due + interval '1 hour';
        continue when v_now < v_deadline;
        -- Окно 3 часа: срок прошёл давно — молчим. Иначе включение проверки
        -- задним числом выкатит пачку наказаний за старые дедлайны.
        continue when v_now > v_deadline + interval '3 hours';

        continue when exists (
          select 1 from checklist_logs l
           where l.template_id = t.id and l.filial = f and l.date = v_bday and l.completed);

        continue when exists (
          select 1 from checklist_misses m
           where m.template_id = t.id and m.filial = f and m.date = v_bday);

        select * from checklist_owners(t.department, t.owner_shift_start, f, v_bday, v_due) into v_own;
        continue when v_own.employee_ids is null;   -- отдел сегодня не работает

        v_points := 0; v_notified := 0; v_fined := 0;
        v_paid := null; v_capped := null; v_nomark := null;

        insert into checklist_misses (template_id, template_name, department, filial, date, due_time, employee_ids, employee_names)
        values (t.id, t.name, t.department, f, v_bday, v_due::time, v_own.employee_ids, v_own.employee_names)
        returning id into v_miss_id;

        for o in select e.id, e.name from employees e where e.id = any(v_own.employee_ids) order by e.name
        loop
          -- Балл официантам: один на человека в день, как и штраф
          if t.department = 'Официанты'
             and not exists (select 1 from waiter_points wp
                              where wp.employee_id = o.id and wp.date = v_bday
                                and wp.reason = 'checklist' and wp.created_by_name = 'Автоматически') then
            insert into waiter_points (employee_id, employee_name, filial, date, category, points, reason, note, created_by_name)
            values (o.id, o.name, f, v_bday, 'discipline', 1, 'checklist',
                    t.name || ' — срок до ' || to_char(v_due, 'HH24:MI'), 'Автоматически');
            v_points := v_points + 1;
          end if;

          continue when v_bday < v_fine_from;

          -- Потолок: с человека не больше одного штрафа за кассовый день
          if exists (select 1 from checklist_penalties cp
                       join checklist_misses m2 on m2.id = cp.miss_id
                      where m2.date = v_bday and cp.employee_id = o.id) then
            v_capped := concat_ws(', ', v_capped, o.name);
            continue;
          end if;

          -- Деньги вешаем на отметку прихода: penalty вычитают все расчёты
          -- зарплаты. Нет отметки — списывать не с чего.
          select att.id into v_att_id from attendance att
           where att.date = v_bday and att.filial = f and att.employee_id = o.id;
          if v_att_id is null then
            v_nomark := concat_ws(', ', v_nomark, o.name);
            continue;
          end if;

          update attendance set penalty = coalesce(penalty, 0) + v_fine where id = v_att_id;
          insert into checklist_penalties (miss_id, employee_id, amount) values (v_miss_id, o.id, v_fine);
          v_fined := v_fined + v_fine;
          v_paid := concat_ws(', ', v_paid, o.name);
        end loop;

        -- Срок называем тот, который наказуем: час с начала смены. Раньше в
        -- сообщении стояло начало смены («срок был до 11:00»), хотя сдать можно
        -- было до 12:00 — человек читал обвинение в том, чего не нарушал.
        v_text := '⚠️ <b>Чек-лист не сдан</b>' || chr(10)
               || t.name || ' · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end) || chr(10)
               || 'Сдать надо было до ' || to_char(v_due + interval '1 hour', 'HH24:MI')
               || ' — час с начала смены (' || to_char(v_due, 'HH24:MI') || ').' || chr(10)
               || 'Ответственные: ' || coalesce(v_own.employee_names,'—') || chr(10)
               || 'Зафиксировано невыполнение.'
               || (case when v_paid is not null
                        then chr(10) || 'Штраф ' || replace(to_char(v_fine, 'FM999,999'), ',', ' ')
                             || ' сум: ' || v_paid
                        else '' end)
               || (case when v_capped is not null
                        then chr(10) || 'Без штрафа (уже был сегодня): ' || v_capped
                        else '' end)
               || (case when v_nomark is not null
                        then chr(10) || 'Без штрафа (нет отметки прихода): ' || v_nomark
                        else '' end)
               || (case when v_bday < v_fine_from
                        then chr(10) || 'Штрафы за чек-листы вступают в силу ' || to_char(v_fine_from, 'DD.MM') || '.'
                        else '' end)
               || (case when v_points > 0 then chr(10) || 'Официантам штрафной балл: ' || v_points || '.' else '' end)
               || chr(10) || 'Сдадите в ближайшие 2 часа — снимем и невыполнение, и всё начисленное.';

        for r in
          -- Смена, руководство и наблюдатели цеха (dept_watchers): старшему
          -- цеха невыполнение важно знать по всем своим людям, а не только
          -- когда он сам в смене.
          select distinct p.telegram_id
            from profiles p
           where p.telegram_id is not null
             and (p.employee_id = any(v_own.employee_ids)
                  or p.role = any(array['admin','manager'])
                  or exists (select 1 from dept_watchers w
                              where w.employee_id = p.employee_id
                                and w.department = t.department))
        loop
          perform net.http_post(
            url := v_fn,
            headers := '{"Content-Type":"application/json"}'::jsonb,
            body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_text));
          v_notified := v_notified + 1;
        end loop;

        update checklist_misses
           set points_given = v_points, notified = v_notified, penalty_given = v_fined
         where id = v_miss_id;
        v_found := v_found + 1;
      exception when others then
        raise warning 'checklist_check_overdue: шаблон % филиал % — %', t.id, f, sqlerrm;
      end;
    end loop;
  end loop;

  return v_found;
end $function$;

-- Дайджест видео: управляющим — по всему филиалу, наблюдателю цеха — только его
-- люди и только дневной выпуск (16:00). Вечерний хвост остаётся управляющим:
-- владелец просил Нодиру именно 16:00.
create or replace function public.checkin_digest(p_part text default 'day')
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_day date; v_prev date; v_sent integer := 0;
  v_from text; v_to text; v_prev_from text; v_tail text;
  f text; r record; v_media jsonb; v_head text; v_total integer; v_off integer;
  v_fn text := 'https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram';
begin
  v_day  := public.business_today();
  v_prev := v_day - 1;

  if p_part = 'evening' then
    -- Хвост дня: только сегодняшние 16:00–19:00, вчерашнего не берём
    v_from := '16:00'; v_to := '19:00'; v_prev_from := '99:99'; v_tail := ' · вечер';
  else
    -- Всё остальное: сегодня до 16:00 плюс вчерашний хвост после 19:00
    v_from := '00:00'; v_to := '16:00'; v_prev_from := '19:00'; v_tail := '';
  end if;

  foreach f in array array['chekhov','istikbol'] loop
    for r in
      -- Управляющие: видео смены — материал для разбора, шире не расходится
      select p.user_id, p.telegram_id, null::text as dept
        from profiles p
       where p.telegram_id is not null
         and p.role = 'admin'
         and coalesce(p.notify_prefs ->> 'checkin', 'true') <> 'false'
      union all
      -- Наблюдатель цеха: только свои люди, только филиалы, где он работает
      select p.user_id, p.telegram_id, w.department
        from dept_watchers w
        join employees e on e.id = w.employee_id
        join profiles  p on p.employee_id = e.id
       where p_part <> 'evening'
         and p.telegram_id is not null
         and coalesce(e.status, 'Активен') <> 'Уволен'
         and coalesce(p.notify_prefs ->> 'checkin', 'true') <> 'false'
         and (coalesce(array_length(e.filials, 1), 0) = 0 or f = any(e.filials))
    loop
      select count(*) into v_total
        from attendance a
       where a.filial = f
         and ((a.date = v_day  and a.check_in_time >= v_from and a.check_in_time < v_to)
           or (a.date = v_prev and a.check_in_time >= v_prev_from))
         and (r.dept is null
              or exists (select 1 from employees e2
                          where e2.id = a.employee_id and e2.department = r.dept));
      continue when v_total = 0;

      select '📹 <b>Приход · ' || (case f when 'chekhov' then 'Чехов' else 'Истикбол' end)
             || coalesce(' · ' || r.dept, '') || v_tail || '</b>' || chr(10)
             || 'Отметок: ' || v_total
             || coalesce((select chr(10) || '⚠️ Без видео: ' || string_agg(a2.user_name, ', ')
                            from attendance a2
                           where a2.filial = f and a2.checkin_video is null
                             and ((a2.date = v_day  and a2.check_in_time >= v_from and a2.check_in_time < v_to)
                               or (a2.date = v_prev and a2.check_in_time >= v_prev_from))
                             and (r.dept is null
                                  or exists (select 1 from employees e3
                                              where e3.id = a2.employee_id and e3.department = r.dept))), '')
        into v_head;

      insert into checkin_digest_notices (date, part, filial, recipient, marks)
        values (v_day, p_part, f, r.user_id::text, v_total)
        on conflict (date, part, filial, recipient) do nothing;
      continue when not found;

      perform net.http_post(url := v_fn, timeout_milliseconds := 60000,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_head));

      -- Альбом Telegram вмещает 10 роликов — шлём пачками по 10
      v_off := 0;
      loop
        select jsonb_agg(jsonb_build_object('type','video','media', x.checkin_video,
                 'caption', x.user_name || ' · ' || x.check_in_time
                            || case when x.date <> v_day then ' · ' || to_char(x.date,'DD.MM') else '' end
                            || case when x.is_late then ' · опоздание' else '' end))
          into v_media
          from (select a.user_name, a.check_in_time, a.checkin_video, a.is_late, a.date
                  from attendance a
                 where a.filial = f and a.checkin_video is not null
                   and ((a.date = v_day  and a.check_in_time >= v_from and a.check_in_time < v_to)
                     or (a.date = v_prev and a.check_in_time >= v_prev_from))
                   and (r.dept is null
                        or exists (select 1 from employees e4
                                    where e4.id = a.employee_id and e4.department = r.dept))
                 order by a.date, a.check_in_time
                 offset v_off limit 10) x;
        exit when v_media is null;

        perform net.http_post(url := v_fn, timeout_milliseconds := 120000,
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object('chat_id', r.telegram_id, 'media', v_media));
        v_off := v_off + 10;
        exit when v_off > 60;   -- предохранитель от бесконечного цикла
      end loop;

      v_sent := v_sent + 1;
    end loop;
  end loop;

  return v_sent;
end $function$;
