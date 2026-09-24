-- Фото дописываются в базе, а не заменяются списком с телефона.
--
-- Зачем. Раньше телефон читал список снимков, приклеивал к нему свои и слал
-- целиком: update media = [весь список]. Пока один официант жал «Прикрепить»,
-- второй мог сделать то же самое — и тот, кто записал последним, затирал
-- чужие снимки. Ровно так же дублировались фото, когда человек жал кнопку
-- трижды: каждая отправка отталкивалась от списка, который видела на старте.
--
-- Теперь телефон присылает ТОЛЬКО свои новые снимки, а склейка происходит
-- здесь, одним запросом — между чтением и записью влезть некому. Заодно
-- пропускаем те, что уже есть: повтор отправки больше не плодит дубли.
--
-- security invoker (по умолчанию): права проверяются как у обычного update,
-- политики таблиц работают без изменений.

create or replace function public.checklist_media_append(p_id bigint, p_media jsonb)
returns jsonb
language sql
volatile
as $$
  update public.checklist_logs l
     set media = coalesce(l.media, '[]'::jsonb) || (
       select coalesce(jsonb_agg(x), '[]'::jsonb)
         from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) x
        where not exists (
          select 1 from jsonb_array_elements(coalesce(l.media, '[]'::jsonb)) old
           where old->>'url' = x->>'url'
        )
     )
   where l.id = p_id
  returning l.media;
$$;

comment on function public.checklist_media_append(bigint, jsonb) is
  'Дописать снимки к чек-листу, не затирая чужие и не плодя дубли';

revoke all on function public.checklist_media_append(bigint, jsonb) from public, anon;
grant execute on function public.checklist_media_append(bigint, jsonb) to authenticated;

-- То же самое для фото уборки: там такой же список и такая же гонка
create or replace function public.cleaning_media_append(p_id bigint, p_media jsonb)
returns jsonb
language sql
volatile
as $$
  update public.cleaning_items c
     set media = coalesce(c.media, '[]'::jsonb) || (
       select coalesce(jsonb_agg(x), '[]'::jsonb)
         from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) x
        where not exists (
          select 1 from jsonb_array_elements(coalesce(c.media, '[]'::jsonb)) old
           where old->>'url' = x->>'url'
        )
     )
   where c.id = p_id
  returning c.media;
$$;

comment on function public.cleaning_media_append(bigint, jsonb) is
  'Дописать снимки к пункту уборки, не затирая чужие и не плодя дубли';

revoke all on function public.cleaning_media_append(bigint, jsonb) from public, anon;
grant execute on function public.cleaning_media_append(bigint, jsonb) to authenticated;
