const SUPABASE_URL = 'https://omeomdkurvtvirhfkffu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_h7pdCQTKnGIlIR9SaswShw_ur8eauw6';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TG_TOKEN = '8675217218:AAGZ6LDhRIiMuyPJITgbjp-qkPVxuPJawEg';
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

// Экранирует спецсимволы, чтобы они не ломали HTML-разметку в Telegram-сообщении
function tgEscape(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function notifyEmployee(userId, text) {
  const { data } = await sb.from('profiles').select('telegram_id').eq('user_id', userId).single();
  if(data?.telegram_id) await sendTelegram(data.telegram_id, text);
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
// Видит финансы (доходы/расходы): управляющий и владелец
function canSeeFinance() { const r = currentRole(); return r === 'admin' || r === 'boss'; }
// Видит зарплаты: менеджер, управляющий, владелец
function canSeeSalaryRole() { const r = currentRole(); return r === 'manager' || r === 'admin' || r === 'boss'; }
// Видит админ-панель: управляющий и владелец (владелец — только смотрит)
function canSeeAdminPanel() { const r = currentRole(); return r === 'admin' || r === 'boss'; }

function renderFilialSwitcher() {
  const el = document.getElementById('filial-switcher');
  if(!el) return;
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
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click', e=>{ if(e.target===o) o.classList.remove('open'); });
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

async function doLogout() {
  await sb.auth.signOut();
  currentUser = null; currentProfile = null;
  document.getElementById('app-page').style.display = 'none';
  document.getElementById('login-page').style.display = 'block';
  document.getElementById('login-password').value = '';
  prefillLogin();
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
      ['fab-tasks','fab-crm'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='flex'; });
    }
  }
  // Кнопка админ-панели в нижней навигации
  const navAdmin = document.getElementById('nav-admin');
  if(navAdmin) navAdmin.style.display = canSeeAdminPanel() ? 'flex' : 'none';

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
      {id:'dashboard', label:'📈 Дашборд', show: canSeeAdminPanel()},
      {id:'directory', label:'📇 Справочник', show: canEditData() || isBoss()},
      {id:'admin', label:'⚙️ Админ-панель', show: canSeeAdminPanel()},
    ]},
  ];
  const menu = document.getElementById('more-menu-items');
  menu.innerHTML = groups.map(g=>{
    const visible = g.items.filter(i=>i.show);
    if(visible.length===0) return '';
    return `<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:14px 4px 8px">${g.title}</div>` +
      visible.map(i=>`<button onclick="showScreen('${i.id}', null)" style="width:100%;text-align:left;background:var(--surface-2);border:none;border-radius:12px;padding:14px 16px;font-size:15px;color:var(--text-primary);margin-bottom:8px;cursor:pointer;display:block">${i.label}</button>`).join('');
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

