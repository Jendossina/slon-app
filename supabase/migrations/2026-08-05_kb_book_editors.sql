-- Кто ведёт статьи внутри книги Базы знаний.
--
-- До этого править Базу знаний мог только админ. Регламент по оборудованию
-- ведут управляющие филиалов, но раздавать им правку Food Book и Bar Book
-- нельзя: на этих статьях отвечает Помощник, и случайная правка расходится
-- по всем ответам. Поэтому право задаётся не ролью вообще, а признаком у
-- конкретной книги.
--
--   edit_role = 'admin'   — статьи правит только админ (так у всех старых книг)
--   edit_role = 'manager' — статьи правит админ и управляющий
--
-- Сами книги (создать, переименовать, удалить) остаются за админом.

alter table kb_books add column if not exists edit_role text not null default 'admin';

alter table kb_books drop constraint if exists kb_books_edit_role_chk;
alter table kb_books add constraint kb_books_edit_role_chk check (edit_role in ('admin', 'manager'));

-- Статьи: админ везде, управляющий — только в книгах с edit_role='manager'
drop policy if exists kb_articles_write on kb_articles;
create policy kb_articles_write on kb_articles for all
using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'admin')
  or exists (
    select 1 from profiles p
    join kb_books b on b.id = kb_articles.book_id
    where p.user_id = auth.uid() and p.role = 'manager' and b.edit_role = 'manager'
  )
)
with check (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'admin')
  or exists (
    select 1 from profiles p
    join kb_books b on b.id = kb_articles.book_id
    where p.user_id = auth.uid() and p.role = 'manager' and b.edit_role = 'manager'
  )
);
