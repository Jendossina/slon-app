const SUPABASE_URL = 'https://omeomdkurvtvirhfkffu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_h7pdCQTKnGIlIR9SaswShw_ur8eauw6';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Ставки за смену по должностям — менеджер/управляющий выбирает кнопкой в карточке сотрудника.
// Для должностей с аттестацией — два варианта: до (200 000) и после (250 000) сдачи.
const ATTESTATION_ROLES = ['Официант', 'Бармен', 'Кальянный мастер']; // ставка зависит от аттестации
const ATTESTATION_BASE = 200000;   // до сдачи
const ATTESTATION_PASSED = 250000; // после сдачи
const SALARY_PRESETS = {
  'Официант':                     [{ label: 'Не сдал меню', amount: 200000 }, { label: 'Сдал меню', amount: 250000 }],
  'Бармен':                       [{ label: 'До аттестации', amount: 200000 }, { label: 'После аттестации', amount: 250000 }],
  'Старший бармен':               [{ label: 'Ставка', amount: 300000 }],
  'Бар менеджер':                 [{ label: 'Ставка', amount: 350000 }],
  'Кальянный мастер':             [{ label: 'До аттестации', amount: 200000 }, { label: 'После аттестации', amount: 250000 }],
  'Старший кальянный мастер':     [{ label: 'Ставка', amount: 300000 }],
  'Шеф кальянной станции':        [{ label: 'Ставка', amount: 400000 }],
  'Повар':                        [{ label: 'Ставка', amount: 350000 }],
  'Су-шеф':                       [{ label: 'Ставка', amount: 400000 }],
};

// Оплата за конкретную смену с учётом должности, аттестации, вида смены и «один в графике».
// salary — базовая ставка сотрудника (стандартная 12-часовая смена). «Сдал аттестацию»
// выводим из ставки: ≥250 000 = сдал. Возвращает { amount, note }.
function computeShiftPay(role, salary, shiftStart, isAlone) {
  salary = Number(salary) || 0;
  const passed = salary >= ATTESTATION_PASSED;
  // Официанты: вечерняя смена с 18:00 короче (9 ч) и считается по часам — фикс. суммы
  if(role === 'Официант' && shiftStart === '18:00') {
    return { amount: passed ? 200000 : 150000, note: 'смена 18:00, по часам' };
  }
  // Бармен один в графике на день — +100 000
  if(role === 'Бармен' && isAlone) {
    return { amount: salary + 100000, note: 'один в баре, +100 000' };
  }
  return { amount: salary, note: '' };
}

// Единый вид секции цеха для списков сотрудников (HR и админ-панель)
const DEPT_ICONS = { 'Менеджеры':'📋', 'Официанты':'🍽️', 'Бармены':'🍹', 'Кальянные мастера':'💨', 'Повара':'👨‍🍳', 'Техперсонал':'🔧', 'Без отдела':'👥' };
function deptSection(dept, count, innerHtml) {
  return `<div style="margin-bottom:14px;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface);box-shadow:0 1px 3px rgba(0,0,0,0.05)">
    <div style="display:flex;align-items:center;gap:8px;padding:11px 14px;background:linear-gradient(135deg,var(--surface-2),var(--surface));border-bottom:1px solid var(--border)">
      <span style="font-size:17px">${DEPT_ICONS[dept]||'👥'}</span>
      <span style="font-size:13px;font-weight:700;color:var(--text-primary);text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(dept)}</span>
      <span style="margin-left:auto;font-size:12px;font-weight:700;color:#fff;background:var(--gold-dark);border-radius:20px;padding:2px 10px;min-width:22px;text-align:center">${count}</span>
    </div>
    <div style="padding:0 14px">${innerHtml}</div>
  </div>`;
}

// Отдельный клиент только для auth.signUp() при создании сотрудника из HR-панели.
// sb.auth.signUp() на ОСНОВНОМ клиенте молча подменяет активную сессию браузера
// на сессию только что созданного пользователя — из-за этого следующий запрос
// (создание профиля) уходит уже не от имени админа, а от имени нового сотрудника,
// у которого ещё нет профиля, и RLS его тихо блокирует. Одного persistSession:false
// недостаточно — без отдельного storageKey supabase-js всё равно синхронизирует
// состояние сессии между клиентами через общий ключ. Даём отдельный storageKey,
// чтобы sbAuthOnly был полностью независим от сессии в sb.
const sbAuthOnly = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sb-auth-only-temp' } });

// Токен бота живёт ТОЛЬКО в секрете серверной функции send-telegram — на клиенте его быть не должно.
const TG_ADMIN_ID = '5872954642';

async function sendTelegram(chatId, text) {
  try {
    const body = JSON.stringify({ chat_id: String(chatId), text: String(text) });
    await fetch('https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/send-telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY
      },
      body
    });
  } catch(e) { console.error('TG error:', e); }
}

async function notifyAdmin(text) {
  await sendTelegram(TG_ADMIN_ID, text);
}

// Хочет ли получатель уведомления этого типа. Отсутствие ключа или true = включено; false = выкл.
// Настройки есть только у управляющих/владельца; у остальных всегда пусто = всё включено.
function _wantsNotif(prefs, type) {
  if(!type) return true;
  return !prefs || prefs[type] !== false;
}

// Уведомить всех управляющих (роль admin) + владельца — верх иерархии. Учитывает их настройки.
async function notifyAdminsAll(text, type) {
  const sent = new Set();
  let ownerCovered = false;
  try {
    const { data } = await sb.from('profiles').select('user_id,telegram_id,notify_prefs').eq('role','admin');
    for(const p of (data||[])) {
      if(!p.telegram_id || sent.has(String(p.telegram_id)) || p.user_id === currentUser?.id) continue;
      if(String(p.telegram_id) === String(TG_ADMIN_ID)) ownerCovered = true;
      if(!_wantsNotif(p.notify_prefs, type)) continue;
      sent.add(String(p.telegram_id));
      await sendTelegram(p.telegram_id, text);
    }
  } catch(e) { console.error('notifyAdminsAll', e); }
  // Страховка: если чат владельца не привязан ни к одному профилю-админу — шлём напрямую
  if(!ownerCovered && TG_ADMIN_ID && !sent.has(String(TG_ADMIN_ID))) {
    try { await sendTelegram(TG_ADMIN_ID, text); } catch(e) {}
  }
}

// Экранирует спецсимволы, чтобы они не ломали HTML-разметку в Telegram-сообщении
function tgEscape(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function notifyEmployee(userId, text, type) {
  const { data } = await sb.from('profiles').select('telegram_id,notify_prefs').eq('user_id', userId).single();
  if(data?.telegram_id && _wantsNotif(data.notify_prefs, type)) await sendTelegram(data.telegram_id, text);
}

// Уведомить старших по цеху — всех, кто выше по должности в том же отделе (вверх по иерархии).
// aboveLevel — порог уровня должности; уведомляем тех, у кого уровень строго выше.
async function notifyDeptSeniors(department, aboveLevel, text, type) {
  try {
    if(!department) return;
    const levels = (typeof JOB_TITLE_LEVEL !== 'undefined') ? JOB_TITLE_LEVEL : {};
    const { data: emps } = await sb.from('employees').select('id,role').eq('department', department).neq('status','Уволен');
    const seniorIds = (emps||[]).filter(e => (levels[e.role]||0) > (aboveLevel||0)).map(e=>e.id);
    if(seniorIds.length === 0) return;
    const { data: profs } = await sb.from('profiles').select('user_id,telegram_id,notify_prefs').in('employee_id', seniorIds);
    for(const p of (profs||[])) {
      if(p.user_id && p.user_id !== currentUser?.id && p.telegram_id && _wantsNotif(p.notify_prefs, type)) {
        await sendTelegram(p.telegram_id, text);
      }
    }
  } catch(e) { console.error('notifyDeptSeniors', e); }
}

async function saveTelegramId() {
  const tgId = document.getElementById('tg-id-input').value.trim();
  if(!tgId || !/^\d+$/.test(tgId)) return showToast('Введите корректный числовой ID');
  try {
    const { error: rpcErr } = await sb.rpc('update_own_telegram_id', { new_telegram_id: tgId });
    if(rpcErr) throw rpcErr;
    currentProfile.telegram_id = tgId;
    showToast('✅ Telegram подключен!');
    await sendTelegram(tgId, '🐘 <b>Отлично!</b>\n\nТеперь ты будешь получать уведомления о новых задачах прямо здесь.');
    loadHome();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

let currentUser = null;
let currentProfile = null;
let reportFile = null;

// ФИЛИАЛЫ
const FILIALS = [
  { id: 'istikbol', name: 'Истикбол' },
  { id: 'chekhov', name: 'Чехов' }
];
let currentFilial = localStorage.getItem('slon-filial') || FILIALS[0].id;

function getFilialName(id) { return FILIALS.find(f=>f.id===id)?.name || id; }

// ===== ПИЛОТ: 2-недельный тест только на одном филиале =====
// После пилота просто поставь PILOT_MODE = false — переключатель и доступ
// к обоим филиалам вернутся всем как раньше. Админ/владелец видит оба
// филиала всегда, ограничение касается только рядовых ролей.
const PILOT_MODE = true;
const PILOT_FILIAL = 'chekhov';

// Сжатие изображения перед загрузкой (экономит место в облаке и ускоряет отправку).
// Видео не трогаем — их сжать в браузере надёжно нельзя. Возвращает File.
async function compressImage(file, maxSide = 1280, quality = 0.7) {
  // Только изображения; видео и прочее возвращаем как есть
  if(!file || !file.type || !file.type.startsWith('image/')) return file;
  // gif не трогаем (потеряется анимация)
  if(file.type === 'image/gif') return file;
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    let { width, height } = img;
    if(width > maxSide || height > maxSide) {
      if(width >= height) { height = Math.round(height * maxSide / width); width = maxSide; }
      else { width = Math.round(width * maxSide / height); height = maxSide; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if(!blob) return file;
    // Если сжатие не дало выигрыша — оставляем оригинал
    if(blob.size >= file.size) return file;
    const newName = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch(e) {
    console.warn('compressImage failed, using original', e);
    return file;
  }
}

// ===== РОЛИ И ПРАВА =====
// employee — сотрудник (своё), manager — менеджер (всё кроме финансов и админки, но зарплаты видит),
// admin — управляющий (всё), boss — владелец (видит всё как admin, но только чтение)
function currentRole() { return currentProfile?.role || 'employee'; }
function isBoss() { return currentRole() === 'boss'; }
function isAdmin() { return currentRole() === 'admin'; }
function isManager() { return currentRole() === 'manager'; }
// Может ли реально что-то менять (BOSS — нет, только смотрит)
function canEditData() { const r = currentRole(); return r === 'admin' || r === 'manager'; }
// Видит финансы (доходы/расходы): менеджер, управляющий, владелец (дашборд — отдельно, без менеджера)
function canSeeFinance() { const r = currentRole(); return r === 'admin' || r === 'manager' || r === 'boss'; }
// Видит зарплаты: менеджер, управляющий, владелец
function canSeeSalaryRole() { const r = currentRole(); return r === 'manager' || r === 'admin' || r === 'boss'; }
// Видит дашборд/финансовую сводку: управляющий и владелец (менеджер — нет)
function canSeeAdminPanel() { const r = currentRole(); return r === 'admin' || r === 'boss'; }
// Может открыть админ-панель (Сотрудники/Задачи/История/Чек-листы): + менеджер.
// Менеджер = как управляющий, но без финансов и дашборда.
function canOpenAdminPanel() { const r = currentRole(); return r === 'admin' || r === 'manager' || r === 'boss'; }
// Полные права над сотрудником (удаление, смена пароля, смена роли) — только управляющий
function canManageStaffFully() { return currentRole() === 'admin'; }

function renderFilialSwitcher() {
  const el = document.getElementById('filial-switcher');
  if(!el) return;
  if(PILOT_MODE && !canSeeAdminPanel()) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = FILIALS.map(f=>`<button class="filial-tab ${f.id===currentFilial?'active':''}" onclick="switchFilial('${f.id}')">${f.name}</button>`).join('');
}

function switchFilial(id) {
  if(id === currentFilial) return;
  currentFilial = id;
  localStorage.setItem('slon-filial', id);
  renderFilialSwitcher();
  showToast('📍 Филиал: ' + getFilialName(id));
  // Обновим текущий экран под новый филиал
  if(document.getElementById('screen-home')?.classList.contains('active') && typeof loadHome === 'function') loadHome();
  if(document.getElementById('screen-schedule')?.classList.contains('active') && typeof loadSchedule === 'function') loadSchedule();
  if(document.getElementById('screen-tasks')?.classList.contains('active') && typeof loadTasks === 'function') loadTasks();
  if(document.getElementById('screen-checklist')?.classList.contains('active') && typeof initChecklistScreen === 'function') initChecklistScreen();
  if(document.getElementById('screen-finance')?.classList.contains('active') && typeof loadFinance === 'function') loadFinance();
  if(document.getElementById('screen-hr')?.classList.contains('active') && typeof loadHR === 'function') loadHR();
  if(document.getElementById('screen-supply')?.classList.contains('active') && typeof loadSupply === 'function') loadSupply();
  if(document.getElementById('screen-dishware')?.classList.contains('active') && typeof loadDishware === 'function') loadDishware();
  if(document.getElementById('screen-crm')?.classList.contains('active') && typeof loadCRM === 'function') loadCRM();
  if(document.getElementById('screen-reviews')?.classList.contains('active') && typeof loadReviews === 'function') loadReviews();
  if(document.getElementById('screen-feed')?.classList.contains('active') && typeof loadFeed === 'function') loadFeed();
  if(document.getElementById('screen-calendar')?.classList.contains('active') && typeof loadCalendar === 'function') loadCalendar();
  if(document.getElementById('screen-admin')?.classList.contains('active')) {
    if(currentAdminTab==='tasks' && typeof loadAdminTasks === 'function') loadAdminTasks(taskFilters||{});
    if(currentAdminTab==='checklists' && typeof loadAdminChecklists === 'function') loadAdminChecklists();
  }
}

const colors = ['av-purple','av-teal','av-coral','av-amber'];
function getColor(s) { if(!s) return colors[0]; let h=0; for(let c of s) h+=c.charCodeAt(0); return colors[h%4]; }
function getInitials(n) { if(!n) return '?'; return n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }
// Имя из ФИО (сотрудников заводят как "Фамилия Имя Отчество") — берём второе слово; если слово одно, его же
function firstName(full) { const p = String(full||'').trim().split(/\s+/); return p.length>=2 ? p[1] : (p[0]||''); }
function formatNum(n) { return Number(n).toLocaleString('ru-RU'); }

// Единый формат даты: "2026-01-15" → "15 янв". Пустое/битое — как есть.
function fmtDateShort(d, opts) {
  if(!d) return '';
  try {
    const dt = new Date(d);
    if(isNaN(dt)) return d;
    return dt.toLocaleDateString('ru-RU', opts || {day:'numeric', month:'short'});
  } catch(e) { return d; }
}
function today() { return new Date().toISOString().split('T')[0]; }

// THEME
function initTheme() {
  const saved = localStorage.getItem('slon-theme');
  const theme = saved || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('slon-theme', next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  const btn = document.getElementById('theme-toggle-btn');
  if(btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
initTheme();

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2500);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Красивое подтверждение вместо нативного confirm(). Возвращает Promise<boolean>.
// opts: { title, okText, danger:false — некрасная (золотая) кнопка }
let _confirmResolve = null;
function confirmDialog(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    document.getElementById('confirm-title').textContent = opts.title || 'Подтвердите действие';
    document.getElementById('confirm-message').textContent = message || '';
    const ok = document.getElementById('confirm-ok');
    ok.textContent = opts.okText || 'Удалить';
    ok.style.background = opts.danger === false ? 'var(--gold-dark)' : '#A32D2D';
    openModal('modal-confirm');
  });
}
function _confirmClose(result) {
  closeModal('modal-confirm');
  const r = _confirmResolve; _confirmResolve = null;
  if(r) r(result);
}
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click', e=>{ if(e.target===o) o.classList.remove('open'); });
});

// Риппл-эффект от нажатия на кнопки (чисто визуальный, ни на что не влияет)
document.addEventListener('click', (e) => {
  const el = e.target.closest('.btn, .fab, .report-btn, .nav-btn, .more-menu-item');
  if(!el) return;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size/2) + 'px';
  el.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
});

async function doLogin() {
  let login = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  document.getElementById('login-error').textContent = '';
  const email = login.includes('@') ? login : login + '@slon.uz';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if(error) { document.getElementById('login-error').textContent = 'Неверный логин или пароль'; return; }
  // Запомнить логин, если стоит галочка
  const remember = document.getElementById('login-remember')?.checked;
  if(remember) localStorage.setItem('slon-remember-login', login);
  else localStorage.removeItem('slon-remember-login');
  currentUser = data.user;
  await loadProfile();
  showApp();
}

// Подставляем сохранённый логин на странице входа
function prefillLogin() {
  const saved = localStorage.getItem('slon-remember-login');
  if(saved) {
    const emailEl = document.getElementById('login-email');
    const rememberEl = document.getElementById('login-remember');
    if(emailEl) emailEl.value = saved;
    if(rememberEl) rememberEl.checked = true;
    // фокус на поле пароля, раз логин уже введён
    const passEl = document.getElementById('login-password');
    if(passEl) passEl.focus();
  }
}

// «Выйти»: если на устройстве включена биометрия — просто блокируем (сессия сохраняется,
// снова открыть по Face ID/отпечатку). Иначе — полный выход к паролю.
async function doLogout() {
  if(bioIsEnabled() && currentUser && localStorage.getItem(BIO_USER_KEY) === currentUser.id) {
    showBiometricLock();
    return;
  }
  await fullLogout();
}

async function fullLogout() {
  await sb.auth.signOut();
  currentUser = null; currentProfile = null;
  const lock = document.getElementById('biometric-lock'); if(lock) lock.style.display = 'none';
  document.getElementById('app-page').style.display = 'none';
  document.getElementById('login-page').style.display = 'block';
  document.getElementById('login-password').value = '';
  prefillLogin();
}

// ===== БИОМЕТРИЧЕСКИЙ ВХОД (WebAuthn: Face ID / Touch ID / отпечаток) =====
// Биометрия не покидает устройство. Это «замок» доступа поверх уже сохранённого входа,
// а не серверная проверка — для внутреннего приложения этого достаточно.
const BIO_ENABLED_KEY = 'slon-bio-enabled';
const BIO_CREDID_KEY  = 'slon-bio-credid';
const BIO_USER_KEY    = 'slon-bio-user';

function bioSupported() { return !!(window.PublicKeyCredential && navigator.credentials); }
async function bioPlatformAvailable() {
  try { return bioSupported() && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch(e) { return false; }
}
function bioIsEnabled() {
  return localStorage.getItem(BIO_ENABLED_KEY) === '1' && !!localStorage.getItem(BIO_CREDID_KEY);
}
function _b64u(buf){ let s=''; const b=new Uint8Array(buf); for(const x of b) s+=String.fromCharCode(x); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function _unb64u(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; const bin=atob(s); const b=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); return b.buffer; }
function _bioChallenge(){ const a=new Uint8Array(32); crypto.getRandomValues(a); return a.buffer; }

async function enableBiometric() {
  if(!currentUser) return showToast('Сначала войдите');
  if(!await bioPlatformAvailable()) return showToast('На этом устройстве биометрия недоступна');
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: _bioChallenge(),
      rp: { name: 'Slon Shisha & Bar', id: location.hostname },
      user: { id: new TextEncoder().encode(currentUser.id), name: currentUser.email || 'user', displayName: currentProfile?.name || currentUser.email || 'Сотрудник' },
      pubKeyCredParams: [{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection: { authenticatorAttachment:'platform', userVerification:'required', residentKey:'preferred' },
      timeout: 60000, attestation: 'none'
    }});
    if(!cred) throw new Error('ключ не создан');
    localStorage.setItem(BIO_CREDID_KEY, _b64u(cred.rawId));
    localStorage.setItem(BIO_USER_KEY, currentUser.id);
    localStorage.setItem(BIO_ENABLED_KEY, '1');
    showToast('✅ Вход по биометрии включён');
    if(typeof loadProfile2 === 'function') loadProfile2();
  } catch(e) { showToast('Не удалось включить: ' + (e.message || e)); }
}

function disableBiometric() {
  localStorage.removeItem(BIO_ENABLED_KEY);
  localStorage.removeItem(BIO_CREDID_KEY);
  localStorage.removeItem(BIO_USER_KEY);
  showToast('Биометрия отключена');
  if(typeof loadProfile2 === 'function') loadProfile2();
}

async function biometricVerify() {
  const credId = localStorage.getItem(BIO_CREDID_KEY);
  if(!credId) return { ok:false, reason:'Биометрия не настроена на этом устройстве. Войдите паролем и включите её заново в Личном кабинете.' };
  try {
    const a = await navigator.credentials.get({ publicKey: {
      challenge: _bioChallenge(),
      allowCredentials: [{ type:'public-key', id: _unb64u(credId) }],
      userVerification: 'required',
      rpId: location.hostname,
      timeout: 60000
    }});
    return { ok: !!a };
  } catch(e) {
    const n = e && e.name;
    if(n === 'NotAllowedError') return { ok:false, reason:'Не распознано или отменено. Нажмите «Разблокировать» ещё раз.' };
    if(n === 'InvalidStateError' || n === 'NotFoundError') return { ok:false, reason:'Отпечаток для этого устройства не найден. Войдите паролем и включите биометрию заново.' };
    return { ok:false, reason:'Биометрия недоступна: ' + (e && e.message || e) };
  }
}

function showBiometricLock() {
  const lock = document.getElementById('biometric-lock');
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app-page').style.display = 'none';
  if(lock) lock.style.display = 'flex';
  const msg = document.getElementById('bio-lock-msg');
  if(msg) msg.textContent = 'Нажмите кнопку и приложите палец / посмотрите в камеру.';
  // НЕ вызываем биометрию автоматически: браузеры блокируют её без нажатия.
  // Пользователь жмёт кнопку «Разблокировать» — это и есть нужное «действие».
}

async function tryBiometricUnlock() {
  const msg = document.getElementById('bio-lock-msg');
  if(msg) msg.textContent = 'Проверяем…';
  const res = await biometricVerify();
  if(res.ok) {
    const lock = document.getElementById('biometric-lock'); if(lock) lock.style.display = 'none';
    showApp();
  } else if(msg) {
    msg.textContent = res.reason || 'Не удалось распознать. Попробуйте ещё раз или войдите паролем.';
  }
}

// «Войти паролем» с экрана блокировки — полный выход к вводу пароля
async function biometricUsePassword() {
  await fullLogout();
}

async function loadProfile() {
  const { data } = await sb.from('profiles').select('*').eq('user_id', currentUser.id).single();
  if(data) { 
    currentProfile = data; 
  } else {
    // No profile found - check if this is the first admin
    const { data: adminCount } = await sb.from('profiles').select('id').eq('role','admin');
    if(!adminCount || adminCount.length === 0) {
      // First user ever - make them admin
      const { data: newP } = await sb.from('profiles').insert({ user_id: currentUser.id, name: currentUser.email, role: 'admin' }).select().single();
      currentProfile = newP;
    } else {
      // Unknown user - deny access
      await sb.auth.signOut();
      document.getElementById('login-error').textContent = 'Аккаунт не найден. Обратитесь к управляющему.';
      document.getElementById('app-page').style.display = 'none';
      document.getElementById('login-page').style.display = 'block';
    }
  }
}

function showApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app-page').style.display = 'block';
  if(PILOT_MODE && !canSeeAdminPanel()) currentFilial = PILOT_FILIAL;
  applyRolePermissions();
  renderFilialSwitcher();
  loadHome();
  checkUnreadMessages();
}

function applyRolePermissions() {
  const role = currentRole();
  // FAB-кнопки (плавающие "+") — только тем, кто реально может редактировать
  const fabAll = ['fab-hr','fab-tasks','fab-finance','fab-crm'];
  fabAll.forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
  if(canEditData()) {
    if(role === 'admin') {
      ['fab-hr','fab-tasks','fab-finance','fab-crm'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='flex'; });
    } else if(role === 'manager') {
      // менеджер — как управляющий, но без дашборда: HR, задачи, брони, финансы
      ['fab-hr','fab-tasks','fab-crm','fab-finance'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='flex'; });
    }
  }
  // Менеджер заводит только рядовых сотрудников — оставляем в форме добавления лишь роль «Сотрудник»
  if(role === 'manager') {
    const addSel = document.getElementById('emp-system-role');
    if(addSel) Array.from(addSel.options).forEach(o=>{ if(o.value!=='employee') o.remove(); });
  }
  // Кнопка админ-панели в нижней навигации — теперь и у менеджера
  const navAdmin = document.getElementById('nav-admin');
  if(navAdmin) navAdmin.style.display = canOpenAdminPanel() ? 'flex' : 'none';

  if(role === 'employee') {
    const statsGrid = document.getElementById('home-stats-grid');
    if(statsGrid) statsGrid.style.display='none';
  }
  // Пометка "режим наблюдателя" для владельца
  document.body.classList.toggle('boss-readonly', isBoss());
}

function openMoreMenu() {
  // Группы разделов. show определяет, кому пункт виден.
  const groups = [
    { title:'Личное', items:[
      {id:'profile', label:'📄 Личный кабинет', show:true},
      {id:'mynotes', label:'📝 Мой задачник', show: canEditData() || isBoss()},
      {id:'help', label:'💡 Помощник', show:true},
    ]},
    { title:'Работа', items:[
      {id:'knowledge', label:'📚 База знаний', show:true},
      {id:'supply', label:'🧴 Хозчасть', show:true},
      {id:'dishware', label:'🍽️ Посуда', show:true},
      {id:'calendar', label:'📅 Календарь', show:true},
    ]},
    { title:'Команда', items:[
      {id:'hr', label:'👥 Сотрудники', show:true},
      {id:'teamchat', label:'💬 Общий чат', show:true},
      {id:'feed', label:'📢 Лента', show:true},
      {id:'reviews', label:'⭐ Отзывы', show:true},
    ]},
    { title:'Управление', items:[
      {id:'finance', label:'💰 Финансы', show: canSeeFinance()},
      {id:'dashboard', label:'📈 Дашборд', show: canSeeAdminPanel()},
      {id:'directory', label:'📇 Справочник', show: canEditData() || isBoss()},
      {id:'admin', label:'⚙️ Админ-панель', show: canOpenAdminPanel()},
    ]},
  ];
  const menu = document.getElementById('more-menu-items');
  menu.innerHTML = groups.map(g=>{
    const visible = g.items.filter(i=>i.show);
    if(visible.length===0) return '';
    return `<div class="more-menu-group-title">${g.title}</div>` +
      visible.map(i=>{
        const sp = i.label.indexOf(' ');
        const icon = i.label.slice(0, sp);
        const text = i.label.slice(sp+1);
        return `<button class="more-menu-item" onclick="showScreen('${i.id}', null)"><span class="more-menu-icon">${icon}</span><span>${text}</span></button>`;
      }).join('');
  }).join('');
  openModal('modal-more-menu');
}

function showScreen(name, btn) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const scr = document.getElementById('screen-'+name);
  if(scr) scr.classList.add('active');
  if(btn) btn.classList.add('active');
  closeModal('modal-more-menu');
  if(name==='home') loadHome();
  if(name==='hr') loadHR();
  if(name==='tasks') { loadTasks(); startTasksPolling(); }
  else { if(typeof stopTasksPolling === 'function') stopTasksPolling(); }
  if(name==='admin') loadAdmin();
  if(name==='checklist') { initChecklistScreen(); }
  if(name==='schedule') loadSchedule();
  if(name==='finance') loadFinance();
  if(name==='teamchat') initTeamChat();
  if(name==='profile') loadProfile2();
  if(name==='knowledge') loadKnowledgeBase();
  if(name==='supply') loadSupply();
  if(name==='dishware') loadDishware();
  if(name==='directory') loadDirectory();
  if(name==='reviews') loadReviews();
  if(name==='feed') loadFeed();
  if(name==='calendar') loadCalendar();
  if(name==='dashboard') loadDashboard();
  if(name==='mynotes') loadMyNotes();
  if(name==='help') loadHelp();
}

// LOG ACTIVITY
async function logActivity(action, details) {
  try {
    await sb.from('activity_log').insert({
      user_id: currentUser?.id,
      user_name: currentProfile?.name || currentUser?.email,
      action, details
    });
  } catch(e) {}
}

