// Кеширует оболочку приложения (HTML/JS/иконки), чтобы оно открывалось
// быстро и работало при плохом или отсутствующем интернете.
// Данные (Supabase API) НЕ кешируются — только сеть, чтобы никогда
// не показывать устаревшие задачи/чат/финансы как актуальные.

const CACHE_VERSION = 'slon-shell-v11';

const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-head.png',
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
  '/js/directory.js',
  '/js/help.js',
  '/js/notes.js',
  '/js/dashboard.js',
  '/js/calendar.js',
  '/js/feed.js',
  '/js/reviews.js',
  '/js/teamchat.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        SHELL_FILES.map((url) => cache.add(url).catch(() => {
          // не валим установку целиком, если один файл недоступен (напр. CDN)
        }))
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
  const url = new URL(req.url);

  if (req.method !== 'GET') return; // POST/PATCH и т.п. к Supabase не трогаем
  if (url.origin !== self.location.origin) return; // CDN/Supabase — только сеть

  // Оболочка приложения: СЕТЬ В ПРИОРИТЕТЕ — при онлайне всегда свежая версия
  // (обновления применяются сразу, без «двойной перезагрузки»). Кеш — запасной
  // вариант только когда сети нет (офлайн).
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
