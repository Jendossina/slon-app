// Стартовый скрипт: подключается последним (defer), когда HTML уже разобран,
// а все модули объявлены. Раньше этот код жил прямо в index.html.

// Переводим статический HTML. К этому моменту существуют все модалки —
// defer гарантирует, что скрипт выполняется после разбора всей страницы.
if(typeof applyStaticI18n === 'function') applyStaticI18n();

sb.auth.getSession().then(({ data }) => {
  if(data.session) {
    currentUser = data.session.user;
    loadProfile().then(res => {
      if(res && res.ok) showApp();
      else if(res && res.reason === 'network') showProfileNetworkError();
    });
  }
  else { prefillLogin(); }
});

// ===== Service worker =====
// Оболочка отдаётся из кеша сразу, свежесть service worker проверяет фоном.
// Обновление НЕ перезагружает страницу само: перезагрузка может прийтись ровно
// на момент, когда открыта камера для отметки прихода — снятое видео тогда
// теряется, и отметка не проходит. Новые файлы просто ложатся в кеш и
// применяются при следующем запуске приложения.
if('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
