// Разворачивает edge-функцию в боевой проект Slon через Supabase Management API.
//
// Запуск:  node scripts/deploy-function.mjs <slug> [--verify-jwt]
//   пример: node scripts/deploy-function.mjs admin-set-user-ban
//
// Берёт supabase/functions/<slug>/index.ts и заливает как новую версию.
// Токен (sbp_...) — как у apply-migration.mjs: переменная SUPABASE_PAT либо
// файл .supabase-pat в корне (оба в .gitignore).
//
// По умолчанию функция разворачивается БЕЗ проверки JWT на стороне платформы
// (--verify-jwt включает её): наши админские функции проверяют токен сами,
// чтобы вернуть человеку понятную причину отказа, а не голый 401.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'omeomdkurvtvirhfkffu';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getToken() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT.trim();
  const f = path.join(ROOT, '.supabase-pat');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  console.error('❌ Нет токена. Задайте SUPABASE_PAT или создайте файл .supabase-pat с токеном (sbp_...).');
  process.exit(1);
}

const slug = process.argv[2];
const verifyJwt = process.argv.includes('--verify-jwt');
if (!slug) {
  console.error('Укажите функцию: node scripts/deploy-function.mjs <slug> [--verify-jwt]');
  process.exit(1);
}
const file = path.join(ROOT, 'supabase', 'functions', slug, 'index.ts');
if (!fs.existsSync(file)) {
  console.error('❌ Файл не найден: ' + file);
  process.exit(1);
}

const token = getToken();
const source = fs.readFileSync(file, 'utf8');   // UTF-8: кириллица в комментариях не бьётся

const form = new FormData();
form.append('metadata', new Blob([JSON.stringify({
  name: slug,
  entrypoint_path: 'index.ts',
  verify_jwt: verifyJwt,
})], { type: 'application/json' }));
form.append('file', new Blob([source], { type: 'application/typescript' }), 'index.ts');

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/functions/deploy?slug=${slug}`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token },
  body: form,
});
const text = await res.text();
if (!res.ok) {
  console.error(`❌ Не развернулось (${res.status}): ${text}`);
  process.exit(1);
}
let info = {};
try { info = JSON.parse(text); } catch (e) { /* ответ без JSON — не беда */ }
console.log(`✅ ${slug} развёрнута: версия ${info.version ?? '?'}, статус ${info.status ?? '?'}, verify_jwt=${verifyJwt}`);
