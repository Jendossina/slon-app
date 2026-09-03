-- Кто решает по заявкам сотрудника (опоздание, замена смены).
--
-- Было: решал тот же, кто правит график — старший цеха по своему цеху. Под это
-- попадали все старшие: старший бармен, бар-менеджер, су-шеф, старший кальянный
-- мастер. Владелец захотел уже: по одному шефу на цех, а кальянщиков — только
-- управляющим.
--
--   Бармены           — Шеф бармен + управляющие
--   Повара            — Шеф повар  + управляющие
--   Официанты         — менеджеры  + управляющие
--   Кальянные мастера — только управляющие
--
-- Право привязано к ДОЛЖНОСТИ, а не к человеку: сменится шеф-бармен — преемник
-- получит право сам, править код не придётся.
--
-- Отдельная функция, а не правка can_edit_schedule_of: график и карточки своих
-- людей старшие ведут по-прежнему все, сузилось только решение по заявкам.
-- Смешать это в одну функцию значило бы заодно отобрать у Лиона и су-шефов
-- график, чего никто не просил.

create or replace function public.can_decide_request_of(p_employee_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    -- управляющий — по любому цеху
    exists (
      select 1 from profiles p
       where p.user_id = auth.uid() and p.role = 'admin'
    )
    -- менеджер — только официанты
    or exists (
      select 1
        from profiles p
        join employees target on target.id = p_employee_id
       where p.user_id = auth.uid() and p.role = 'manager'
         and target.department = 'Официанты'
    )
    -- шеф цеха — свой цех (кальянной станции здесь намеренно нет)
    or exists (
      select 1
        from profiles  p
        join employees me     on me.id = p.employee_id
        join employees target on target.id = p_employee_id
       where p.user_id = auth.uid()
         and coalesce(me.status, 'Активен') <> 'Уволен'
         and me.department = target.department
         and (
              (me.department = 'Бармены' and me.role = 'Шеф бармен')
           or (me.department = 'Повара'  and me.role = 'Шеф повар')
         )
    );
$$;

comment on function public.can_decide_request_of(bigint) is
  'Кто решает по заявке сотрудника: управляющий — все, менеджер — официанты, шеф бармен/повар — свой цех, кальянщики — только управляющий.';

revoke all on function public.can_decide_request_of(bigint) from public, anon;
grant execute on function public.can_decide_request_of(bigint) to authenticated;
