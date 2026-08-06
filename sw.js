// Кеширует оболочку приложения (HTML/JS/шрифты/иконки), чтобы оно открывалось
// быстро и работало при плохом или отсутствующем интернете.
// Данные (Supabase API) НЕ кешируются — только сеть, чтобы никогда
// не показывать устаревшие задачи/чат/финансы как актуальные.
//
// Оболочка отдаётся ИЗ КЕША сразу. Раньше был приоритет сети: каждый запуск
// приложение ждало ~30 запросов к серверу (Vercel отдаёт файлы с
// must-revalidate), и на мобильном интернете это секунды пустого экрана.
//
// ОБНОВЛЕНИЕ ИДЁТ ТОЛЬКО ЧЕРЕЗ CACHE_VERSION. Пробовали хитрее — фоном
// перепроверять каждый файл и подменять его в живом кеше. На телефоне это
// разваливалось: Android останавливает service worker когда захочет, проверка
// обрывалась на середине, и в кеше оставалась СМЕСЬ старых и новых файлов
// (ловили новый core.js со старым quiz.js и старым boot.js). Штатный механизм
// браузера таких состояний не допускает: он сам перезапрашивает sw.js при
// каждом открытии приложения, при изменившемся файле ставит новую версию,
// скачивает оболочку целиком в НОВЫЙ кеш и переключается на него только если
// скачалось всё. Оборвалась установка — продолжает работать прежняя версия.
//
// Отсюда правило: поменял любой файл оболочки — подними CACHE_VERSION.
// За этим следит CI (scripts/check-sw-version.mjs), забыть не даст.

const CACHE_VERSION = 'slon-shell-v64';

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
  '/js/menu.js',
  '/js/stoplist.js',
  '/js/install.js',
  '/js/boot.js',
];

const SHELL_SET = new Set(SHELL_FILES);
const MATCH_OPTS = { ignoreSearch: true, ignoreVary: true };

// При установке качаем только то, без чего приложение не откроется. Остальное
// кладётся в кеш само, когда первый раз понадобится.
// Почему так: установка новой версии обязана дойти до конца, иначе браузер её
// отменит и телефон останется на старой — именно это и случилось у сотрудников,
// когда установка тянула все 36 файлов разом на слабой связи. Кеш именованный
// по версии, так что смеси старого с новым не будет и при частичном заполнении.
const CORE_FILES = [
  '/',
  '/index.html',
  '/js/vendor/supabase-js-2.js',
  '/js/i18n.js',
  '/js/core.js',
  '/js/home.js',
  '/js/boot.js',
];

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
        CORE_FILES.map(async (url) => {
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

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return; // POST/PATCH и т.п. к Supabase не трогаем

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // Supabase, фото из хранилища — только сеть

  const isNavigation = req.mode === 'navigate';

  // Всё, что не оболочка (в том числе сам /sw.js), — обычной дорогой через сеть
  if (!isNavigation && !SHELL_SET.has(url.pathname)) return;

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
      // Офлайн и в кеше пусто. Оболочку подставляем ТОЛЬКО для перехода по
      // странице: отдать HTML вместо js-файла — значит уронить приложение
      // с «Unexpected token '<'».
      if (isNavigation) {
        const shell = (await cache.match('/', MATCH_OPTS)) || (await cache.match('/index.html', MATCH_OPTS));
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
