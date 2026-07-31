-- ОБНУЛЕНИЕ ПЕРЕД ОФИЦИАЛЬНЫМ ЗАПУСКОМ (1 августа 2026).
--
-- Двухнедельный пилот в Чехове закончился: приложение стартует с чистого листа,
-- но с готовыми сотрудниками, доступами и наполнением.
--
-- ОСТАЮТСЯ (11 таблиц):
--   employees, profiles            — сотрудники и их доступы (иначе никто не войдёт)
--   filials, filial_geo            — филиалы и геозоны для отметок прихода
--   checklist_templates            — шаблоны чек-листов
--   kb_books, kb_articles          — База знаний (на ней отвечает Помощник)
--   quiz_questions                 — банк вопросов аттестации
--   supply_items, dishware_items   — номенклатура закупок и посуды
--   directory_entries              — справочник контактов
--
-- УДАЛЯЮТСЯ (25 таблиц) — всё, что наработано за пилот: касса, задачи, чат,
-- график, отметки прихода, чек-листы, аттестации, баллы, закупки, отзывы, заметки.
--
-- Бэкап данных снят перед удалением: backups/2026-07-31T12-53-59 (36 таблиц, 725 строк).
-- Фото из хранилища (bucket task-reports) удаляются отдельно, скриптом.
--
-- TRUNCATE одной командой: Postgres сам проверит, что ни одна оставшаяся таблица
-- не ссылается на очищаемые. RESTART IDENTITY — чтобы нумерация пошла с единицы.

truncate table
  public.activity_log,
  public.attendance,
  public.checklist_logs,
  public.checklist_misses,
  public.reviews,
  public.waiter_points,
  public.waiter_week_stats,
  public.tasks,
  public.task_comments,
  public.task_deadline_notices,
  public.team_chat,
  public.supply_moves,
  public.supply_batches,
  public.quiz_attempts,
  public.my_notes,
  public.finances,
  public.dishware_moves,
  public.bookings,
  public.events,
  public.announcements,
  public.polls,
  public.poll_votes,
  public.premiums,
  public.shifts,
  public.schedules
restart identity;
