// Поменял файл оболочки — подними CACHE_VERSION в sw.js.
//
// Обновление у людей на телефонах приезжает ТОЛЬКО через смену этой строки:
// service worker отдаёт оболочку из кеша, а браузер скачивает её заново, когда
// видит новый sw.js. Забыли поднять версию — сотрудники сидят на старой версии
// приложения и не понимают, почему исправление «не приехало».
//
// Запуск: node scripts/check-sw-version.mjs <старый-коммит> <новый-коммит>
// Без аргументов сравнивает HEAD~1 и HEAD.

import { execSync } from 'node:child_process';

const [, , baseArg, headArg] = process.argv;
const base = baseArg && baseArg !== '0000000000000000000000000000000000000000' ? baseArg : 'HEAD~1';
const head = headArg || 'HEAD';

const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();

let changed;
try {
  changed = git(`diff --name-only ${base} ${head}`).split('\n').filter(Boolean);
} catch (e) {
  console.log('Не с чем сравнивать (нет предыдущего коммита) — пропускаем проверку.');
  process.exit(0);
}

// Файлы оболочки берём из самого sw.js, чтобы список не разъезжался
const swNow = git(`show ${head}:sw.js`);
const shellFiles = [...swNow.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((p) => p !== '/');
const isShell = (f) => {
  const p = '/' + f.replace(/\\/g, '/');
  return p === '/index.html' || shellFiles.includes(p);
};

const touched = changed.filter(isShell);
if (touched.length === 0) {
  console.log('Файлы оболочки не менялись — версия кеша не нужна.');
  process.exit(0);
}

const version = (src) => (src.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
const before = version(git(`show ${base}:sw.js`));
const after = version(swNow);

if (before === after) {
  console.error('❌ Изменены файлы оболочки, а CACHE_VERSION в sw.js остался прежним (' + after + ').');
  console.error('   Изменены: ' + touched.join(', '));
  console.error('   Подними версию — иначе обновление не доедет до телефонов.');
  process.exit(1);
}

console.log(`✅ Оболочка изменена (${touched.length} файл(ов)), CACHE_VERSION поднят: ${before} → ${after}`);
