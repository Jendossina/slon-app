// ===== Установка приложения иконкой на главный экран (PWA) =====
// Android/Chrome сам предлагает установку событием beforeinstallprompt — мы его
// перехватываем, прячем и вызываем уже своей кнопкой в приложении.
// iOS/Safari программной установки не поддерживает вообще (нет такого API),
// поэтому там кнопка открывает короткую инструкцию «Поделиться → На экран "Домой"».

let _installPrompt = null;

// Приложение уже открыто с иконки (standalone) — предлагать установку незачем.
function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true; // iOS Safari
}

function isIOSDevice() {
  const ua = navigator.userAgent || '';
  // На Android с включённой «версией для ПК» браузер подменяет User-Agent на
  // десктопный, и проверка «Macintosh + тач-экран» принимала Redmi за iPad —
  // человеку показывали инструкцию для айфона. Поэтому сначала отсекаем всё,
  // что заведомо не Apple:
  // 1) userAgentData есть только в Chromium, а Chromium на iOS не существует —
  //    там любой браузер работает на WebKit, и этого свойства у него нет;
  // 2) прямое упоминание Android в UA.
  if(navigator.userAgentData) return false;
  if(/Android/i.test(ua)) return false;
  // iPadOS с 13-й версии представляется Macintosh — отличаем по тач-экрану
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Браузер выдаёт себя за настольный («версия для ПК» в меню). В этом режиме
// Chrome не предлагает установку вообще и прячет пункт меню — самая частая
// причина «нет кнопки добавить на экран» на Android.
function isDesktopModeOnMobile() {
  const ua = navigator.userAgent || '';
  if(/Mobile/i.test(ua)) return false;                       // обычный мобильный режим
  if(navigator.userAgentData && navigator.userAgentData.mobile) return true;
  // Тач-экран есть, а браузер называет себя настольным — значит, режим ПК
  return navigator.maxTouchPoints > 1 && /Macintosh|Windows NT|X11|Linux x86_64/i.test(ua);
}

// Встроенный браузер другого приложения (Telegram, Instagram, VK...). Оттуда
// иконку на главный экран не добавить вообще ничем — сначала надо открыть
// ссылку в обычном браузере. Это самая частая причина «кнопка не работает».
function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /Telegram|Instagram|FBAN|FBAV|VKAndroidApp|OKApp|Line\/|MicroMessenger/i.test(ua);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _installPrompt = e;
  renderInstallCard();
});

window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  renderInstallCard();
  showToast(t('install.done'));
});

// Карточку показываем всем, кто открыл приложение не с иконки. Раньше она
// требовала beforeinstallprompt, и сотрудник, у которого браузер это событие
// не шлёт (Firefox, Яндекс, встроенный браузер Telegram, а также Chrome, если
// он считает приложение уже установленным), не видел вообще ничего. Установка
// руками через меню браузера возможна почти везде — на неё и уводим.
// Открыто внутри Android-приложения (оболочка Capacitor, см. docs/android-apk.md).
// Там предлагать установку абсурдно — оно уже установлено. Признак: Capacitor
// внедряет в страницу свой мост window.Capacitor, даже когда грузит сайт по адресу.
function isNativeShell() {
  return !!window.Capacitor;
}

// Предложение установки можно отложить. Раньше карточка висела на главной
// каждый день у всех, кто открывает приложение из браузера, и вместе с
// остальными карточками отжимала вниз то, ради чего человек зашёл. Кто ставить
// не собирается — убирает её на месяц одной кнопкой.
const INSTALL_SNOOZE_KEY = 'installCardSnoozedUntil';
const INSTALL_SNOOZE_DAYS = 30;

function installCardSnoozed() {
  try {
    const until = Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || 0);
    return until > Date.now();
  } catch(e) { return false; }
}

function snoozeInstallCard() {
  try { localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now() + INSTALL_SNOOZE_DAYS*24*60*60*1000)); } catch(e) {}
  renderInstallCard();
}

function canInstallApp() {
  if(isNativeShell()) return false;
  if(installCardSnoozed()) return false;
  return !isStandaloneApp();
}

// Приложение уже стоит на телефоне, но открыто из браузера. Chrome в этом случае
// не присылает beforeinstallprompt и убирает «Установить» из меню — со стороны
// выглядит как «кнопки нет нигде». Спрашиваем систему напрямую: в манифесте
// приложение указано в related_applications как webapp, поэтому браузер отвечает,
// установлено ли оно. Работает только в Chromium — в остальных просто false.
// Состояние service worker для диагностики. Без него Chrome не считает сайт
// приложением, а ошибка регистрации в index.html глушится молча — по этой
// строке видно, дошло ли дело до него вообще.
let _swState = 'none';
if(navigator.serviceWorker) {
  navigator.serviceWorker.getRegistration()
    .then(r => { _swState = !r ? 'none' : (navigator.serviceWorker.controller ? 'ok' : 'noctl'); })
    .catch(() => { _swState = 'err'; });
}

let _alreadyInstalled = false;
async function checkAlreadyInstalled() {
  try {
    if(!navigator.getInstalledRelatedApps) return;
    const apps = await navigator.getInstalledRelatedApps();
    _alreadyInstalled = Array.isArray(apps) && apps.length > 0;
    if(_alreadyInstalled) renderInstallCard();
  } catch(e) { /* не поддерживается — остаёмся с обычной инструкцией */ }
}
checkAlreadyInstalled();

function renderInstallCard() {
  const el = document.getElementById('install-app-card');
  if(!el) return;
  if(!canInstallApp()) { el.innerHTML = ''; return; }
  // Уже установлено — не предлагаем ставить заново, а подсказываем, что искать
  if(_alreadyInstalled) {
    el.innerHTML = `<div class="card" style="margin-bottom:12px;display:flex;align-items:center;gap:12px">
      <img src="/icon-192.png" alt="" style="width:40px;height:40px;border-radius:10px;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary)">${t('install.installedTitle')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${t('install.installedDesc')}</div>
      </div>
      <button onclick="snoozeInstallCard()" aria-label="${t('install.later')}" style="background:none;border:none;color:var(--text-muted);font-size:20px;line-height:1;padding:4px 2px;cursor:pointer;flex:0 0 auto">×</button>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="card" style="background:linear-gradient(135deg,#2a2620,#1a1a1a);border:none;color:#fff;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:12px">
      <img src="/icon-192.png" alt="" style="width:44px;height:44px;border-radius:12px;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:var(--gold-light)">${t('install.title')}</div>
        <div style="font-size:12px;opacity:0.75;margin-top:2px">${t('install.desc')}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button onclick="installApp()" style="flex:1;background:var(--gold);color:#1a1a1a;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:600;cursor:pointer">${t('install.btn')}</button>
      <button onclick="snoozeInstallCard()" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:10px;padding:11px 14px;font-size:14px;cursor:pointer;flex:0 0 auto">${t('install.later')}</button>
    </div>
  </div>`;
}

// ===== Инструкция для iPhone: картинкой, а не списком =====
// Установить приложение на iOS кнопкой нельзя вообще: Safari не даёт вебу
// никакого API (beforeinstallprompt есть только в Chromium, а на iOS все
// браузеры работают на WebKit). Единственный путь — «Поделиться» → «На экран
// "Домой"», и весь вопрос в том, найдёт ли человек эту кнопку. Текстом
// «нажми Поделиться» её ищут глазами по всему экрану, поэтому рисуем панель
// Safari со стрелкой ровно в то место, куда жать.

// Значок «Поделиться» из iOS — квадрат со стрелкой вверх. Рисуем сами:
// картинку в приложение не тащим, иконка должна попадать в цвет темы.
const IOS_SHARE_GLYPH = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5V3.5"/><path d="M8.5 7 12 3.5 15.5 7"/><path d="M7.5 11H6a2 2 0 0 0-2 2v6.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V13a2 2 0 0 0-2-2h-1.5"/></svg>`;

// Соседи «Поделиться» по панели — закладки и вкладки. Их тоже рисуем линиями, а
// не эмодзи: эмодзи на части устройств выпадает пустым квадратом, и нарисованная
// панель сразу перестаёт быть похожей на настоящую.
const IOS_BOOKS_GLYPH = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>`;
const IOS_TABS_GLYPH  = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="12" height="12" rx="2"/><path d="M8 4.5h11A1.5 1.5 0 0 1 20.5 6v11"/></svg>`;

// На iPad панель Safari сверху, а не снизу — стрелка вниз там врала бы.
function isIPadDevice() {
  const ua = navigator.userAgent || '';
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Chrome, Яндекс и прочие на iOS — это тот же WebKit в другой обёртке. Добавить
// иконку из них можно (iOS 16.4+), но «Поделиться» лежит не на виду, а в меню,
// поэтому проще увести человека в Safari.
function iosBrowserName() {
  const ua = navigator.userAgent || '';
  if(/CriOS/.test(ua))     return 'Chrome';
  if(/YaBrowser|YaApp/.test(ua)) return 'Яндекс';
  if(/FxiOS/.test(ua))     return 'Firefox';
  if(/EdgiOS/.test(ua))    return 'Edge';
  if(/OPT\//.test(ua))     return 'Opera';
  return null;                                   // Safari
}

function iosInstallStepsHTML() {
  const ipad  = isIPadDevice();
  const other = iosBrowserName();

  const step = (n, text, extra = '') => `
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <div style="flex:0 0 22px;height:22px;border-radius:50%;background:var(--gold);color:#1a1a1a;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">${n}</div>
      <div style="flex:1;min-width:0;font-size:13px;line-height:1.6;color:var(--text-secondary)">${text}${extra}</div>
    </div>`;

  // Панель Safari: пять кнопок, «Поделиться» — средняя. Подсвечиваем её и
  // ставим над ней стрелку, а саму панель прижимаем к низу блока, чтобы она
  // читалась как нижний край экрана.
  const bar = `
    <div style="margin-top:10px;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--surface-2)">
      <div style="display:grid;grid-template-columns:repeat(5,1fr);justify-items:center;font-size:15px;color:var(--text-muted);padding:6px 0 0">
        <span></span><span></span>
        <span style="color:var(--gold);animation:install-point 1.2s ease-in-out infinite">▼</span>
        <span></span><span></span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);justify-items:center;align-items:center;padding:8px 0 10px;color:var(--text-muted);font-size:15px">
        <span>‹</span>
        <span>›</span>
        <span style="color:var(--gold);background:rgba(201,164,104,0.16);border:1px solid var(--gold);border-radius:9px;padding:5px 12px;display:flex;align-items:center">${IOS_SHARE_GLYPH}</span>
        <span style="display:flex">${IOS_BOOKS_GLYPH}</span>
        <span style="display:flex">${IOS_TABS_GLYPH}</span>
      </div>
    </div>`;

  // Строка из меню «Поделиться» — та самая, которую надо найти, пролистав вниз
  const row = `
    <div style="margin-top:10px;border:1px solid var(--gold);background:rgba(201,164,104,0.12);border-radius:12px;padding:11px 12px;display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-primary)">
      <span style="flex:1;min-width:0">${t('install.ios.addRow')}</span>
      <span style="color:var(--gold);font-size:18px;line-height:1">⊞</span>
    </div>`;

  const notice = (text) => `<div style="background:rgba(212,175,55,0.12);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:1.6;color:var(--gold-light)">${text}</div>`;

  return (other ? notice(t('install.ios.otherBrowser', { browser: other })) : '')
    + step(1, ipad ? t('install.ios.step1ipad') : t('install.ios.step1'), ipad ? '' : bar)
    + step(2, t('install.ios.step2'), row)
    + step(3, t('install.ios.step3'));
}

async function installApp() {
  if(_installPrompt) {
    _installPrompt.prompt();
    const { outcome } = await _installPrompt.userChoice;
    _installPrompt = null; // повторно один и тот же prompt использовать нельзя
    if(outcome !== 'accepted') showToast(t('install.cancelled'));
    renderInstallCard();
    return;
  }
  // Своего диалога нет (iOS вообще без такого API, часть Android-браузеров тоже
  // не даёт prompt) — показываем, куда нажимать руками.
  const ios = isIOSDevice();

  const notice = (text) => `<div style="background:rgba(212,175,55,0.12);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:1.6;color:var(--gold-light)">${text}</div>`;

  // Из встроенного браузера Telegram/Instagram не поможет никакая инструкция,
  // пока ссылку не открыли в настоящем браузере — говорим об этом первым делом.
  let head = isInAppBrowser() ? notice(t('install.help.inapp')) : '';
  // «Версия для ПК» прячет установку в самом браузере — сначала её выключить
  if(isDesktopModeOnMobile()) head += notice(t('install.help.desktopMode'));
  // Уже стоит на телефоне: Chrome тогда молчит и прячет пункт меню
  if(_alreadyInstalled) head += notice(t('install.help.installed'));
  // На первом заходе service worker ещё не управляет страницей, и до перезагрузки
  // браузер не считает сайт приложением — отсюда «установку не предлагает».
  // К iOS это не относится: там иконка добавляется и без service worker.
  else if(!ios && !_installPrompt && navigator.serviceWorker && !navigator.serviceWorker.controller) {
    head += notice(t('install.help.reload'));
  }

  const body = ios
    ? iosInstallStepsHTML()
    : `<ol style="margin:0 0 0 18px;padding:0;line-height:1.8;font-size:13px;color:var(--text-secondary)">`
      + [t('install.help.android1'), t('install.help.android2'), t('install.help.android3')]
          .map((s) => `<li>${s}</li>`).join('')
      + `</ol>`;

  document.getElementById('install-help-steps').innerHTML = head + body + installDiagnosticsHTML();
  openModal('modal-install-help');
}

// Если инструкция не помогла, сотрудник присылает скриншот этого блока — по нему
// видно, каким браузером он открыл и почему установка недоступна. Тот же приём,
// что и в диагностике связи на экране входа.
function installDiagnosticsHTML() {
  const ua = navigator.userAgent || '';
  const rows = [
    [t('install.diag.prompt'), _installPrompt ? t('install.diag.yes') : t('install.diag.no')],
    [t('install.diag.mode'), isDesktopModeOnMobile() ? t('install.diag.desktop') : t('install.diag.mobile')],
    [t('install.diag.system'), isIOSDevice() ? 'iOS' : (/Android/i.test(ua) || navigator.userAgentData ? 'Android' : '—')],
    [t('install.diag.sw'), t('install.diag.sw.' + _swState)],
    [t('install.diag.installed'), _alreadyInstalled ? t('install.diag.yes') : t('install.diag.no')],
  ];
  return `<details style="margin-top:14px">
    <summary style="font-size:12px;color:var(--text-muted);cursor:pointer">${t('install.diag.title')}</summary>
    <div style="margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.7">
      ${rows.map(([k, v]) => `<div>${k}: <b>${escapeHtml(v)}</b></div>`).join('')}
      <div style="margin-top:6px;word-break:break-all;color:var(--text-muted);font-size:11px">${escapeHtml(ua)}</div>
    </div>
  </details>`;
}
