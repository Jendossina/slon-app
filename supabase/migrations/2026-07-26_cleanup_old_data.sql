-- Очистка старых оперативных данных.
-- Сначала всегда считаем (p_dry_run = true), удаляем только по явному подтверждению.
--
-- НАМЕРЕННО НЕ ТРОГАЕМ: финансы, график, явку, премии, баллы, аттестации,
-- показатели недели, склад, сотрудников, базу знаний, справочник. Всё это —
-- основание для зарплаты и отчётности, чистить его «за компанию» нельзя.

create or replace function public.cleanup_old_data(
  p_before   date,          -- удалять всё СТАРШЕ этой даты
  p_sections text[],        -- tasks | reviews | checklists | feed | chat | bookings | activity | notes
  p_dry_run  boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
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

  -- Что реально сделали — в журнал действий (его самого чистим первым делом,
  -- поэтому запись остаётся уже после чистки).
  if not p_dry_run then
    insert into activity_log (user_id, user_name, action, details)
    select auth.uid(), coalesce(p.name,'—'), 'Очистка старых данных',
           'до ' || p_before::text || ' · ' || v_res::text
      from profiles p where p.user_id = auth.uid();
  end if;

  return v_res || jsonb_build_object('dry_run', p_dry_run, 'before', p_before);
end $$;

revoke all on function public.cleanup_old_data(date, text[], boolean) from public, anon;
grant execute on function public.cleanup_old_data(date, text[], boolean) to authenticated;
