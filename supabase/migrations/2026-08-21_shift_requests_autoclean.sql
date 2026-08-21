-- Заявки старше недели удаляются сами.
--
-- Ручная очистка в админ-панели остаётся, но её минимальный период — три
-- месяца, а заявка живёт неделю: ровно столько её видно в списке
-- (js/requests.js берёт окно gte('date', неделя назад)). Всё, что старше, уже
-- невидимо и просто лежит в базе.
--
-- Порог совпадает с окном списка намеренно: удаляется ровно то, чего человек и
-- так не видит, поэтому из интерфейса ничего не пропадёт на глазах.
--
-- Считаем по дню смены, а не по дате подачи: заявку подают заранее, и старой
-- она становится, когда прошёл день, которого касалась. Заявки на БУДУЩИЕ дни
-- не трогаются никогда, каким бы давним ни было их создание.
create or replace function public.shift_requests_cleanup(p_days integer default 7)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from shift_requests where date < (public.business_today() - p_days);
  get diagnostics v_n = row_count;

  -- В журнал пишем только когда реально удалили: иначе ежедневная запись «0»
  -- вытеснит из него настоящие действия (в админ-панели видно последние 50).
  if v_n > 0 then
    insert into activity_log (user_id, user_name, action, details)
    values (null, 'Система', 'Очистка заявок',
            format('удалено %s заявок старше %s дней', v_n, p_days));
  end if;

  return v_n;
end $$;

-- 23:30 UTC = 04:30 по Ташкенту: ночные смены уже закрыты (кассовый день
-- переключается в 8 утра), утренние ещё не начались.
select cron.unschedule('shift-requests-cleanup')
 where exists (select 1 from cron.job where jobname = 'shift-requests-cleanup');

select cron.schedule('shift-requests-cleanup', '30 23 * * *',
                     'select public.shift_requests_cleanup();');
