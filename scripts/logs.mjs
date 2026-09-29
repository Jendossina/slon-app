// Логи Supabase из командной строки.
//
// Зачем скриптом, а не руками: логи живут сутки, и когда сотрудник говорит
// «не работает», смотреть надо сразу и с телефона разработчика тоже.
//
// ВАЖНО. 23.09.2026 Supabase удалил ручку `analytics/endpoints/logs.all`
// (теперь она отдаёт 410). Всё переехало на `analytics/endpoints/logs`, и там
// три отличия, из-за которых старые запросы просто не работают:
//   1) диалект ClickHouse, а не BigQuery;
//   2) одна таблица `logs` на все источники, источник выбирается условием
//      `where source = '...'` (поля `source_name` из changelog у нас НЕТ,
//      колонка называется `source`);
//   3) счёт строк — `count()`, без звёздочки.
//
// Токен — как у backup.mjs: SUPABASE_PAT или файл .supabase-pat в корне.
//
// Примеры:
//   node scripts/logs.mjs --errors                 ошибки API за сутки
//   node scripts/logs.mjs --sources                какие источники вообще есть
//   node scripts/logs.mjs --who "Доос"             чем занимался телефон человека
//   node scripts/logs.mjs --hours 3 --grep video   всё про видео за три часа
//   node scripts/logs.mjs --sql "select ..."       свой запрос

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'omeomdkurvtvirhfkffu';
const API = `https://api.supabase.com/v1/projects/${PROJECT}/analytics/endpoints/logs`;

function token() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT.trim();
  const f = path.join(ROOT, '.supabase-pat');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  console.error('❌ Нет токена: задайте SUPABASE_PAT или положите .supabase-pat в корень.');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const has = (name) => args.includes('--' + name);

const hours = Number(flag('hours', 24));
const limit = Number(flag('limit', 40));
const esc = (s) => String(s).replace(/'/g, "''");   // ClickHouse экранирует кавычку удвоением

function buildSql() {
  if (has('sql')) return String(flag('sql'));
  if (has('sources')) return 'select source, count() as n from logs group by source order by n desc';
  if (has('errors')) {
    // Код ответа — второе поле строки «GET | 404 | адрес | браузер». Через
    // match() не ищем: эта ручка молча отдаёт всё подряд, будто условия и не
    // было — проверено на живых логах. splitByString фильтрует честно.
    return "select timestamp, splitByString(' | ', event_message)[2] as code, event_message from logs"
      + " where source = 'edge_logs' and toUInt16OrZero(splitByString(' | ', event_message)[2]) >= 400"
      + ` order by timestamp desc limit ${limit}`;
  }
  if (has('who')) {
    const q = esc(flag('who'));
    return `select timestamp, event_message from logs where position(event_message, '${q}') > 0`
      + ` order by timestamp desc limit ${limit}`;
  }
  if (has('grep')) {
    const q = esc(flag('grep'));
    return `select timestamp, source, event_message from logs where position(event_message, '${q}') > 0`
      + ` order by timestamp desc limit ${limit}`;
  }
  const src = flag('source', 'edge_logs');
  return `select timestamp, event_message from logs where source = '${esc(src)}'`
    + ` order by timestamp desc limit ${limit}`;
}

const sql = buildSql();
const end = new Date();
const start = new Date(Date.now() - hours * 3600e3);
const url = `${API}?sql=${encodeURIComponent(sql)}`
  + `&iso_timestamp_start=${start.toISOString()}&iso_timestamp_end=${end.toISOString()}`;

// Ручка быстро упирается в ограничение по частоте (429) — при нём ждём и
// повторяем, иначе разбор инцидента спотыкается на ровном месте.
async function ask(attempt = 1) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  const text = await res.text();
  if (res.status === 429 && attempt <= 3) {
    const wait = attempt * 30;
    console.error(`⏳ Слишком частые запросы, жду ${wait} c…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return ask(attempt + 1);
  }
  if (!res.ok) {
    console.error(`❌ HTTP ${res.status}: ${text.slice(0, 300)}`);
    if (res.status === 401) console.error('Похоже, истёк токен Supabase — нужен новый.');
    process.exit(1);
  }
  return JSON.parse(text);
}

const data = await ask();
if (data.error) {
  console.error('❌ Запрос не выполнен:', JSON.stringify(data.error).slice(0, 300));
  console.error('Напоминание: диалект ClickHouse, источник выбирается как source = \'edge_logs\'.');
  process.exit(1);
}

const rows = data.result || [];
console.log(`Запрос: ${sql}`);
console.log(`Окно: последние ${hours} ч · строк: ${rows.length}\n`);
for (const r of rows) {
  const ts = String(r.timestamp || '').replace('T', ' ').slice(0, 19);
  const rest = Object.entries(r)
    .filter(([k]) => k !== 'timestamp')
    .map(([k, v]) => (k === 'event_message' ? String(v) : `${k}=${v}`))
    .join(' · ');
  console.log(ts ? `${ts}  ${rest}` : rest);
}
