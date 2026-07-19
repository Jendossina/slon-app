// Supabase Edge Function: read-receipt
// Распознаёт печатный Z-отчёт кассы (Claude Vision) и возвращает суммы для «Кассы дня».
// Секрет ANTHROPIC_API_KEY — тот же, что у ask-slon/analyze-review.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const PROMPT = `Ты распознаёшь печатный Z-отчёт кассы («Итого по смене») ресторана/бара на русском.
Суммы — целые числа в сумах, без пробелов (может быть отрицательным — верни как есть).
Верни СТРОГО один JSON-объект без пояснений и без markdown:
{
 "total": число|null,          // строка «ИТОГО (Продажи)»
 "lines": [ {"label": "название типа оплаты", "amount": число} ],
 "deposits": число|null,       // «внесений наличных»
 "withdrawals": число|null,    // «изъятий наличных»
 "cash_expected": число|null,  // «в кассе должно быть»
 "writeoffs": [ {"label":"название", "amount":число} ],
 "shift": строка|null,         // номер кассовой смены
 "datetime": строка|null       // текущее время на чеке
}
В "lines" перечисли КОНКРЕТНЫЕ типы оплат из раздела «Прочие типы оплат» — берущие строки вида
«ИТОГО (Наличные)», «ИТОГО (Терминал)», «ИТОГО (Rahmat)», «ИТОГО (SLON CASHBACK)», «ИТОГО (Долговой)», «ИТОГО (Карта ...)» и т.п.
НЕ включай групповые итоги («ИТОГО (Банковские карты)», «ИТОГО (Оплата наличными)», «ИТОГО (Безналичный расчет)») и не включай отдельные чеки.
В "writeoffs" — «Списания» и «Без выручки» (напр. «На счет заведения», «Удаления блюд», «Комплименты», «Кальянная часть»).
Если раздела/поля нет — null или [].
Выведи ТОЛЬКО JSON-объект, без markdown-обёртки и без пояснений.`;

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
        model: "claude-sonnet-5",
        max_tokens: 2000,
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
    // Убираем markdown-обёртку ```json ... ``` и достаём JSON-объект
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
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
