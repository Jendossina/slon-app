// Кеширует оболочку приложения (HTML/JS/шрифты/иконки), чтобы оно открывалось
// быстро и работало при плохом или отсутствующем интернете.
// Данные (Supabase API) НЕ кешируются — только сеть, чтобы никогда
// не показывать устаревшие задачи/чат/финансы как актуальные.
//
// Оболочка отдаётся ИЗ КЕША сразу. Раньше был приоритет сети: каждый запуск
// приложение ждало ~30 запросов к серверу (Vercel отдаёт файлы с
// must-revalidate), и на мобильном интернете это секунды пустого экрана.
// Свежесть проверяется фоном, уже после отрисовки: если на сервере что-то
// изменилось, новые файлы тихо кладутся в кеш и применяются при следующем
// запуске. Страницу при этом не перезагружаем — перезагрузка может прийтись на
// момент, когда открыта камера для отметки прихода, и съесть снятое видео.

const CACHE_VERSION = 'slon-shell-v59';

const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-head.png',
  '/fonts/playfair-cyrillic.woff2',
  '/fonts/playfair-latin.woff2',
  '/js/vendor/supabase-js-2.js',
  '/js/i18n.js',
  '/js/core.js',
  '/js/home.js',
  '/js/profile.js',
  '/js/tasks.js',
  '/js/hr.js',
  '/js/finance.js',
  '/js/crm.js',
  '/js/admin.js',
  '/js/schedule.js',
  '/js/checklists.js',
  '/js/kb.js',
  '/js/supply.js',
  '/js/dishware.js',
  '/js/bonus.js',
  '/js/quiz.js',
  '/js/directory.js',
  '/js/help.js',
  '/js/notes.js',
  '/js/dashboard.js',
  '/js/calendar.js',
  '/js/feed.js',
  '/js/reviews.js',
  '/js/teamchat.js',
  '/js/stoplist.js',
  '/js/install.js',
  '/js/boot.js',
];

const SHELL_SET = new Set(SHELL_FILES);
const MATCH_OPTS = { ignoreSearch: true, ignoreVary: true };

// Кладём ответ в кеш, снимая метку «после редиректа»: сервер отвечает на
// /index.html перенаправлением на /, а редиректный ответ браузер отказывается
// принимать как страницу — навигация падает с сетевой ошибкой.
async function cachePut(cache, url, res) {
  if (!res || !res.ok) return;
  const body = await res.blob();
  await cache.put(url, new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        SHELL_FILES.map(async (url) => {
          try { await cachePut(cache, url, await fetch(url, { cache: 'reload' })); }
          catch (e) { /* не валим установку целиком, если один файл недоступен */ }
        })
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// «Отпечаток» ответа, по которому видно, что файл на сервере изменился.
function stamp(res) {
  if (!res) return null;
  return res.headers.get('etag') || res.headers.get('last-modified') || res.headers.get('content-length');
}

// Фоновая проверка свежести: раз в запуск приложения (не чаще раза в минуту).
let lastCheck = 0;
let checking = false;

async function revalidateShell() {
  if (checking) return;
  checking = true;
  try {
    const cache = await caches.open(CACHE_VERSION);
    // Небольшими партиями, чтобы не забивать канал на слабой связи
    for (let i = 0; i < SHELL_FILES.length; i += 6) {
      const batch = SHELL_FILES.slice(i, i + 6);
      await Promise.all(batch.map(async (url) => {
        try {
          // no-cache = условный запрос к серверу: обычно вернётся 304 и почти нулевой трафик
          const fresh = await fetch(url, { cache: 'no-cache' });
          if (!fresh || !fresh.ok) return;
          const old = await cache.match(url, MATCH_OPTS);
          if (stamp(old) === stamp(fresh)) return; // файл не менялся
          await cachePut(cache, url, fresh);
        } catch (e) {
          // нет сети — просто оставляем то, что уже в кеше
        }
      }));
    }
  } catch (e) {}
  checking = false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return; // POST/PATCH и т.п. к Supabase не трогаем

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // Supabase, фото из хранилища — только сеть

  const isNavigation = req.mode === 'navigate';

  // Всё, что не оболочка (в том числе сам /sw.js), — обычной дорогой через сеть
  if (!isNavigation && !SHELL_SET.has(url.pathname)) return;

  // Каждый запуск приложения — одна фоновая проверка обновлений, уже после отрисовки
  if (isNavigation && Date.now() - lastCheck > 60000) {
    lastCheck = Date.now();
    event.waitUntil(revalidateShell());
  }

  // Оболочка: КЕШ В ПРИОРИТЕТЕ — экран появляется мгновенно и без сети.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = isNavigation
      ? (await cache.match('/', MATCH_OPTS)) || (await cache.match('/index.html', MATCH_OPTS))
      : await cache.match(req, MATCH_OPTS);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cachePut(cache, req.url, res.clone());
      return res;
    } catch (e) {
      // офлайн и в кеше пусто — для перехода по странице отдаём оболочку
      const shell = (await cache.match('/', MATCH_OPTS)) || (await cache.match('/index.html', MATCH_OPTS));
      if (shell) return shell;
      throw e;
    }
  })());
});
