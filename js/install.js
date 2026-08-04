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
function canInstallApp() {
  return !isStandaloneApp();
}

// Приложение уже стоит на телефоне, но открыто из браузера. Chrome в этом случае
// не присылает beforeinstallprompt и убирает «Установить» из меню — со стороны
// выглядит как «кнопки нет нигде». Спрашиваем систему напрямую: в манифесте
// приложение указано в related_applications как webapp, поэтому браузер отвечает,
// установлено ли оно. Работает только в Chromium — в остальных просто false.
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
    <button onclick="installApp()" style="width:100%;margin-top:12px;background:var(--gold);color:#1a1a1a;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:600;cursor:pointer">${t('install.btn')}</button>
  </div>`;
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
  const steps = isIOSDevice()
    ? [t('install.help.ios1'), t('install.help.ios2'), t('install.help.ios3')]
    : [t('install.help.android1'), t('install.help.android2'), t('install.help.android3')];

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
  else if(!_installPrompt && navigator.serviceWorker && !navigator.serviceWorker.controller) {
    head += notice(t('install.help.reload'));
  }

  document.getElementById('install-help-steps').innerHTML = head
    + `<ol style="margin:0 0 0 18px;padding:0;line-height:1.8;font-size:13px;color:var(--text-secondary)">`
    + steps.map((s) => `<li>${s}</li>`).join('')
    + `</ol>`
    + installDiagnosticsHTML();
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
  ];
  return `<details style="margin-top:14px">
    <summary style="font-size:12px;color:var(--text-muted);cursor:pointer">${t('install.diag.title')}</summary>
    <div style="margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.7">
      ${rows.map(([k, v]) => `<div>${k}: <b>${escapeHtml(v)}</b></div>`).join('')}
      <div style="margin-top:6px;word-break:break-all;color:var(--text-muted);font-size:11px">${escapeHtml(ua)}</div>
    </div>
  </details>`;
}
