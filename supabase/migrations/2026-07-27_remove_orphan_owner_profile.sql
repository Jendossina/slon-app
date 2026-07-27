-- У владельца было два профиля. Второй («Самойлов Евгений Евгеньевич», id 22)
-- оказался «висячим»: записи в системе входа под него нет вообще, зайти им нельзя.
-- При этом на него были назначены 5 незакрытых задач — то есть задачи висели на
-- аккаунте, который никто не откроет.
--
-- Переносим задачи на рабочий аккаунт (vorobeyxxx@inbox.ru) и удаляем висячий профиль.
-- Карточку сотрудника не трогаем: на ней нет ни смен, ни явки, ни начислений.

do $$
declare v_dead uuid; v_live uuid;
begin
  select user_id into v_dead from profiles where id = 22;
  select p.user_id into v_live
    from profiles p join auth.users u on u.id = p.user_id
   where u.email = 'vorobeyxxx@inbox.ru';

  if v_dead is null or v_live is null then
    raise notice 'Профили не найдены — ничего не делаем';
    return;
  end if;

  -- Проверяем, что удаляем действительно висячий профиль (без входа)
  if exists (select 1 from auth.users where id = v_dead) then
    raise exception 'У профиля 22 есть логин — удаление отменено';
  end if;

  update tasks set assigned_to_id = v_live where assigned_to_id = v_dead;
  update tasks set created_by = v_live where created_by = v_dead;

  delete from profiles where id = 22;
end $$;
