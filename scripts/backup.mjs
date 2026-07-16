// Локальный бэкап боевых данных Slon.
// Выгружает все таблицы схемы public из Supabase в JSON-файлы:
//   backups/<дата-время>/<таблица>.json  (+ _manifest.json)
// Хранит последние 14 бэкапов, старые удаляет.
//
// Токен доступа (Supabase Personal Access Token, sbp_...) берётся из:
//   1) переменной окружения SUPABASE_PAT, либо
//   2) файла .supabase-pat в корне проекта (обе — в .gitignore, в git не попадают).
//
// Запуск вручную:  node scripts/backup.mjs
// Автозапуск: см. README-инструкцию (Windows Task Scheduler).
//
// Примечание: сохраняются бизнес-данные (схема public). Логины (auth.users)
// сюда НЕ входят — их при необходимости заводят заново через админку.

import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'omeomdkurvtvirhfkffu';
const API = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;
const KEEP = 14; // сколько последних бэкапов хранить

function getToken() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT.trim();
  const f = path.join(process.cwd(), '.supabase-pat');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  console.error('❌ Нет токена. Задайте переменную SUPABASE_PAT или создайте файл .supabase-pat с токеном (sbp_...).');
  process.exit(1);
}

async function q(token, sql) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  return r.json();
}

const token = getToken();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(process.cwd(), 'backups', stamp);
fs.mkdirSync(dir, { recursive: true });

const tables = (await q(token, "select tablename from pg_tables where schemaname='public' order by tablename"))
  .map((r) => r.tablename);

let total = 0;
for (const t of tables) {
  const rows = await q(token, `select * from public."${t}"`);
  fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows, null, 2));
  total += rows.length;
  console.log(`  ${t}: ${rows.length}`);
}

fs.writeFileSync(path.join(dir, '_manifest.json'),
  JSON.stringify({ project: PROJECT, at: new Date().toISOString(), tables: tables.length, rows: total }, null, 2));
console.log(`\n✅ Бэкап готов: backups/${stamp} — ${tables.length} таблиц, ${total} строк`);

// Чистка старых бэкапов (оставляем последние KEEP)
const bdir = path.join(process.cwd(), 'backups');
const all = fs.readdirSync(bdir).filter((d) => {
  try { return fs.statSync(path.join(bdir, d)).isDirectory(); } catch { return false; }
}).sort();
for (const old of all.slice(0, -KEEP)) {
  fs.rmSync(path.join(bdir, old), { recursive: true, force: true });
  console.log(`  🗑  удалён старый бэкап: ${old}`);
}
