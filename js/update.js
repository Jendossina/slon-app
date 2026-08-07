// ============ ОБНОВЛЕНИЕ ПРИЛОЖЕНИЯ ============
// Две разные вещи, которые сотрудники обычно путают.
//
// 1. Содержимое приложения (экраны, кнопки, исправления) живёт на сайте и
//    приезжает само: service worker при каждом запуске спрашивает у сервера
//    новую версию, ставит её и применяет со следующего открытия. Кнопка
//    «Обновить» здесь просто не даёт ждать этого следующего раза — проверяет
//    и применяет сразу.
//
// 2. Сама оболочка (APK) обновляется только переустановкой файла: так устроен
//    Android, если приложение не из Play Маркета. Пересобирать её приходится
//    редко — когда меняются разрешения, иконка или адрес сайта. Здесь мы
//    показываем, есть ли новая сборка, и даём прямую ссылку.

const APK_RELEASES_API = 'https://api.github.com/repos/Jendossina/slon-app/releases/latest';
const APK_CHECK_TTL = 6 * 60 * 60 * 1000;   // проверяем не чаще раза в 6 часов

// Версия содержимого = имя активного кеша оболочки (slon-shell-vNN)
async function appShellVersion() {
  try {
    const keys = await caches.keys();
    const shell = keys.find(k => k.startsWith('slon-shell-'));
    return shell ? shell.replace('slon-shell-', '') : '';
  } catch(e) { return ''; }
}

// Версия установленного APK: оболочка дописывает её в User-Agent (SlonApp/1.2.7).
// Старые сборки этого не умеют — тогда версия неизвестна.
function nativeAppVersion() {
  const m = (navigator.userAgent || '').match(/SlonApp\/([\d.]+)/);
  return m ? m[1] : '';
}

// Обновить содержимое сейчас: спросить сервер о новой версии, дождаться её
// установки и перезагрузить страницу.
async function forceWebUpdate() {
  const btn = document.getElementById('update-web-btn');
  const status = document.getElementById('update-status');
  const say = txt => { if(status) status.textContent = txt; };
  if(btn) { btn.disabled = true; btn.textContent = t('upd.checking'); }
  say('');
  try {
    if(!('serviceWorker' in navigator)) { location.reload(); return; }
    const reg = await navigator.serviceWorker.getRegistration();
    if(!reg) { location.reload(); return; }

    await reg.update();                       // перезапрашиваем sw.js у сервера
    const worker = reg.installing || reg.waiting;
    if(!worker) {
      // сервер отдал тот же файл — значит, у человека уже последняя версия
      if(btn) { btn.disabled = false; btn.textContent = t('upd.updateBtn'); }
      say(t('upd.alreadyLatest'));
      return;
    }

    say(t('upd.installing'));
    // Ждём, пока новая версия установится. Дольше 30 секунд не держим: на
    // плохой связи лучше сказать «попробуйте позже», чем крутить бесконечно.
    const done = await Promise.race([
      new Promise(res => {
        const check = () => { if(worker.state === 'activated' || worker.state === 'redundant') res(true); };
        worker.addEventListener('statechange', check);
        check();
      }),
      new Promise(res => setTimeout(() => res(false), 30000)),
    ]);
    if(!done) {
      if(btn) { btn.disabled = false; btn.textContent = t('upd.updateBtn'); }
      say(t('upd.slowNet'));
      return;
    }
    say(t('upd.applying'));
    location.reload();
  } catch(e) {
    console.error('forceWebUpdate', e);
    if(btn) { btn.disabled = false; btn.textContent = t('upd.updateBtn'); }
    say(t('upd.failed'));
  }
}

// Последняя выложенная сборка APK. Ответ кладём в память телефона на 6 часов,
// чтобы не дёргать GitHub при каждом заходе в личный кабинет.
async function latestApkRelease() {
  try {
    const cached = JSON.parse(localStorage.getItem('slon-apk-release') || 'null');
    if(cached && Date.now() - cached.at < APK_CHECK_TTL) return cached.rel;
    const r = await fetch(APK_RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if(!r.ok) return null;
    const j = await r.json();
    const asset = (j.assets || []).find(a => (a.name || '').endsWith('.apk'));
    if(!asset) return null;
    // Тег вида apk-v1.2-7 → версия 1.2.7, как её сообщает оболочка в User-Agent
    const m = String(j.tag_name || '').match(/apk-v([\d.]+)-(\d+)/);
    const rel = { version: m ? `${m[1]}.${m[2]}` : '', name: j.name || '', url: asset.browser_download_url };
    localStorage.setItem('slon-apk-release', JSON.stringify({ at: Date.now(), rel }));
    return rel;
  } catch(e) { return null; }
}

// Карточка в личном кабинете
async function renderUpdateCard() {
  const el = document.getElementById('update-card');
  if(!el) return;
  const shell = await appShellVersion();
  const native = nativeAppVersion();
  const inApp = typeof isNativeShell === 'function' ? isNativeShell() : !!window.Capacitor;

  let apkBlock = '';
  if(inApp) {
    const rel = await latestApkRelease();
    if(rel && rel.version && native && rel.version !== native) {
      apkBlock = `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <div style="font-size:13px;font-weight:600;color:#8A5B12">${t('upd.apkNew', { v: rel.version })}</div>
        <div style="font-size:12px;color:var(--text-muted);margin:4px 0 8px;line-height:1.5">${t('upd.apkDesc')}</div>
        <a href="${escapeHtml(rel.url)}" class="btn btn-primary" style="display:block;text-align:center;text-decoration:none">${t('upd.apkBtn')}</a>
      </div>`;
    } else if(rel && rel.version && !native) {
      // старая сборка не сообщает свою версию — сравнить не с чем, просто даём ссылку
      apkBlock = `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;line-height:1.5">${t('upd.apkUnknown', { v: rel.version })}</div>
        <a href="${escapeHtml(rel.url)}" class="btn btn-secondary" style="display:block;text-align:center;text-decoration:none">${t('upd.apkBtn')}</a>
      </div>`;
    }
  }

  el.innerHTML = `<div class="section-label">${t('upd.title')}</div>
    <div class="card">
      <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:10px">${t('upd.desc')}</div>
      <button class="btn btn-secondary" id="update-web-btn" onclick="forceWebUpdate()">${t('upd.updateBtn')}</button>
      <div id="update-status" style="font-size:12px;color:var(--text-muted);margin-top:8px;text-align:center;line-height:1.4"></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:10px;text-align:center">
        ${t('upd.shellVersion', { v: shell || '—' })}${inApp && native ? ' · ' + t('upd.appVersion', { v: native }) : ''}
      </div>
      ${apkBlock}
    </div>`;
}
