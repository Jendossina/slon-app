// Supabase Edge Function: read-receipt
// Распознаёт печатный Z-отчёт кассы (Claude Vision) и возвращает суммы для «Кассы дня».
// Секрет ANTHROPIC_API_KEY — тот же, что у ask-slon/analyze-review.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Схема ответа: модель обязана вернуть ровно такую структуру, разбирать текст не нужно.
const LINE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: { label: { type: "string" }, amount: { type: "integer" } },
    required: ["label", "amount"],
    additionalProperties: false
  }
};
const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    total: { type: ["integer", "null"] },
    lines: LINE_SCHEMA,
    deposits: { type: ["integer", "null"] },
    withdrawals: { type: ["integer", "null"] },
    cash_expected: { type: ["integer", "null"] },
    writeoffs: LINE_SCHEMA,
    discounts: LINE_SCHEMA,
    expenses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          who: { type: "string" },
          amount: { type: "integer" },
          category: { type: "string", enum: ["Зарплаты", "Товары", "Аренда", "Коммунальные", "Прочее"] }
        },
        required: ["label", "who", "amount", "category"],
        additionalProperties: false
      }
    },
    shift: { type: ["string", "null"] },
    shift_date: { type: ["string", "null"] },
    datetime: { type: ["string", "null"] }
  },
  required: ["total", "lines", "deposits", "withdrawals", "cash_expected", "writeoffs", "discounts", "expenses", "shift", "shift_date", "datetime"],
  additionalProperties: false
};

const PROMPT = `Ты распознаёшь печатные кассовые отчёты iiko ресторана/бара на русском. На фото может быть
один или два чека рядом: «Итого по смене» (Z-отчёт) и «Отчёт по внесениям и изъятиям».
Суммы — целые числа в сумах (может быть отрицательным — верни как есть).
Поля ответа:
"total" — строка «ИТОГО (Продажи)»;
"lines" — типы оплат: название и сумма;
"deposits" — «внесений наличных»;
"withdrawals" — «изъятий наличных»;
"cash_expected" — «в кассе должно быть»;
"writeoffs" — списания: название и сумма;
"discounts" — раздел «Оплачено как скидка»: конкретные строки (напр. «SLON CASHBACK») и суммы, без строки-итога;
"expenses" — из чека «Отчёт по внесениям и изъятиям», раздел «ИЗЪЯТИЯ НАЛИЧНЫХ»: КАЖДАЯ операция отдельно.
  label — тип операции (напр. «Зарплата персоналу», «Стажёрские», «Бонусы за кальяны», «Закупка»);
  who — «Контрагент», а если его нет — «Ком-ий» (комментарий), иначе пустая строка;
  amount — сумма без знака;
  category — «Зарплаты» для зарплат, авансов, стажёрских, бонусов и премий персоналу; «Товары» для закупок
  продуктов, табака, расходников; «Аренда»; «Коммунальные» (свет, газ, вода, интернет); иначе «Прочее».
  Внесения (ВНЕСЕНИЯ НАЛИЧНЫХ) в expenses НЕ включай. Нет такого чека — [];
"shift" — номер кассовой смены;
"shift_date" — дата из строки «Смена открыта» в формате YYYY-MM-DD (дд.мм.гггг → гггг-мм-дд), иначе null;
"datetime" — текущее время на чеке.
В "lines" перечисли КОНКРЕТНЫЕ типы оплат из раздела «Прочие типы оплат» — берущие строки вида
«ИТОГО (Наличные)», «ИТОГО (Терминал)», «ИТОГО (Rahmat)», «ИТОГО (SLON CASHBACK)», «ИТОГО (Долговой)», «ИТОГО (Карта ...)» и т.п.
НЕ включай групповые итоги («ИТОГО (Банковские карты)», «ИТОГО (Оплата наличными)», «ИТОГО (Безналичный расчет)») и не включай отдельные чеки.
В "writeoffs" — только строки раздела «Списания» (напр. «За счет заведения», «Удаления блюд»), без нулевых и без строки-итога. Раздел «Без выручки» не бери — он дублирует списания.
Если раздела/поля нет — null или []. Цифры читай внимательно: суммы типов оплат должны сходиться с «ИТОГО (Продажи)»,
а сумма изъятий — с «Итого операций изъятия на сумму».`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Не настроен ключ ANTHROPIC_API_KEY", code: "no_key" }), {
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
        // max_tokens ограничивает размышления И ответ вместе. На 2000 длинный
        // чек срывался примерно раз из шести: лимит уходил на размышления, JSON
        // обрывался на полуслове, и человек видел «не удалось распознать» —
        // переснимал чек, хотя дело было не в фотографии.
        max_tokens: 8000,
        output_config: { format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
        messages: [{ role: "user", content: [imageBlock, { type: "text", text: PROMPT }] }]
      })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      // Отделяем «не смог прочитать чек» от «сервис недоступен». Раньше любая
      // беда приходила в приложение одинаково, и кончившиеся деньги на счёте
      // Anthropic выглядели как плохое распознавание: люди переснимали чек по
      // десять раз, а причина была в другом месте.
      const low = errText.toLowerCase();
      const code = low.includes("credit balance") || low.includes("billing") ? "no_credit"
                 : resp.status === 401 || resp.status === 403 ? "bad_key"
                 : resp.status === 429 ? "rate_limit"
                 : "api";
      return new Response(JSON.stringify({ error: "Ошибка Claude API: " + errText, code }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const data = await resp.json();
    console.log("read-receipt usage", JSON.stringify({ stop: data.stop_reason, ...data.usage }));

    // Классификаторы могут отклонить запрос — это обычный ответ, а не сбой
    if (data.stop_reason === "refusal") {
      return new Response(JSON.stringify({ error: "Запрос отклонён моделью", code: "refusal" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let raw = "";
    if (Array.isArray(data.content)) raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    // Схема гарантирует форму; разбор может упасть только на обрыве по max_tokens
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_e) {}
    if (!parsed) {
      // Обрыв по лимиту и нечитаемый чек — разные беды: в первом случае
      // переснимать бесполезно, во втором как раз нужно.
      const cut = data.stop_reason === "max_tokens";
      return new Response(JSON.stringify({
        error: cut ? "Ответ оборвался по лимиту" : "Не удалось разобрать ответ",
        code: cut ? "truncated" : "unparsed",
        raw, stop_reason: data.stop_reason, usage: data.usage,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Касса печатает изъятия то с минусом, то без — и в базе они лежали вперемешку.
    // Внесения и изъятия храним без знака: направление уже сказано названием поля.
    for (const k of ["deposits", "withdrawals"]) {
      if (typeof parsed[k] === "number") parsed[k] = Math.abs(parsed[k]);
    }
    if (Array.isArray(parsed.expenses)) {
      parsed.expenses = parsed.expenses.filter((x) => x && x.amount).map((x) => ({ ...x, amount: Math.abs(x.amount) }));
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
