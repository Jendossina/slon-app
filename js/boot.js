// Стартовый скрипт: подключается последним (defer), когда HTML уже разобран,
// а все модули объявлены. Раньше этот код жил прямо в index.html.

// Переводим статический HTML. К этому моменту существуют все модалки —
// defer гарантирует, что скрипт выполняется после разбора всей страницы.
if(typeof applyStaticI18n === 'function') applyStaticI18n();

// Пока не выяснили, кто вошёл, висит заставка. Показать форму входа человеку,
// который на самом деле в системе, — значит сказать ему «тебя выкинуло».
function hideSplash() {
  const s = document.getElementById('app-splash');
  if(s) s.style.display = 'none';
}
function showLoginScreen() {
  hideSplash();
  document.getElementById('app-page').style.display = 'none';
  document.getElementById('login-page').style.display = 'block';
  prefillLogin();
}

// Есть ли вообще сохранённый вход. Смотрим в хранилище напрямую: если ключ
// есть, а сессию получить не удалось (связь, зависший замок supabase-js), это
// «не смогли проверить», а не «пользователь не входил».
function hasStoredSession() {
  try {
    for(let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if(k && k.startsWith('sb-') && k.endsWith('-auth-token') && k !== 'sb-auth-only-temp') return true;
    }
  } catch(e) {}
  return false;
}

async function bootApp() {
  let session = null;
  try {
    // getSession в редких случаях зависает (внутренний замок supabase-js) —
    // не даём заставке висеть вечно
    const res = await Promise.race([
      sb.auth.getSession(),
      new Promise(r => setTimeout(() => r({ data: {}, timedOut: true }), 8000)),
    ]);
    session = res && res.data ? res.data.session : null;
    if(res && res.timedOut && hasStoredSession()) { showProfileNetworkError(); return; }
  } catch(e) {
    if(hasStoredSession()) { showProfileNetworkError(); return; }
    showLoginScreen(); return;
  }

  if(!session) { showLoginScreen(); return; }

  currentUser = session.user;
  const res = await loadProfile();
  if(res && res.ok) { hideSplash(); showApp(); return; }
  if(res && res.reason === 'network') { showProfileNetworkError(); return; }
  showLoginScreen();   // аккаунт действительно не найден — loadProfile уже разлогинил
}

bootApp();

// ===== Service worker =====
// Оболочка отдаётся из кеша сразу, обновление приезжает через смену версии в
// sw.js (см. комментарий там). Страницу сами НЕ перезагружаем: перезагрузка
// может прийтись на момент, когда открыта камера для отметки прихода. Вместо
// этого показываем внизу полоску «доступна новая версия» — момент выбирает
// человек (js/update.js).
if('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      if(typeof watchForUpdates === 'function') watchForUpdates(reg);
    } catch(e) {}
  });
}
