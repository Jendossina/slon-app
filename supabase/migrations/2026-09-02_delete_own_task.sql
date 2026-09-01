-- Свою задачу можно снять.
--
-- Удаление было только у admin и manager, и жило оно в админ-панели, куда
-- старший цеха не заходит. Ставить задачи он теперь может, а снять ошибочную —
-- нет: приходится звать менеджера ради опечатки.
--
-- Правило простое и само себя ограничивает: кто задачу поставил, тот и снимет.
-- Ставить умеют только руководство и старшие цехов, так что новых прав это
-- никому не раздаёт. Чужую задачу по-прежнему снимает только руководство —
-- иначе старший мог бы стереть поручение, которое менеджер дал его людям.

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from profiles p
                where p.user_id = auth.uid()
                  and p.role = any(array['admin','manager']))
  );
