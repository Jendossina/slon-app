// Стартовый скрипт: подключается последним (defer), когда HTML уже разобран,
// а все модули объявлены. Раньше этот код жил прямо в index.html.

// Переводим статический HTML. К этому моменту существуют все модалки —
// defer гарантирует, что скрипт выполняется после разбора всей страницы.
if(typeof applyStaticI18n === 'function') applyStaticI18n();

sb.auth.getSession().then(({ data }) => {
  if(data.session) {
    currentUser = data.session.user;
    loadProfile().then(() => showApp());
  }
  else { prefillLogin(); }
});

// ===== Service worker и обновления =====
// Оболочка отдаётся из кеша сразу (иначе на медленном интернете приложение
// каждый запуск ждёт сеть), а свежесть service worker проверяет фоном. Когда он
// сообщает, что версия изменилась, обновлённые файлы уже лежат в кеше — их
// подхватит следующий запуск. А если человек только что открыл приложение и
// ничего не успел сделать, перезагружаем страницу сразу, чтобы он не работал в
// старой версии.
if('serviceWorker' in navigator) {
  const bootTime = Date.now();

  // Как только человек начал что-то вводить (текст, выбор, снятое видео),
  // перезагружать страницу нельзя — потеряет введённое.
  let userTyped = false;
  document.addEventListener('input', () => { userTyped = true; }, true);
  document.addEventListener('change', () => { userTyped = true; }, true);

  function safeToReload() {
    if(Date.now() - bootTime > 20000) return false;            // только сразу после запуска
    if(sessionStorage.getItem('shell-reloaded')) return false; // не больше одного раза за сессию
    if(userTyped) return false;
    if(document.querySelector('.modal-overlay.open')) return false;
    return true;
  }

  navigator.serviceWorker.addEventListener('message', (e) => {
    if(!e.data || e.data.type !== 'shell-updated') return;
    if(safeToReload()) {
      sessionStorage.setItem('shell-reloaded', '1');
      location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
