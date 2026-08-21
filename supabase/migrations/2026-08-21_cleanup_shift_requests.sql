-- Очистка старых данных умеет чистить заявки на замену и на опоздание.
--
-- Заявок накапливается по нескольку в неделю, и через полгода это мёртвый груз:
-- в списке они не показываются (там окно в неделю), но лежат в базе и попадают
-- в выгрузки. Отдельную кнопку заводить незачем — в админ-панели уже есть
-- «Очистка старых данных» с выбором раздела и периода, добавляем туда раздел.
--
-- Считаем по ДНЮ СМЕНЫ (shift_requests.date), а не по дате подачи: заявку
-- подают заранее, и старой она становится, когда прошёл тот день, которого
-- касалась. Нерассмотренные удаляются наравне с решёнными — заявка на смену
-- полугодовой давности мертва независимо от статуса.
--
-- Текст функции взят ИЗ БАЗЫ (pg_get_functiondef), а не собран из миграций:
-- 15.08 сборка attendance_guard из старой миграции стоила суток без видео к
-- отметкам прихода. Здесь добавлен ровно один блок, остальное не тронуто.
CREATE OR REPLACE FUNCTION public.cleanup_old_data(p_before date, p_sections text[], p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res jsonb := '{}'::jsonb;
  n integer;
  has_section boolean;
begin
  if not exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'admin') then
    return jsonb_build_object('error','forbidden');
  end if;
  if p_before is null or p_before >= current_date then
    return jsonb_build_object('error','bad_date');
  end if;

  -- ЗАДАЧИ (+ комментарии). Отдельно показываем, сколько из них незакрытых —
  -- чтобы удаление невыполненной работы не прошло незамеченным.
  has_section := 'tasks' = any(p_sections);
  if has_section then
    select count(*) into n from tasks where created_at < p_before;
    v_res := v_res || jsonb_build_object('tasks', n);
    select count(*) into n from tasks where created_at < p_before and coalesce(status,'pending') <> 'done';
    v_res := v_res || jsonb_build_object('tasks_unfinished', n);
    select count(*) into n from task_comments c
      where c.created_at < p_before or exists (select 1 from tasks t where t.id = c.task_id and t.created_at < p_before);
    v_res := v_res || jsonb_build_object('task_comments', n);
    if not p_dry_run then
      delete from task_comments c
       where c.created_at < p_before or exists (select 1 from tasks t where t.id = c.task_id and t.created_at < p_before);
      delete from tasks where created_at < p_before;
    end if;
  end if;

  if 'reviews' = any(p_sections) then
    select count(*) into n from reviews where created_at < p_before;
    v_res := v_res || jsonb_build_object('reviews', n);
    if not p_dry_run then delete from reviews where created_at < p_before; end if;
  end if;

  if 'checklists' = any(p_sections) then
    select count(*) into n from checklist_logs where date < p_before;
    v_res := v_res || jsonb_build_object('checklist_logs', n);
    if not p_dry_run then delete from checklist_logs where date < p_before; end if;
  end if;

  if 'feed' = any(p_sections) then
    select count(*) into n from announcements where created_at < p_before;
    v_res := v_res || jsonb_build_object('announcements', n);
    select count(*) into n from polls where created_at < p_before;
    v_res := v_res || jsonb_build_object('polls', n);
    if not p_dry_run then
      delete from poll_votes v where exists (select 1 from polls p where p.id = v.poll_id and p.created_at < p_before);
      delete from polls where created_at < p_before;
      delete from announcements where created_at < p_before;
    end if;
  end if;

  if 'chat' = any(p_sections) then
    select count(*) into n from team_chat where created_at < p_before;
    v_res := v_res || jsonb_build_object('team_chat', n);
    if not p_dry_run then delete from team_chat where created_at < p_before; end if;
  end if;

  if 'bookings' = any(p_sections) then
    select count(*) into n from bookings where created_at < p_before;
    v_res := v_res || jsonb_build_object('bookings', n);
    if not p_dry_run then delete from bookings where created_at < p_before; end if;
  end if;

  if 'activity' = any(p_sections) then
    select count(*) into n from activity_log where created_at < p_before;
    v_res := v_res || jsonb_build_object('activity_log', n);
    if not p_dry_run then delete from activity_log where created_at < p_before; end if;
  end if;

  if 'notes' = any(p_sections) then
    select count(*) into n from my_notes where created_at < p_before;
    v_res := v_res || jsonb_build_object('my_notes', n);
    if not p_dry_run then delete from my_notes where created_at < p_before; end if;
  end if;

  -- ЗАЯВКИ на замену смены и на опоздание. Считаем по дню смены, а не по дате
  -- подачи: заявку подают заранее, и «старая» она тогда, когда прошёл тот день,
  -- которого она касалась. Нерассмотренные удаляем вместе с решёнными — заявка
  -- на смену полугодовой давности мертва независимо от статуса.
  if 'requests' = any(p_sections) then
    select count(*) into n from shift_requests where date < p_before;
    v_res := v_res || jsonb_build_object('shift_requests', n);
    if not p_dry_run then delete from shift_requests where date < p_before; end if;
  end if;

  -- Что реально сделали — в журнал действий (его самого чистим первым делом,
  -- поэтому запись остаётся уже после чистки).
  if not p_dry_run then
    insert into activity_log (user_id, user_name, action, details)
    select auth.uid(), coalesce(p.name,'—'), 'Очистка старых данных',
           'до ' || p_before::text || ' · ' || v_res::text
      from profiles p where p.user_id = auth.uid();
  end if;

  return v_res || jsonb_build_object('dry_run', p_dry_run, 'before', p_before);
end $function$
