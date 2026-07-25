// Supabase Edge Function: gen-quiz
// Генерирует вопросы аттестации по меню из Базы знаний (kb_articles).
// Вызывается управляющим с экрана «Проценты» → вкладка «Вопросы» → «Сгенерировать».
// Вопросы падают в quiz_questions со status='draft' — админ проверяет и утверждает.
//
// Требуемый секрет (Supabase → Edge Functions → gen-quiz → Settings → Secrets):
//   ANTHROPIC_API_KEY = ключ sk-ant-... (тот же, что у ask-slon)
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY подставляются платформой автоматически.
//
// Стиль (сырой fetch к api.anthropic.com, без SDK) — как в ask-slon.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Схема ответа: модель обязана вернуть ровно такую структуру, разбирать текст не нужно.
const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_index: { type: "integer", enum: [0, 1, 2, 3] },
          source: { type: "string" },
          topic: { type: "string" }
        },
        required: ["question", "options", "correct_index", "source", "topic"],
        additionalProperties: false
      }
    }
  },
  required: ["questions"],
  additionalProperties: false
};

const SYSTEM = `Ты составляешь вопросы для еженедельной аттестации официантов заведения «Slon Shisha & Bar» по знанию меню и стандартов.

Правила:
- Вопросы — строго по приложенным материалам заведения. Ничего не выдумывай: если чего-то нет в материалах, не спрашивай об этом.
- Проверяй то, что официант реально должен знать на смене: состав и подача блюд и напитков, аллергены, время приготовления, чем блюда отличаются, что к чему предложить, стандарты обслуживания.
- Ровно 4 варианта ответа. Один правильный, три правдоподобных, но однозначно неверных по материалам.
- Неправильные варианты должны быть похожи по длине и стилю на правильный — не выдавай ответ длиной или детальностью.
- Правильный ответ ставь на случайную позицию: correct_index должен быть разным у разных вопросов, а не всегда 0.
- Формулируй коротко и по-русски, как говорят в зале, без канцелярита.
- В поле source укажи название статьи Базы знаний, из которой взят вопрос.
- Не повторяй вопросы: каждый — про своё блюдо, напиток или правило.
- В поле topic укажи тему вопроса — по ней мы следим, чтобы в один тест не попали два похожих вопроса. Вопросы одного шаблона должны получить ОДНУ тему, даже если они про разные блюда: все «Сколько готовится...» → «время приготовления», все про аллергены → «аллергены». Остальным ставь темой блюдо или правило, о котором спрашиваешь («том ям», «цезарь», «расчёт гостя»). Пиши тему коротко и в нижнем регистре.`;

async function fetchBookArticles(bookId: number): Promise<{ text: string; count: number }> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return { text: "", count: 0 };
  const q = `${url}/rest/v1/kb_articles?select=title,content&book_id=eq.${bookId}&order=sort_order`;
  const r = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) return { text: "", count: 0 };
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) return { text: "", count: 0 };
  const MAX = 200000; // предохранитель по размеру контекста
  let ctx = "";
  for (const a of rows) {
    const piece = `\n### ${a.title || "Без названия"}\n${String(a.content || "")}\n`;
    if (ctx.length + piece.length > MAX) { ctx += piece.slice(0, MAX - ctx.length); break; }
    ctx += piece;
  }
  return { text: ctx.trim(), count: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "Не настроен ключ ANTHROPIC_API_KEY" }, 500);

    const supaUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supaUrl || !serviceKey) return json({ error: "Не настроен доступ к базе" }, 500);

    // Только admin/manager: проверяем роль по токену вызывающего
    const authHeader = req.headers.get("Authorization") || "";
    const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: authHeader }
    });
    if (!userRes.ok) return json({ error: "Нужен вход в приложение" }, 401);
    const user = await userRes.json();
    const profRes = await fetch(
      `${supaUrl}/rest/v1/profiles?select=role&user_id=eq.${user.id}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const profs = profRes.ok ? await profRes.json() : [];
    const role = Array.isArray(profs) && profs[0] ? profs[0].role : null;
    if (role !== "admin" && role !== "manager") {
      return json({ error: "Генерировать вопросы может администратор или управляющий" }, 403);
    }

    const body = await req.json();
    const bookId = Number(body?.book_id);
    const count = Math.min(Math.max(parseInt(body?.count) || 10, 1), 30);
    const department = String(body?.department || "Официанты");
    if (!bookId) return json({ error: "Не выбрана книга Базы знаний" }, 400);

    const kb = await fetchBookArticles(bookId);
    if (!kb.text) return json({ error: "В этой книге пока нет статей" }, 200);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Серверный запасной вариант: если запрос вдруг отклонят классификаторы,
        // Anthropic сам переиграет его на резервной модели, а не вернёт отказ.
        "anthropic-beta": "server-side-fallback-2026-07-01"
      },
      body: JSON.stringify({
        model: "claude-opus-5",
        max_tokens: 16000,
        fallbacks: "default",
        system: [
          { type: "text", text: SYSTEM },
          {
            type: "text",
            text: "=== МАТЕРИАЛЫ ЗАВЕДЕНИЯ (единственный источник для вопросов) ===\n" + kb.text,
            cache_control: { type: "ephemeral" }
          }
        ],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: QUESTION_SCHEMA }
        },
        messages: [
          { role: "user", content: `Составь ${count} вопросов для аттестации официантов по этим материалам.` }
        ]
      })
    });

    if (!resp.ok) return json({ error: "Ошибка Claude API: " + (await resp.text()) }, 200);
    const data = await resp.json();

    // На отказ классификаторов content пустой или частичный — читаем только после проверки
    if (data.stop_reason === "refusal") {
      return json({ error: "Модель отклонила запрос. Попробуйте другую книгу." }, 200);
    }
    if (data.stop_reason === "max_tokens") {
      return json({ error: "Слишком много вопросов за раз — попробуйте меньше." }, 200);
    }

    const text = Array.isArray(data.content)
      ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
      : "";
    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch { return json({ error: "Не удалось разобрать ответ модели" }, 200); }

    // Страхуемся от кривых вариантов, даже при схеме
    const rows = (parsed?.questions || [])
      .filter((q: any) =>
        q && typeof q.question === "string" && q.question.trim() &&
        Array.isArray(q.options) && q.options.length === 4 &&
        q.options.every((o: any) => typeof o === "string" && o.trim()) &&
        Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index <= 3)
      .map((q: any) => ({
        department,
        question: q.question.trim(),
        options: q.options.map((o: string) => o.trim()),
        correct_index: q.correct_index,
        source: (q.source || "").toString().slice(0, 200) || null,
        topic: (q.topic || "").toString().trim().toLowerCase().slice(0, 100) || null,
        status: "draft",
        created_by_name: "ИИ по Базе знаний"
      }));

    if (rows.length === 0) return json({ error: "Модель не вернула пригодных вопросов" }, 200);

    const ins = await fetch(`${supaUrl}/rest/v1/quiz_questions`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(rows)
    });
    if (!ins.ok) return json({ error: "Не удалось сохранить вопросы: " + (await ins.text()) }, 200);

    return json({ created: rows.length, articles: kb.count });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
