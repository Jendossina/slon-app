-- Ложное невыполнение и штрафной балл за 26 июля.
--
-- Чек-лист «Закрытие смены» был сдан полностью (21 из 21) в 01:35 при сроке 03:00 —
-- то есть вовремя. Но проверка в 04:00 искала запись за кассовый день 26 июля, а
-- запись тогда ещё лежала под календарным 27-м: перевод чек-листов на кассовый день
-- случился позже в тот же день. Отсюда невыполнение на пустом месте и балл официанту.
--
-- Снимаем и запись, и балл. Разовая правка данных, кода не касается.

delete from public.waiter_points p
 where p.reason = 'checklist'
   and p.date = date '2026-07-26'
   and p.created_by_name = 'Автоматически'
   and exists (
     select 1 from public.checklist_logs l
       join public.checklist_templates t on t.id = l.template_id
      where l.date = p.date and l.filial = p.filial and l.completed
        and t.department = 'Официанты'
   );

delete from public.checklist_misses m
 where m.date = date '2026-07-26'
   and exists (
     select 1 from public.checklist_logs l
      where l.template_id = m.template_id and l.date = m.date and l.filial = m.filial and l.completed
   );
