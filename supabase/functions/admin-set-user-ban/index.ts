// Supabase Edge Function: admin-set-user-ban
//
// Блокирует учётную запись уволенного в Auth и снимает блокировку при возврате
// в штат. Зачем отдельная функция: статус «Уволен» в карточке — это данные, а
// вход в приложение решает Auth. Пока учётка жива, уволенный логинится своим
// логином и паролем как ни в чём не бывало: попадает в ленту, чат, чек-листы и
// даже отмечает приход. Проверка статуса в приложении (loadProfile) — первый
// рубеж, но это клиент; настоящая стена здесь — забаненному GoTrue просто не
// выдаёт токен.
//
// Развёрнута без проверки JWT (verify_jwt=false) — как admin-delete-user:
// токен вызывающего проверяем сами и по нему же считаем права.
//
// POST { employeeId: number, banned: boolean }
//   banned=true  — заблокировать (сотрудник обязан быть уже уволен в карточке)
//   banned=false — вернуть доступ
// Ответ: { ok, banned, authChanged, sessionsRevoked }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// 100 лет: у GoTrue нет «навсегда», снимаем блокировку явным ban_duration=none
const FOREVER = "876000h";

const svc = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function rest(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: svc });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!SB_URL || !SB_KEY) return json({ error: "no service key" }, 500);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Нет токена" }, 401);

    // Кто зовёт. Токен проверяет сам Auth — подделать не выйдет.
    const meRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return json({ error: "Сессия недействительна" }, 401);
    const me = await meRes.json();

    const body = await req.json().catch(() => ({}));
    const employeeId = Number(body.employeeId);
    const banned = body.banned === true;
    if (!employeeId) return json({ error: "Нет employeeId" }, 400);

    const callerRows = await rest(`profiles?user_id=eq.${me.id}&select=role,employee_id`);
    const caller = callerRows[0];
    if (!caller) return json({ error: "Профиль вызывающего не найден" }, 403);
    if (String(caller.employee_id ?? "") === String(employeeId)) {
      return json({ error: "Себе доступ не закрывают" }, 400);
    }

    const empRows = await rest(`employees?id=eq.${employeeId}&select=id,name,department,status`);
    const emp = empRows[0];
    if (!emp) return json({ error: "Сотрудник не найден" }, 404);

    // Права те же, что на правку карточки: руководство — всех, старший цеха —
    // своих. Правило про старшего не дублируем, а спрашиваем у базы той же
    // функцией, что и RLS, и от имени вызывающего (внутри неё auth.uid()).
    let allowed = caller.role === "admin" || caller.role === "manager";
    if (!allowed) {
      const leadRes = await fetch(`${SB_URL}/rest/v1/rpc/is_dept_lead`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_dept: emp.department }),
      });
      allowed = leadRes.ok && (await leadRes.json()) === true;
    }
    if (!allowed) return json({ error: "Недостаточно прав" }, 403);

    // Блокировка идёт только следом за увольнением в карточке: так статус в
    // приложении и доступ в Auth не разъезжаются.
    if (banned && emp.status !== "Уволен") {
      return json({ error: "Сотрудник не уволен — блокировать не за что" }, 400);
    }

    const profRows = await rest(`profiles?employee_id=eq.${employeeId}&select=user_id`);
    const userId = profRows[0]?.user_id;
    if (!userId) return json({ ok: true, banned, authChanged: false, reason: "Учётной записи нет" });

    const upd = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: svc,
      body: JSON.stringify({ ban_duration: banned ? FOREVER : "none" }),
    });
    if (!upd.ok) return json({ error: `Auth: ${upd.status} ${await upd.text()}` }, 500);

    // Бан не выдаёт НОВЫХ токенов, но уже выданный живёт до конца часа. Гасим
    // открытые сессии, чтобы телефон уволенного отвалился сразу.
    let sessionsRevoked = false;
    if (banned) {
      try {
        const out = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}/sessions`, { method: "DELETE", headers: svc });
        sessionsRevoked = out.ok;
      } catch (_e) { /* не критично: следующий refresh всё равно упрётся в бан */ }
    }

    return json({ ok: true, banned, authChanged: true, sessionsRevoked, name: emp.name });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
