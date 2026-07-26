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
import { fileURLToPath } from 'node:url';

const PROJECT = 'omeomdkurvtvirhfkffu';
const API = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;
const KEEP = 14; // сколько последних бэкапов хранить

// Корень проекта = папка над scripts/. Привязываемся к расположению самого скрипта,
// а не к текущей папке — иначе планировщик Windows (у него рабочая папка часто
// не применяется) запустил бы бэкап не там и не нашёл бы токен.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getToken() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT.trim();
  const f = path.join(ROOT, '.supabase-pat');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  console.error('❌ Нет токена. Задайте переменную SUPABASE_PAT или создайте файл .supabase-pat с токеном (sbp_...).');
  process.exit(1);
}

// Запрос с повторами: соединение до api.supabase.com периодически отваливается
// по таймауту, а бэкап делает десятки запросов подряд — без повторов он падал
// на первом же сбое и не доходил до конца.
async function q(token, sql, attempt = 1) {
  const MAX = 4;
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql })
    });
    // 4xx (кроме 429) — это ошибка запроса, повторять бессмысленно
    if (!r.ok) {
      const text = await r.text();
      const retryable = r.status === 429 || r.status >= 500;
      if (retryable && attempt < MAX) throw new Error(`retryable ${r.status}: ${text}`);
      throw Object.assign(new Error(`API ${r.status}: ${text}`), { fatal: !retryable });
    }
    return await r.json();
  } catch (e) {
    if (e.fatal || attempt >= MAX) throw e;
    const wait = 1000 * attempt;
    console.log(`  ⏳ сбой связи (${e.message.slice(0, 60)}), повтор ${attempt + 1}/${MAX} через ${wait / 1000}с`);
    await new Promise((r) => setTimeout(r, wait));
    return q(token, sql, attempt + 1);
  }
}

const token = getToken();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(ROOT, 'backups', stamp);
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
const bdir = path.join(ROOT, 'backups');
const all = fs.readdirSync(bdir).filter((d) => {
  try { return fs.statSync(path.join(bdir, d)).isDirectory(); } catch { return false; }
}).sort();
for (const old of all.slice(0, -KEEP)) {
  fs.rmSync(path.join(bdir, old), { recursive: true, force: true });
  console.log(`  🗑  удалён старый бэкап: ${old}`);
}
