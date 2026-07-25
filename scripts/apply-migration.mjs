// Применяет SQL-миграцию к боевой базе Slon через Supabase Management API.
//
// Запуск:  node scripts/apply-migration.mjs supabase/migrations/<файл>.sql
//
// Токен (sbp_...) берётся так же, как в backup.mjs: переменная SUPABASE_PAT
// либо файл .supabase-pat в корне (оба в .gitignore).
//
// Файл читается как UTF-8 и уходит в JSON-теле запроса — кириллица в комментариях
// не бьётся (через шелл она превращается в «?»).
//
// Миграции написаны идемпотентно (create table if not exists / drop policy if exists),
// поэтому повторный запуск безопасен.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'omeomdkurvtvirhfkffu';
const API = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getToken() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT.trim();
  const f = path.join(ROOT, '.supabase-pat');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  console.error('❌ Нет токена. Задайте SUPABASE_PAT или создайте файл .supabase-pat с токеном (sbp_...).');
  process.exit(1);
}

const rel = process.argv[2];
if (!rel) {
  console.error('Укажите файл миграции: node scripts/apply-migration.mjs supabase/migrations/<файл>.sql');
  process.exit(1);
}
const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
if (!fs.existsSync(file)) {
  console.error('❌ Файл не найден: ' + file);
  process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');
console.log(`▶ Применяю ${path.basename(file)} (${sql.split('\n').length} строк) к базе ${PROJECT}…`);

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();

if (!res.ok) {
  console.error(`❌ Ошибка ${res.status}: ${text}`);
  process.exit(1);
}
console.log('✅ Миграция применена.');
if (text && text !== '[]') console.log(text);
