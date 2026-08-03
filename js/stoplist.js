// ============ ГО/СТОП ЛИСТ ============
// Стоп — позиции, которых нет: официант не должен их предлагать.
// Го — то, что надо продать в первую очередь (скоро испортится, остались порции).
// Ставит тот, кто отвечает за продукт: повар по кухне, бармен по бару.
// Видят все, а официанты ещё и получают уведомление в Telegram.

// Цех → область. Должно совпадать с политиками RLS в миграции 2026-08-03_stoplist.sql.
const STOPLIST_DEPT_AREA = { 'Повара': 'kitchen', 'Бармены': 'bar' };
const STOPLIST_AREAS = ['kitchen', 'bar'];

function stopAreaLabel(a) { return a === 'bar' ? t('sl.areaBar') : t('sl.areaKitchen'); }

let stopListTab = 'now';
let stopListFilter = '';    // '' = все области
// Активные позиции живут в кэше: их же показывает карточка на главном экране,
// чтобы не ходить в базу второй раз при каждом возврате на главную.
let stopListActive = [];

// Управляющий и менеджер правят обе области, повар и бармен — только свою.
function stopListCanEdit(area) {
  if(isBoss()) return false;              // владелец только смотрит
  if(canEditData()) return true;
  const dept = currentEmployee?.department;
  return !!dept && STOPLIST_DEPT_AREA[dept] === area;
}
function stopListMyAreas() { return STOPLIST_AREAS.filter(stopListCanEdit); }

function stopTime(ts) {
  const d = new Date(ts);
  if(isNaN(d)) return '';
  const time = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  // Сегодняшнее показываем только временем — так короче и читается быстрее
  return ymdLocal(d) === today() ? time : fmtLocale(d, {day:'numeric', month:'short'}) + ' ' + time;
}

async function loadStopList() {
  const addBtn = document.getElementById('stoplist-add-btn');
  if(addBtn) addBtn.style.display = stopListMyAreas().length ? 'block' : 'none';
  const sub = document.getElementById('stoplist-subtitle');
  if(sub) sub.textContent = getFilialName(currentFilial);
  switchStopListTab(stopListTab);
}

function switchStopListTab(tab) {
  stopListTab = tab;
  const n = document.getElementById('stoplist-tab-now');
  const h = document.getElementById('stoplist-tab-history');
  if(n && h) {
    n.style.background = tab==='now' ? 'var(--gold-dark)' : 'var(--surface-2)';
    n.style.color      = tab==='now' ? '#fff' : 'var(--text-primary)';
    h.style.background = tab==='history' ? 'var(--gold-dark)' : 'var(--surface-2)';
    h.style.color      = tab==='history' ? '#fff' : 'var(--text-primary)';
  }
  if(tab==='now') loadStopListNow(); else loadStopListHistory();
}

async function loadStopListNow() {
  const content = document.getElementById('stoplist-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data, error } = await sb.from('stoplist_items').select('*')
      .eq('filial', currentFilial).is('resolved_at', null).order('created_at', { ascending: false });
    if(error) throw error;
    stopListActive = data || [];
    content.innerHTML = `<div id="stoplist-filter"></div><div id="stoplist-list"></div>`;
    renderStopListFilter();
    renderStopListNow();
  } catch(e) {
    content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('sl.errNotSetup')}</div></div></div>`;
  }
}

function setStopListFilter(area) { stopListFilter = area; renderStopListFilter(); renderStopListNow(); }

function renderStopListFilter() {
  const el = document.getElementById('stoplist-filter');
  if(!el) return;
  const chip = (val, label) => {
    const on = stopListFilter === val;
    return `<button onclick="setStopListFilter('${val}')" style="flex:1;padding:9px;border-radius:10px;border:1px solid ${on?'var(--gold-dark)':'var(--border)'};background:${on?'var(--gold-dark)':'var(--surface)'};color:${on?'#fff':'var(--text-primary)'};font-size:13px;font-weight:600;cursor:pointer">${label}</button>`;
  };
  el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px">
    ${chip('', t('sl.filterAll'))}${chip('kitchen', '👨‍🍳 ' + t('sl.areaKitchen'))}${chip('bar', '🍹 ' + t('sl.areaBar'))}</div>`;
}

function stopRowHTML(it) {
  const isStop = it.state === 'stop';
  const canEdit = stopListCanEdit(it.area);
  return `<div class="card" style="display:flex;align-items:center;gap:10px;border-left:3px solid ${isStop?'#A32D2D':'#C77E24'}">
    <div style="flex:1;min-width:0">
      <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(it.name)}</div>
      <div style="font-size:12px;color:var(--text-muted)">${stopAreaLabel(it.area)} · ${escapeHtml(firstName(it.created_by_name)||'')} · ${stopTime(it.created_at)}</div>
      ${it.note?`<div style="font-size:13px;color:var(--text-secondary);margin-top:3px">${escapeHtml(it.note)}</div>`:''}
    </div>
    ${canEdit?`<button onclick="resolveStopItem(${it.id})" style="flex:0 0 auto;background:#e2efda;color:#3B6D11;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer">${t('sl.returnBtn')}</button>`:''}
  </div>`;
}

function renderStopListNow() {
  const list = document.getElementById('stoplist-list');
  if(!list) return;
  const items = stopListFilter ? stopListActive.filter(i=>i.area===stopListFilter) : stopListActive;
  if(items.length === 0) {
    list.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">✅</div><div class="empty-text">${t('sl.empty')}</div></div></div>`;
    return;
  }
  const section = (state, icon, title, color) => {
    const rows = items.filter(i=>i.state===state);
    if(rows.length === 0) return '';
    return `<div class="section-label" style="margin:14px 4px 6px;color:${color}">${icon} ${title} · ${rows.length}</div>${rows.map(stopRowHTML).join('')}`;
  };
  list.innerHTML = section('stop', '🛑', t('sl.sectionStop'), '#A32D2D')
                 + section('go',   '⚡', t('sl.sectionGo'),   '#C77E24');
}

// ===== Постановка позиции =====
function openStopItemModal(state) {
  const areas = stopListMyAreas();
  if(areas.length === 0) return;
  document.getElementById('stoplist-item-name').value = '';
  document.getElementById('stoplist-item-note').value = '';
  const areaSel = document.getElementById('stoplist-item-area');
  areaSel.innerHTML = areas.map(a=>`<option value="${a}">${escapeHtml(stopAreaLabel(a))}</option>`).join('');
  // Своя область выбрана заранее: повару и бармену менять её всё равно нельзя
  areaSel.value = areas[0];
  areaSel.disabled = areas.length === 1;
  const stateSel = document.getElementById('stoplist-item-state');
  stateSel.value = state || 'stop';
  openModal('modal-stoplist-item');
}

async function saveStopItem() {
  const name  = document.getElementById('stoplist-item-name').value.trim();
  const note  = document.getElementById('stoplist-item-note').value.trim();
  const area  = document.getElementById('stoplist-item-area').value;
  const state = document.getElementById('stoplist-item-state').value;
  if(!name) return showToast(t('sl.enterName'));
  if(!stopListCanEdit(area)) return showToast(t('sl.noRights'));
  try {
    const row = {
      filial: currentFilial, area, state, name, note: note || null,
      created_by: currentUser.id, created_by_name: currentProfile?.name || currentUser?.email
    };
    const { data, error } = await sb.from('stoplist_items').insert(row).select().single();
    // Частичный уникальный индекс: та же позиция уже висит в списке
    if(error) return showToast(error.code === '23505' ? t('sl.dupName') : t('common.error') + error.message);
    closeModal('modal-stoplist-item');
    showToast(state === 'stop' ? t('sl.addedStop') : t('sl.addedGo'));
    loadStopListNow();
    notifyStopList(data || row, 'on');
  } catch(e) { showToast(t('common.error') + e.message); }
}

// Снятие: позиция не удаляется, а закрывается — история остаётся.
async function resolveStopItem(id) {
  const it = stopListActive.find(x=>x.id===id);
  if(!it) return;
  if(!stopListCanEdit(it.area)) return showToast(t('sl.noRights'));
  const ok = await confirmDialog(t('sl.confirmReturn', { name: it.name }), { title: t('sl.returnBtn'), okText: t('sl.returnBtn'), danger: false });
  if(!ok) return;
  try {
    const { error } = await sb.from('stoplist_items').update({
      resolved_at: new Date().toISOString(),
      resolved_by: currentUser.id,
      resolved_by_name: currentProfile?.name || currentUser?.email
    }).eq('id', id);
    if(error) return showToast(t('common.error') + error.message);
    showToast(t('sl.returned'));
    loadStopListNow();
    notifyStopList(it, 'off');
  } catch(e) { showToast(t('common.error') + e.message); }
}

// ===== История =====
async function loadStopListHistory() {
  const content = document.getElementById('stoplist-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data } = await sb.from('stoplist_items').select('*')
      .eq('filial', currentFilial).not('resolved_at','is',null)
      .order('resolved_at', { ascending: false }).limit(60);
    if(!data || data.length === 0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('sl.noHistory')}</div></div></div>`;
      return;
    }
    content.innerHTML = data.map(it=>{
      const mins = Math.max(0, Math.round((new Date(it.resolved_at) - new Date(it.created_at)) / 60000));
      const dur = mins < 60 ? t('sl.durMin', { n: mins }) : t('sl.durHour', { n: Math.round(mins/60) });
      return `<div class="list-item">
        <div class="item-info">
          <div class="item-name">${it.state==='stop'?'🛑':'⚡'} ${escapeHtml(it.name)}</div>
          <div class="item-sub">${stopAreaLabel(it.area)} · ${stopTime(it.created_at)} → ${stopTime(it.resolved_at)} · ${dur}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('sl.errNotSetup')}</div></div></div>`;
  }
}

// ===== Карточка на главном экране =====
// Официант открывает приложение и сразу видит, чего сегодня нет. Пустой лист
// карточку не рисует — незачем занимать экран строкой «всё в наличии».
async function renderStopListCard() {
  const el = document.getElementById('home-stoplist-card');
  if(!el) return;
  try {
    const { data } = await sb.from('stoplist_items').select('id,name,area,state')
      .eq('filial', currentFilial).is('resolved_at', null).order('created_at', { ascending: false });
    const items = data || [];
    if(items.length === 0) { el.innerHTML = ''; return; }
    const line = (state, icon, color) => {
      const names = items.filter(i=>i.state===state).map(i=>i.name);
      if(names.length === 0) return '';
      // Больше четырёх названий в карточку не помещается — остальные за счётчиком
      const shown = names.slice(0, 4).map(escapeHtml).join(', ');
      const rest = names.length > 4 ? ' ' + t('sl.andMore', { n: names.length - 4 }) : '';
      return `<div style="font-size:13px;color:${color};margin-top:4px">${icon} <b>${shown}</b>${rest}</div>`;
    };
    el.innerHTML = `<div class="card" style="margin-bottom:12px;cursor:pointer" onclick="showScreen('stoplist', null)">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);text-transform:uppercase;letter-spacing:0.4px">🚦 ${t('sl.homeTitle')}</div>
        <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">${t('sl.homeOpen')} ›</span>
      </div>
      ${line('stop', '🛑', '#A32D2D')}
      ${line('go', '⚡', '#C77E24')}
    </div>`;
  } catch(e) { el.innerHTML = ''; }
}

// ===== Уведомления =====
// Официанту важно узнать о стопе сразу, а не когда гость уже заказал.
async function notifyStopList(item, action) {
  const head = action === 'off'
    ? '✅ <b>' + t('sl.tgBack') + '</b>'
    : (item.state === 'stop' ? '🛑 <b>' + t('sl.tgStop') + '</b>' : '⚡ <b>' + t('sl.tgGo') + '</b>');
  const msg = `${head}\n\n📌 ${tgEscape(item.name)}\n📍 ${tgEscape(stopAreaLabel(item.area))} · ${tgEscape(getFilialName(item.filial || currentFilial))}`
    + (action !== 'off' && item.note ? `\n💬 ${tgEscape(item.note)}` : '')
    + `\n👤 ${tgEscape(currentProfile?.name || '')}`;
  try {
    // Официанты текущего филиала: у сотрудника filials может быть пустым — тогда он числится на обоих
    const { data: emps } = await sb.from('employees').select('id,filials').eq('department','Официанты').neq('status','Уволен');
    const ids = (emps||[])
      .filter(e => (e.filials && e.filials.length ? e.filials : ['istikbol','chekhov']).includes(item.filial || currentFilial))
      .map(e => e.id);
    if(ids.length) {
      const { data: profs } = await sb.from('profiles').select('user_id,telegram_id,notify_prefs').in('employee_id', ids);
      for(const p of (profs||[])) {
        if(p.user_id !== currentUser?.id && p.telegram_id && _wantsNotif(p.notify_prefs, 'stoplist')) {
          await sendTelegram(p.telegram_id, msg);
        }
      }
    }
  } catch(e) { console.error('notifyStopList', e); }
  await notifyAdminsAll(msg, 'stoplist');
}
