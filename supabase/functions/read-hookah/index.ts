// Supabase Edge Function: read-hookah
// Распознаёт отчёт кальянной станции по фото (Claude Vision) и возвращает
// количество, сумму и разбивку «чего сколько продано».
//
// Секрет ANTHROPIC_API_KEY — тот же, что у ask-slon/analyze-review/read-receipt.
//
// Исходник лежит в репозитории намеренно: у остальных функций его нет, и
// посмотреть, что именно крутится на сервере, было неоткуда.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `Ты распознаёшь отчёт кальянной станции бара за смену по фотографии.
На фото может быть отчёт из iiko, экран кассы, распечатка или рукописный лист.

Верни СТРОГО один JSON-объект без пояснений и без markdown:
{
 "count": число|null,     // сколько кальянов продано за смену, всего
 "amount": число|null,    // на какую сумму продано, целое в сумах, без пробелов
 "items": [ {"name": "название позиции", "qty": число|null, "sum": число|null} ]
}

Правила:
• "count" — количество ПРОДАННЫХ КАЛЬЯНОВ. Если в отчёте есть строка
  «итого/всего кальянов», бери её. Иначе сложи количества только по позициям,
  которые являются кальяном или его тарифом («Кальян B», «Кальян C Expert»,
  «STUFF кальян»). НЕ считай расходники и доп-услуги: табак, фольгу, уголь,
  замену чаши, аренду мундштука — они попадают в items, но не в count.
• "amount" — итоговая выручка станции. Суммы целые, без десятичных и пробелов.
• "items" — конкретные позиции: сорт табака, вид кальяна, тариф. Групповые
  итоги («ИТОГО», «Всего», «Кальяны») в items НЕ включай.
• Чего не видно или не разобрать — null или пустой массив, не выдумывай.
• Если на фото вообще не отчёт по кальянам, верни все поля null и пустой items.

Выведи ТОЛЬКО JSON-объект.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "Не настроен ключ ANTHROPIC_API_KEY" }, 500);

    const { imageUrl, imageBase64, mimeType } = await req.json();
    let imageBlock;
    if (imageUrl) {
      imageBlock = { type: "image", source: { type: "url", url: String(imageUrl) } };
    } else if (imageBase64) {
      imageBlock = {
        type: "image",
        source: { type: "base64", media_type: mimeType || "image/jpeg", data: String(imageBase64) },
      };
    } else {
      return json({ error: "Нет изображения (imageUrl или imageBase64)" }, 400);
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-5",
        // max_tokens ограничивает размышления И ответ вместе, а на этой модели
        // размышления включены по умолчанию. Запас взят с учётом этого: с
        // тесным лимитом ответ обрывается на полуслове.
        max_tokens: 8000,
        messages: [{ role: "user", content: [imageBlock, { type: "text", text: PROMPT }] }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      // Ошибку отдаём со статусом 200: приложению важно показать человеку
      // причину, а не свалиться на сетевом уровне
      return json({ error: "Ошибка Claude API: " + errText });
    }

    const data = await resp.json();

    // Классификаторы могут отклонить запрос — это обычный ответ, а не сбой
    if (data.stop_reason === "refusal") {
      return json({ error: "Запрос отклонён моделью" });
    }

    let raw = "";
    if (Array.isArray(data.content)) {
      raw = data.content.filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text).join("");
    }
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = raw.match(/\{[\s\S]*\}/);
    let parsed = null;
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_e) { /* ниже вернём raw */ } }

    if (!parsed) {
      // Диагностика: пустой raw обычно значит, что весь лимит съели размышления
      // и текст не успел начаться (stop_reason = max_tokens)
      return json({
        error: "Не удалось разобрать ответ",
        raw,
        stop_reason: data.stop_reason,
        blocks: Array.isArray(data.content) ? data.content.map((b: { type: string }) => b.type) : null,
        usage: data.usage,
      });
    }
    return json({ ok: true, data: parsed });
  } catch (e) {
    return json({ error: String(e?.message || e) });
  }
});
