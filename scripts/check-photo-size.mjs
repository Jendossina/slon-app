// Проверка, что фото из приложения приходят сжатыми.
//
// Запуск: node scripts/check-photo-size.mjs [сколько дней назад | с какой даты]
// По умолчанию смотрит последние семь дней — ровно столько, сколько проходит
// между запусками из Планировщика заданий (задание «Slon Photo Check»,
// по понедельникам).
//
// У каждого виновника показывает дату последнего тяжёлого снимка: сразу после
// починки в недельное окно ещё попадают снимки, снятые до неё, и без даты это
// читается как «не помогло».
//
// Ищет в хранилище снимки тяжелее 1 МБ (кроме фото чеков — их сжимают слабее
// намеренно) и показывает, чьи они. Результат всегда печатается в консоль, а
// окном Windows выскакивает, только если есть о чём сказать: еженедельное
// «всё хорошо» в окне быстро приучает закрывать его не читая.
//
// Токен — как у backup.mjs: SUPABASE_PAT или файл .supabase-pat в корне.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'omeomdkurvtvirhfkffu';
// Дату собираем из местных частей, а не через toISOString(): у нас UTC+5, и
// в первые пять часов суток срез по UTC уехал бы на день назад.
const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const arg = process.argv[2] || '7';
const since = /^[0-9]+$/.test(arg) ? ymd(new Date(Date.now() - Number(arg) * 86400e3)) : arg;
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('нужно число дней или дата в виде ГГГГ-ММ-ДД');

function token() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT.trim();
  return fs.readFileSync(path.join(ROOT, '.supabase-pat'), 'utf8').trim();
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Supabase ответил ${res.status}: ${await res.text()}`);
  return res.json();
}

function popup(text) {
  if (process.platform !== 'win32' || process.env.SLON_NO_POPUP) return;
  const ps = 'Add-Type -AssemblyName PresentationFramework; ' +
    '[System.Windows.MessageBox]::Show($env:SLON_MSG, "Slon: проверка сжатия фото") | Out-Null';
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { env: { ...process.env, SLON_MSG: text } }); }
  catch { /* окна может не быть (нет сеанса) — текст всё равно в консоли */ }
}

let msg;
let problem = true; // окно показываем, только когда есть о чём сказать
try {
  const [rows, [total]] = await Promise.all([
    query(`select p.employee_id, p.name, count(*) n, sum((o.metadata->>'size')::bigint)/1048576 mb, max(o.created_at) last_at
             from storage.objects o left join public.profiles p on p.user_id::text = o.owner_id::text
            where o.metadata->>'mimetype' like 'image%'
              and o.name not like 'receipt-%'
              and (o.metadata->>'size')::bigint > 1048576
              and o.created_at >= '${since}'
            group by 1, 2 order by 3 desc`),
    query(`select sum((metadata->>'size')::bigint)/1048576 mb from storage.objects`),
  ]);
  const used = `Хранилище: ${Math.round(total.mb)} МБ из 1024.`;
  problem = rows.length > 0;
  msg = rows.length
    ? `Фото тяжелее 1 МБ с ${since} всё ещё приходят:\n` +
      rows.map((r) => `• сотрудник №${r.employee_id} ${r.name || ''}: ${r.n} шт., ${Math.round(r.mb)} МБ, последнее ${new Date(r.last_at).toLocaleDateString('ru-RU')}`).join('\n') +
      `\n\n${used}\nСжатие не помогло — напишите Claude.`
    : `С ${since} ни одного несжатого фото — исправление сработало.\n${used}`;
} catch (e) {
  msg = `Проверку сделать не удалось: ${e.message}\nЕсли это 401 — токен Supabase истёк, нужен новый.`;
}
console.log(msg);
if (problem) popup(msg);
