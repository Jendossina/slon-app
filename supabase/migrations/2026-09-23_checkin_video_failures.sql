-- Журнал отказов при отправке видео прихода.
--
-- Зачем. 22.09 у Дооса отметка осталась без видео, и разобраться, что именно
-- случилось, не вышло: логи Supabase на бесплатном тарифе живут сутки, а свои
-- ошибки приложение никуда не писало — человек видел «слабая связь, дошлите
-- позже», и на этом след обрывался. Такие пропуски не редкость: за две недели
-- семь отметок из 245 остались без ролика, и ни по одной нет причины.
--
-- Что пишем: к какой отметке, кто, на каком шаге (отправка файла или запись
-- ссылки), что ответил сервер, сколько было попыток, сколько весил ролик и с
-- какого телефона. Плюс kept — остался ли ролик на телефоне для досылки, и
-- recovered_at — когда он всё-таки долетел. Без recovered_at по журналу не
-- отличить «потеряли навсегда» от «ушло со второй попытки», а вся польза
-- именно в этой разнице: по ней и будет видно, работает ли досылка.
--
-- Растёт журнал медленно (единицы строк в неделю), чистить не требуется.

create table if not exists public.checkin_video_failures (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  attendance_id bigint references public.attendance(id) on delete cascade,
  employee_id   bigint,
  employee_name text,
  stage         text not null,              -- upload | link
  reason        text,                       -- что ответил сервер или браузер
  attempt       integer,                    -- сколько попыток сделали
  bytes         bigint,                     -- размер ролика
  kept          boolean not null default false,  -- ролик остался на телефоне
  user_agent    text,
  recovered_at  timestamptz                 -- когда ролик всё-таки долетел
);

create index if not exists checkin_video_failures_created_idx
  on public.checkin_video_failures (created_at desc);

alter table public.checkin_video_failures enable row level security;

-- Пишет о себе сам сотрудник: отказ случается на его телефоне, больше его
-- никто и не увидит. Чужую строку завести нельзя.
drop policy if exists checkin_video_failures_insert on public.checkin_video_failures;
create policy checkin_video_failures_insert on public.checkin_video_failures for insert to authenticated
  with check (exists (select 1 from public.profiles p
                       where p.user_id = auth.uid()
                         and p.employee_id = checkin_video_failures.employee_id));

-- Он же закрывает свою запись, когда ролик дошёл.
drop policy if exists checkin_video_failures_update on public.checkin_video_failures;
create policy checkin_video_failures_update on public.checkin_video_failures for update to authenticated
  using (exists (select 1 from public.profiles p
                  where p.user_id = auth.uid()
                    and p.employee_id = checkin_video_failures.employee_id))
  with check (exists (select 1 from public.profiles p
                       where p.user_id = auth.uid()
                         and p.employee_id = checkin_video_failures.employee_id));

-- Читает руководство: журнал нужен, чтобы видеть картину по всем телефонам.
drop policy if exists checkin_video_failures_select on public.checkin_video_failures;
create policy checkin_video_failures_select on public.checkin_video_failures for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.user_id = auth.uid()
                    and p.role = any(array['admin','manager','boss'])));
