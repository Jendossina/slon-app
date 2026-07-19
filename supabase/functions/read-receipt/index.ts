// Supabase Edge Function: read-receipt
// Распознаёт печатный Z-отчёт кассы (Claude Vision) и возвращает суммы для «Кассы дня».
// Секрет ANTHROPIC_API_KEY — тот же, что у ask-slon/analyze-review.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const PROMPT = `Ты распознаёшь печатный Z-отчёт кассы («Итого по смене») ресторана/бара на русском.
Извлеки суммы (целые числа в сумах, без пробелов). Раздел «Продажи»:
- cash      — «Оплата наличными» / «Наличные»
- card      — «Банковские карты» / «Терминал»
- cashback  — «Безналичный расчет» / «Cashback» (если отдельно от карт)
- total     — «ИТОГО (Продажи)»
Раздел «Движение наличных средств»:
- deposits    — «внесений наличных»
- withdrawals — «изъятий наличных»
- cash_expected — «в кассе должно быть»
Также: shift (номер кассовой смены), datetime (текущее время на чеке).
Если поля нет — null. Отвечай СТРОГО одним JSON-объектом без пояснений и без markdown:
{"cash":число|null,"card":число|null,"cashback":число|null,"total":число|null,"deposits":число|null,"withdrawals":число|null,"cash_expected":число|null,"shift":строка|null,"datetime":строка|null}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Не настроен ключ ANTHROPIC_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const { imageUrl, imageBase64, mimeType } = await req.json();
    let imageBlock;
    if (imageUrl) imageBlock = { type: "image", source: { type: "url", url: String(imageUrl) } };
    else if (imageBase64) imageBlock = { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: String(imageBase64) } };
    else {
      return new Response(JSON.stringify({ error: "Нет изображения (imageUrl или imageBase64)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        messages: [{ role: "user", content: [imageBlock, { type: "text", text: PROMPT }] }]
      })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: "Ошибка Claude API: " + errText }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const data = await resp.json();
    let raw = "";
    if (Array.isArray(data.content)) raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    // Достаём JSON из ответа (на случай лишнего текста)
    const m = raw.match(/\{[\s\S]*\}/);
    let parsed = null;
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_e) {} }
    if (!parsed) {
      return new Response(JSON.stringify({ error: "Не удалось разобрать ответ", raw }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: true, data: parsed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
