-- Справочник → «Контакты»: разделы (section). Первый раздел — «Ремонт».
--
-- Владелец 25.11.2026: лист «Ремонт» из «Контакты фирм.xlsx» — в Контакты,
-- отдельным разделом. title — фирма, field1 — телефон, field2 — что чинит,
-- note — контактное лицо и должность.

alter table public.directory_entries add column if not exists section text;

delete from public.directory_entries where category = 'contact' and section = 'Ремонт';

insert into public.directory_entries (category, section, title, field1, field2, note) values
  ('contact', 'Ремонт', 'Ptt_servise (Prom torg tehnika)', '+998 90 189-99-66', 'Сервисный центр', 'Сервис центр, техник'),
  ('contact', 'Ремонт', 'Cryogenium_uz', '+998 90 130-28-87', 'Газовые баллоны для пива', 'Дмитрий, техник'),
  ('contact', 'Ремонт', 'Carlsberg', '+998 90 696-00-81', 'Техник Carlsberg', 'Фазил, техник'),
  ('contact', 'Ремонт', 'Жек', '+998 94 651-60-57', 'Насосы, трубы, раковины', 'Имиль, сантехник'),
  ('contact', 'Ремонт', 'Ustabola_Service', '+998 33 930-77-04', 'Насосы, трубы, раковины', 'Мамурджон, сантехник'),
  ('contact', 'Ремонт', 'Filter_servis_vvin', '+998 90 121-12-10', 'Ремонт осмоса', 'Гоша, админ'),
  ('contact', 'Ремонт', 'Самозанятый', '+998 90 318-97-69', 'Электрика, холодильники', 'Александр, техник'),
  ('contact', 'Ремонт', 'Hisense_PSM_Manager', '+998 90 092-88-80', 'Вытяжка, приточка', 'Техник (имя не указано)');
