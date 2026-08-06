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

// ===== Выбор позиции из меню =====
// Раньше название вписывали руками, и одно блюдо появлялось в трёх написаниях —
// официант потом искал его в листе и не находил. Теперь список меню с поиском,
// а стоп и го ставятся одной кнопкой. Чего нет в меню — по-прежнему вручную.
let stopPickerArea = 'kitchen';
let stopPickerQuery = '';

function openStopItemModal() {
  const areas = stopListMyAreas();
  if(areas.length === 0) return;
  stopPickerArea = areas.includes('kitchen') ? 'kitchen' : areas[0];
  stopPickerQuery = '';
  const input = document.getElementById('stop-picker-search');
  if(input) input.value = '';
  renderStopPicker();
  openModal('modal-stop-picker');
}

function setStopPickerArea(area) { stopPickerArea = area; renderStopPicker(); }
function onStopPickerSearch(value) { stopPickerQuery = value; renderStopPickerList(); }

function renderStopPicker() {
  const areas = stopListMyAreas();
  const tabs = document.getElementById('stop-picker-areas');
  if(tabs) {
    // Переключатель нужен только тому, кто отвечает за обе области
    tabs.style.display = areas.length > 1 ? 'flex' : 'none';
    tabs.innerHTML = areas.map(a => {
      const on = stopPickerArea === a;
      return `<button onclick="setStopPickerArea('${a}')" style="flex:1;padding:9px;border-radius:10px;border:1px solid ${on?'var(--gold-dark)':'var(--border)'};background:${on?'var(--gold-dark)':'var(--surface)'};color:${on?'#fff':'var(--text-primary)'};font-size:13px;font-weight:600;cursor:pointer">${escapeHtml(stopAreaLabel(a))}</button>`;
    }).join('');
  }
  renderStopPickerList();
}

// Что уже стоит в листе по этому названию (чтобы не ставить дважды)
function stopActiveFor(name, area) {
  return stopListActive.find(i => i.area === area && i.name === name);
}

function stopPickerRow(name, section) {
  const active = stopActiveFor(name, stopPickerArea);
  const nameHtml = `<div style="flex:1;min-width:0">
      <div style="font-size:14px;font-weight:600;color:var(--text-primary)">${escapeHtml(name)}</div>
      ${section?`<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(section)}</div>`:''}
    </div>`;
  if(active) {
    const label = active.state === 'stop' ? '🛑 ' + t('sl.stopShort') : '⚡ ' + t('sl.goShort');
    const color = active.state === 'stop' ? '#A32D2D' : '#C77E24';
    return `<div style="display:flex;align-items:center;gap:8px;padding:9px 4px;border-bottom:1px solid var(--border)">
      ${nameHtml}
      <span style="font-size:12px;font-weight:600;color:${color};white-space:nowrap">${label}</span>
      <button onclick="resolveStopItem(${active.id}, true)" style="flex:0 0 auto;background:#e2efda;color:#3B6D11;border:none;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer">${t('sl.returnBtn')}</button>
    </div>`;
  }
  const btn = (state, bg, color, label) =>
    `<button onclick="setStopFromMenu('${escJsAttr(name)}','${state}')" style="flex:0 0 auto;background:${bg};color:${color};border:none;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer">${label}</button>`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:9px 4px;border-bottom:1px solid var(--border)">
    ${nameHtml}
    ${btn('go', '#FDF2E0', '#8A5B12', '⚡ ' + t('sl.goShort'))}
    ${btn('stop', '#FCEBEB', '#A32D2D', '🛑 ' + t('sl.stopShort'))}
  </div>`;
}

function renderStopPickerList() {
  const list = document.getElementById('stop-picker-list');
  if(!list) return;
  // Каталог есть только по кухне: бар со своими напитками ставится вручную
  if(stopPickerArea !== 'kitchen') {
    list.innerHTML = `<div class="empty" style="padding:18px 0"><div class="empty-text">${t('sl.noCatalog')}</div></div>`;
    return;
  }
  const found = searchKitchenMenu(stopPickerQuery);
  if(found.length === 0) {
    list.innerHTML = `<div class="empty" style="padding:18px 0"><div class="empty-text">${t('sl.nothingFound')}</div></div>`;
    return;
  }
  // При поиске разделы не рисуем — иначе на экране одни заголовки
  if(stopPickerQuery.trim()) {
    list.innerHTML = found.map(d => stopPickerRow(d.name, d.section)).join('');
    return;
  }
  const names = new Set(found.map(d => d.name));
  list.innerHTML = KITCHEN_MENU.map(g => {
    const rows = g.items.filter(n => names.has(n));
    if(rows.length === 0) return '';
    return `<div class="section-label" style="margin:14px 4px 4px">${escapeHtml(g.section)}</div>`
      + rows.map(n => stopPickerRow(n, '')).join('');
  }).join('');
}

// Одно нажатие — позиция в листе
async function setStopFromMenu(name, state) {
  const ok = await addStopItem({ name, area: stopPickerArea, state });
  if(ok) renderStopPickerList();
}

// ===== Ручной ввод: то, чего нет в меню =====
function openStopManualModal() {
  const areas = stopListMyAreas();
  if(areas.length === 0) return;
  closeModal('modal-stop-picker');
  document.getElementById('stoplist-item-name').value = '';
  document.getElementById('stoplist-item-note').value = '';
  const areaSel = document.getElementById('stoplist-item-area');
  areaSel.innerHTML = areas.map(a=>`<option value="${a}">${escapeHtml(stopAreaLabel(a))}</option>`).join('');
  // Своя область выбрана заранее: повару и бармену менять её всё равно нельзя
  areaSel.value = areas.includes(stopPickerArea) ? stopPickerArea : areas[0];
  areaSel.disabled = areas.length === 1;
  document.getElementById('stoplist-item-state').value = 'stop';
  openModal('modal-stoplist-item');
}

// Общая запись позиции: и для выбора из меню, и для ручного ввода
async function addStopItem({ name, area, state, note }) {
  if(!name) { showToast(t('sl.enterName')); return false; }
  if(!stopListCanEdit(area)) { showToast(t('sl.noRights')); return false; }
  try {
    const row = {
      filial: currentFilial, area, state, name, note: note || null,
      created_by: currentUser.id, created_by_name: currentProfile?.name || currentUser?.email
    };
    const { data, error } = await sb.from('stoplist_items').insert(row).select().single();
    // Частичный уникальный индекс: та же позиция уже висит в списке
    if(error) { showToast(error.code === '23505' ? t('sl.dupName') : t('common.error') + error.message); return false; }
    showToast(state === 'stop' ? t('sl.addedStop') : t('sl.addedGo'));
    // Держим кэш в актуальном виде: по нему рисуется и список, и окно выбора
    stopListActive = [data, ...stopListActive];
    renderStopListNow();
    notifyStopList(data || row, 'on');
    return true;
  } catch(e) { showToast(t('common.error') + e.message); return false; }
}

async function saveStopItem() {
  const ok = await addStopItem({
    name:  document.getElementById('stoplist-item-name').value.trim(),
    note:  document.getElementById('stoplist-item-note').value.trim(),
    area:  document.getElementById('stoplist-item-area').value,
    state: document.getElementById('stoplist-item-state').value,
  });
  if(ok) { closeModal('modal-stoplist-item'); loadStopListNow(); }
}

// Снятие: позиция не удаляется, а закрывается — история остаётся.
// fromPicker — сняли из окна выбора, там подтверждение только мешает: человек
// стоит у плиты и жмёт кнопку напротив названия.
async function resolveStopItem(id, fromPicker) {
  const it = stopListActive.find(x=>x.id===id);
  if(!it) return;
  if(!stopListCanEdit(it.area)) return showToast(t('sl.noRights'));
  if(!fromPicker) {
    const ok = await confirmDialog(t('sl.confirmReturn', { name: it.name }), { title: t('sl.returnBtn'), okText: t('sl.returnBtn'), danger: false });
    if(!ok) return;
  }
  try {
    const { error } = await sb.from('stoplist_items').update({
      resolved_at: new Date().toISOString(),
      resolved_by: currentUser.id,
      resolved_by_name: currentProfile?.name || currentUser?.email
    }).eq('id', id);
    if(error) return showToast(t('common.error') + error.message);
    showToast(t('sl.returned'));
    stopListActive = stopListActive.filter(x => x.id !== id);
    if(fromPicker) { renderStopPickerList(); renderStopListNow(); }
    else loadStopListNow();
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
