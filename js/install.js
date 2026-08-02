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

// Кнопку показываем, только если установка реально возможна: либо браузер дал
// prompt, либо это iOS (там ставится вручную по инструкции).
function canInstallApp() {
  if(isStandaloneApp()) return false;
  return !!_installPrompt || isIOSDevice();
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
  // iOS: своего диалога нет — показываем, куда нажимать
  document.getElementById('install-help-steps').innerHTML = isIOSDevice()
    ? `<ol style="margin:0 0 0 18px;padding:0;line-height:1.8;font-size:13px;color:var(--text-secondary)">
         <li>${t('install.help.ios1')}</li>
         <li>${t('install.help.ios2')}</li>
         <li>${t('install.help.ios3')}</li>
       </ol>`
    : `<div style="font-size:13px;color:var(--text-secondary);line-height:1.6">${t('install.help.other')}</div>`;
  openModal('modal-install-help');
}
