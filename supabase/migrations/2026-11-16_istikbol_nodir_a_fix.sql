-- Истикбол, 16–22.11.2026: смены столбца «Нодир А» по ошибке внесли на
-- Махмудова Нодира (id 73). Переносим на Нодира бек Хусан огли (id 170) —
-- по подтверждению владельца 16.11. У id 170 своих строк Истикбола на эту неделю не было.
update schedules
   set employee_id = 170,
       employee_name = (select name from employees where id = 170)
 where employee_id = 73 and filial = 'istikbol'
   and date between '2026-11-16' and '2026-11-22';
