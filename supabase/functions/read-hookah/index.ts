// Supabase Edge Function: read-hookah
// Распознаёт отчёт кальянной станции по фото (Claude Vision) и возвращает
// количество, сумму и разбивку «чего сколько продано».
//
// Секрет ANTHROPIC_API_KEY — тот же, что у ask-slon/analyze-review/read-receipt.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Схема ответа: модель обязана вернуть ровно такую структуру, разбирать текст не нужно.
const REPORT_SCHEMA = {
  type: "object",
  properties: {
    count: { type: ["integer", "null"] },
    amount: { type: ["integer", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: ["integer", "null"] },
          sum: { type: ["integer", "null"] },
        },
        required: ["name", "qty", "sum"],
        additionalProperties: false,
      },
    },
  },
  required: ["count", "amount", "items"],
  additionalProperties: false,
};

const PROMPT = `Ты распознаёшь отчёт кальянной станции бара за смену по фотографии.
На фото может быть отчёт из iiko, экран кассы, распечатка или рукописный лист.

Поля ответа: "count" — сколько кальянов продано за смену, всего; "amount" — на какую
сумму продано, целое в сумах; "items" — позиции: название, количество, сумма.

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
• Если на фото вообще не отчёт по кальянам, верни все поля null и пустой items.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "Не настроен ключ ANTHROPIC_API_KEY", code: "no_key" }, 500);

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
        output_config: { format: { type: "json_schema", schema: REPORT_SCHEMA } },
        messages: [{ role: "user", content: [imageBlock, { type: "text", text: PROMPT }] }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      // Отделяем «сервис недоступен» от «не смог прочитать»: кончившиеся деньги
      // на счёте Anthropic выглядели так же, как плохое фото, и люди
      // переснимали впустую. Те же коды у read-receipt.
      const low = errText.toLowerCase();
      const code = low.includes("credit balance") || low.includes("billing") ? "no_credit"
                 : resp.status === 401 || resp.status === 403 ? "bad_key"
                 : resp.status === 429 ? "rate_limit"
                 : "api";
      // Ошибку отдаём со статусом 200: приложению важно показать человеку
      // причину, а не свалиться на сетевом уровне
      return json({ error: "Ошибка Claude API: " + errText, code });
    }

    const data = await resp.json();
    console.log("read-hookah usage", JSON.stringify({ stop: data.stop_reason, ...data.usage }));

    // Классификаторы могут отклонить запрос — это обычный ответ, а не сбой
    if (data.stop_reason === "refusal") {
      return json({ error: "Запрос отклонён моделью", code: "refusal" });
    }

    let raw = "";
    if (Array.isArray(data.content)) {
      raw = data.content.filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text).join("");
    }
    // Схема гарантирует форму; разбор может упасть только на обрыве по max_tokens
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_e) { /* ниже вернём raw */ }

    if (!parsed) {
      // Обрыв по лимиту и нечитаемое фото — разные беды: в первом случае
      // переснимать бесполезно, во втором как раз нужно. Те же коды у read-receipt.
      const cut = data.stop_reason === "max_tokens";
      return json({
        error: cut ? "Ответ оборвался по лимиту" : "Не удалось разобрать ответ",
        code: cut ? "truncated" : "unparsed",
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
