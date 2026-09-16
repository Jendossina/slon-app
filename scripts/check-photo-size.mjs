// Проверка, что фото из приложения приходят сжатыми.
//
// Запуск: node scripts/check-photo-size.mjs [с какой даты, по умолчанию 2026-09-17]
// Ищет в хранилище снимки тяжелее 1 МБ (кроме фото чеков — их сжимают слабее
// намеренно) и показывает, чьи они. Результат выводится в консоль и окном
// Windows — скрипт запускается и из Планировщика заданий как напоминание.
//
// Токен — как у backup.mjs: SUPABASE_PAT или файл .supabase-pat в корне.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'omeomdkurvtvirhfkffu';
const since = process.argv[2] || '2026-09-17';
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('дата нужна в виде ГГГГ-ММ-ДД');

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
try {
  const [rows, [total]] = await Promise.all([
    query(`select p.employee_id, p.name, count(*) n, sum((o.metadata->>'size')::bigint)/1048576 mb
             from storage.objects o left join public.profiles p on p.user_id::text = o.owner_id::text
            where o.metadata->>'mimetype' like 'image%'
              and o.name not like 'receipt-%'
              and (o.metadata->>'size')::bigint > 1048576
              and o.created_at >= '${since}'
            group by 1, 2 order by 3 desc`),
    query(`select sum((metadata->>'size')::bigint)/1048576 mb from storage.objects`),
  ]);
  const used = `Хранилище: ${Math.round(total.mb)} МБ из 1024.`;
  msg = rows.length
    ? `Фото тяжелее 1 МБ с ${since} всё ещё приходят:\n` +
      rows.map((r) => `• сотрудник №${r.employee_id} ${r.name || ''}: ${r.n} шт., ${Math.round(r.mb)} МБ`).join('\n') +
      `\n\n${used}\nСжатие не помогло — напишите Claude.`
    : `С ${since} ни одного несжатого фото — исправление сработало.\n${used}`;
} catch (e) {
  msg = `Проверку сделать не удалось: ${e.message}\nЕсли это 401 — токен Supabase истёк, нужен новый.`;
}
console.log(msg);
popup(msg);
