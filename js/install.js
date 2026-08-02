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
  // iPadOS с 13-й версии представляется Macintosh — отличаем по тач-экрану
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
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

function renderInstallCard() {
  const el = document.getElementById('install-app-card');
  if(!el) return;
  if(!canInstallApp()) { el.innerHTML = ''; return; }
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

  // Из встроенного браузера Telegram/Instagram не поможет никакая инструкция,
  // пока ссылку не открыли в настоящем браузере — говорим об этом первым делом.
  const inApp = isInAppBrowser()
    ? `<div style="background:rgba(212,175,55,0.12);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:1.6;color:var(--gold-light)">${t('install.help.inapp')}</div>`
    : '';

  document.getElementById('install-help-steps').innerHTML = inApp
    + `<ol style="margin:0 0 0 18px;padding:0;line-height:1.8;font-size:13px;color:var(--text-secondary)">`
    + steps.map((s) => `<li>${s}</li>`).join('')
    + `</ol>`;
  openModal('modal-install-help');
}
