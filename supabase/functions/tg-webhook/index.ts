// Supabase Edge Function: tg-webhook
//
// Привязывает Telegram-чат к аккаунту приложения по разовому коду.
// Приложение выдаёт код (RPC tg_link_code_new) и открывает
// t.me/SlonShishaBot?start=<код> — Telegram присылает сюда «/start <код>»,
// мы находим владельца кода и записываем ему chat_id.
//
// Функция развёрнута без проверки JWT: запросы шлёт Telegram, а не браузер.
// Подлинность подтверждает заголовок X-Telegram-Bot-Api-Secret-Token, который
// Telegram отдаёт обратно из setWebhook — без него принимать «/start» нельзя,
// иначе привязать чужой чат сможет кто угодно, кто узнал адрес функции.
//
// Разовая настройка (после деплоя):
//   GET <url>?setup=1&secret=<TG_WEBHOOK_SECRET>
// регистрирует вебхук у Telegram и возвращает данные бота.

const TG_TOKEN = Deno.env.get('TG_TOKEN') ?? '';
const SECRET = Deno.env.get('TG_WEBHOOK_SECRET') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const HELP = 'Чтобы получать уведомления, открой приложение → Профиль → «Подключить Telegram». '
  + 'Кнопка сама вернёт тебя сюда, и всё привяжется.';

async function tg(method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await res.json();
}

async function rpc(fn: string, args: unknown) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return await res.json();
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Посмотреть текущее состояние, ничего не меняя: у бота может быть уже
  // настроен чужой вебхук, и setWebhook молча его перезапишет.
  if (url.searchParams.get('info')) {
    if (!SECRET || url.searchParams.get('secret') !== SECRET) return json({ error: 'forbidden' }, 403);
    return json({ webhook: await tg('getWebhookInfo', {}), me: await tg('getMe', {}) });
  }

  if (url.searchParams.get('setup')) {
    if (!SECRET || url.searchParams.get('secret') !== SECRET) return json({ error: 'forbidden' }, 403);
    const hook = await tg('setWebhook', {
      url: `${SB_URL}/functions/v1/tg-webhook`,
      secret_token: SECRET,
      allowed_updates: ['message'],
    });
    return json({ hook, me: await tg('getMe', {}) });
  }

  if (req.method !== 'POST') return json({ ok: true });
  if (!SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== SECRET) return json({ error: 'forbidden' }, 403);

  // Telegram считает доставленным любой ответ 200 и не повторяет его. Поэтому
  // отвечаем 200 даже на свои ошибки: повторная доставка того же «/start»
  // ничего не починит, а очередь обновлений застрянет.
  try {
    const update = await req.json();
    const msg = update?.message;
    const text = String(msg?.text ?? '').trim();
    const chatId = msg?.chat?.id;
    if (!chatId || !text) return json({ ok: true });

    if (!text.startsWith('/start')) {
      await tg('sendMessage', { chat_id: chatId, text: HELP });
      return json({ ok: true });
    }

    const code = text.split(/\s+/)[1] ?? '';
    if (!code) {
      await tg('sendMessage', { chat_id: chatId, text: `🐘 Это бот SLON.\n\n${HELP}` });
      return json({ ok: true });
    }

    const name = await rpc('tg_link_apply', { p_code: code, p_chat_id: String(chatId) });
    if (!name) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `Код уже использован или устарел (он живёт 15 минут).\n\n${HELP}`,
      });
      return json({ ok: true });
    }

    await tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `✅ <b>Готово, ${name}!</b>\n\nТеперь сюда придут напоминания о чек-листах, задачи и график.`,
    });
    return json({ ok: true });
  } catch (e) {
    console.error('tg-webhook', e);
    return json({ ok: true, error: String(e) });
  }
});
