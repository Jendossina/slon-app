-- Журнал отказов видео прихода врал: все три записи с 06.10 по 18.10 висели
-- «потеряно навсегда», хотя у всех трёх отметок ролик на месте — досылка
-- сработала.
--
-- Отметку recovered_at ставил телефон сотрудника, UPDATE-ом по своей строке.
-- Но SELECT на журнал открыт только руководству, а Postgres под RLS обновляет
-- лишь те строки, которые видит, — UPDATE молча задевал ноль строк. Плюс одна
-- ветка досылки (ссылка уже стояла) вообще ничего не отмечала.
--
-- Теперь отмечает база: как только у отметки появилось видео — откуда угодно,
-- с телефона, досылкой или руками руководства — записи журнала закрываются.

create or replace function public.checkin_video_mark_recovered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.checkin_video is not null and old.checkin_video is null then
    update public.checkin_video_failures
       set recovered_at = now()
     where attendance_id = new.id and recovered_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.checkin_video_mark_recovered() from public, anon, authenticated;

drop trigger if exists checkin_video_mark_recovered on public.attendance;
create trigger checkin_video_mark_recovered
  after update of checkin_video on public.attendance
  for each row execute function public.checkin_video_mark_recovered();

-- Три уже досланных ролика: время доставки неизвестно, ставим момент починки.
update public.checkin_video_failures f
   set recovered_at = now()
  from public.attendance a
 where a.id = f.attendance_id
   and a.checkin_video is not null
   and f.recovered_at is null;
