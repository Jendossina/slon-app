// Supabase Edge Function: cleanup-media
//
// Убирает из бакета task-reports всё, чей срок хранения вышел. Что именно
// считать просроченным, решает SQL-функция media_expired() — здесь только
// удаление, потому что стереть файл из хранилища можно лишь через Storage API:
// строка в storage.objects исчезнет и из SQL, но сам файл останется лежать и
// место не освободит.
//
// Запускается раз в сутки из pg_cron (media_cleanup_run), развёрнута без
// проверки JWT — как send-telegram. Секрета у неё нет намеренно: функция не
// принимает никаких параметров и умеет ровно одно — применить тот же срок
// хранения, который и так применится ночью. Худшее, что даёт знание адреса, —
// уборка случится на несколько часов раньше.
//
// GET ?dry=1 — показать, что удалилось бы, ничего не трогая.

const BUCKET = 'task-reports';
const RETENTION_DAYS = 14;   // сколько живут фото и видео
const ORPHAN_DAYS = 2;       // и через сколько считать видео прихода ничейным
const BATCH = 100;           // Storage API удаляет пачками

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const auth = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

type Doomed = { name: string; bytes: number; reason: string };

async function expired(): Promise<Doomed[]> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/media_expired`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ p_days: RETENTION_DAYS, p_orphan_days: ORPHAN_DAYS }),
  });
  if (!res.ok) throw new Error(`media_expired: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Возвращает имена файлов, которые хранилище реально удалило. Именно реально:
// молчаливый отказ по правам выглядит как пустой ответ без ошибки, и раньше
// приложение считало такой ответ успешной уборкой.
async function remove(names: string[]): Promise<string[]> {
  const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: auth,
    body: JSON.stringify({ prefixes: names }),
  });
  if (!res.ok) throw new Error(`remove: ${res.status} ${await res.text()}`);
  const done = await res.json();
  return Array.isArray(done) ? done.map((d: { name: string }) => d.name) : [];
}

Deno.serve(async (req) => {
  try {
    if (!SB_URL || !SB_KEY) return json({ error: 'no service key' }, 500);

    const doomed = await expired();
    const bytes = doomed.reduce((s, d) => s + Number(d.bytes || 0), 0);
    const stats = {
      files: doomed.length,
      mb: Math.round(bytes / 1048576 * 10) / 10,
      expired: doomed.filter((d) => d.reason === 'expired').length,
      orphans: doomed.filter((d) => d.reason === 'orphan').length,
    };

    if (new URL(req.url).searchParams.get('dry')) return json({ dry: true, ...stats });
    if (!doomed.length) return json({ deleted: 0, mb: 0 });

    let deleted = 0;
    for (let i = 0; i < doomed.length; i += BATCH) {
      const batch = doomed.slice(i, i + BATCH).map((d) => d.name);
      deleted += (await remove(batch)).length;
    }
    return json({ ...stats, deleted });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
