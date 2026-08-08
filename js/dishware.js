// ============ ПОСУДА (DISHWARE) ============
let dishwareTab = 'stock';
function dishwareCanManage() { return canEditData(); }

// Зоны из инвентарного листа. Порядок задаёт порядок секций в списке;
// категория, которой тут нет, уезжает в конец под своим же названием.
const DISHWARE_CATS = ['Зал','Бар','Кухня'];
const DISHWARE_CAT_KEYS = { 'Зал':'dish.catHall', 'Бар':'dish.catBar', 'Кухня':'dish.catKitchen' };
function dishwareCatLabel(cat) {
  if(!cat) return t('dish.catOther');
  return DISHWARE_CAT_KEYS[cat] ? t(DISHWARE_CAT_KEYS[cat]) : cat;
}

// Позиций больше шестидесяти, поэтому список держим в памяти: поиск фильтрует
// кэш, а не дёргает базу на каждое нажатие клавиши.
let dishwareStock = [];
let dishwareSearch = '';
let dishwareEditId = null;
let dishwarePhotoItemId = null;

// Инвентаризация: открытая сессия филиала и уже внесённые пересчёты (item_id → строка)
let dishwareInv = null;
let dishwareCounts = {};
let dishwareInvZone = '';
let dishwareInvSearch = '';

function switchDishwareTab(tab) {
  dishwareTab = tab;
  const tabs = { stock: 'dishware-tab-stock', inventory: 'dishware-tab-inventory', report: 'dishware-tab-report' };
  for(const [name, id] of Object.entries(tabs)) {
    const el = document.getElementById(id);
    if(!el) continue;
    el.style.background = tab===name ? 'var(--gold-dark)' : 'var(--surface-2)';
    el.style.color = tab===name ? '#fff' : 'var(--text-primary)';
  }
  if(tab==='stock') loadDishwareStock();
  else if(tab==='inventory') loadDishwareInventory();
  else loadDishwareReport();
}

async function loadDishware() {
  const addBtn = document.getElementById('dishware-add-item-btn');
  if(addBtn) addBtn.style.display = dishwareCanManage() ? 'block' : 'none';
  document.getElementById('dishware-subtitle').textContent = getFilialName(currentFilial);
  switchDishwareTab(dishwareTab);
}

// Открытая инвентаризация филиала — одна или ни одной (за этим следит
// частичный уникальный индекс в базе).
async function loadDishwareOpenInventory() {
  try {
    const { data } = await sb.from('dishware_inventories').select('*')
      .eq('filial', currentFilial).eq('status','open').maybeSingle();
    dishwareInv = data || null;
  } catch(e) { dishwareInv = null; }
  markDishwareInvTab();
  return dishwareInv;
}

// Точка на вкладке, пока идёт пересчёт: официант заходит в «Посуду» по своим
// делам и должен видеть, что его ждут, не открывая вкладку
function markDishwareInvTab() {
  const el = document.getElementById('dishware-tab-inventory');
  if(!el) return;
  el.textContent = t('dinv.tab') + (dishwareInv ? ' •' : '');
}

function dishwareFmt(n){ n=Number(n)||0; return Number.isInteger(n)?String(n):n.toFixed(2).replace(/\.?0+$/,''); }

// Миниатюра позиции. Фото лежит в хранилище уже ужатым (~400px), в списке
// грузится лениво — шесть десятков строк не тянут трафик и память разом.
function dishwareThumb(it, size) {
  size = size || 44;
  if(it && it.photo_url) {
    return `<img src="${escapeHtml(it.photo_url)}" loading="lazy" decoding="async" alt=""
      onclick="event.stopPropagation();viewDishwarePhoto(${it.id})"
      style="width:${size}px;height:${size}px;object-fit:cover;border-radius:8px;flex:0 0 auto;cursor:zoom-in;background:var(--surface-2)">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:8px;flex:0 0 auto;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.5)}px">🍽️</div>`;
}

async function viewDishwarePhoto(itemId) {
  // В отчёте боя кэша остатков может не быть — тогда добираем фото из базы
  let it = dishwareStock.find(x=>x.id===itemId);
  if(!it || !it.photo_url) {
    const { data } = await sb.from('dishware_items').select('id,name,photo_url').eq('id', itemId).single();
    it = data;
  }
  if(!it || !it.photo_url) return;
  document.getElementById('view-report-content').innerHTML =
    `<div style="text-align:center"><img src="${escapeHtml(it.photo_url)}" alt="" style="max-width:100%;border-radius:12px">
     <div style="margin-top:8px;font-weight:600;color:var(--text-primary)">${escapeHtml(it.name)}</div></div>`;
  openModal('modal-view-report');
}

async function loadDishwareStock() {
  const content = document.getElementById('dishware-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const [{ data: items }] = await Promise.all([
      sb.from('dishware_items').select('*').eq('filial', currentFilial).order('name'),
      loadDishwareOpenInventory(),
    ]);
    dishwareStock = items || [];
    if(dishwareStock.length===0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">🍽️</div><div class="empty-text">${t('inv.noItems')}${dishwareCanManage()?t('inv.addItemHint'):''}</div></div></div>`;
      return;
    }
    // Итоговая стоимость склада
    const totalVal = dishwareStock.reduce((s,it)=>s+Number(it.qty||0)*Number(it.cost||0),0);
    let html = dishwareCanManage() ? `<div class="card" style="text-align:center;padding:12px"><div style="font-size:12px;color:var(--text-muted)">${t('dish.stockValue')}</div><div style="font-size:22px;font-weight:700;color:var(--text-primary)">${formatNum(Math.round(totalVal))} ${t('common.sum')}</div></div>` : '';
    html += `<div class="card" style="padding:8px"><input class="form-input" id="dishware-search" placeholder="${t('dish.search')}" value="${escapeHtml(dishwareSearch)}" oninput="renderDishwareStock()"></div>
      <div id="dishware-list"></div>`;
    content.innerHTML = html;
    renderDishwareStock();
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('dish.errNotSetup')}</div></div></div>`; }
}

// Перерисовывает только список — поле поиска не трогаем, иначе слетает фокус
function renderDishwareStock() {
  const list = document.getElementById('dishware-list');
  if(!list) return;
  const inp = document.getElementById('dishware-search');
  dishwareSearch = inp ? inp.value : '';
  const q = dishwareSearch.trim().toLowerCase();
  const items = q ? dishwareStock.filter(it=>(it.name||'').toLowerCase().includes(q)) : dishwareStock;
  if(items.length===0) { list.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('dish.nothingFound')}</div></div></div>`; return; }

  const groups = {};
  items.forEach(it=>{ const c = it.category || ''; (groups[c] = groups[c] || []).push(it); });
  const known = DISHWARE_CATS.filter(c=>groups[c]);
  const rest = Object.keys(groups).filter(c=>!DISHWARE_CATS.includes(c)).sort();

  // Пока идёт инвентаризация, остаток от официантов скрыт: иначе «слепой»
  // пересчёт слепым не является — достаточно переключить вкладку и списать
  // цифру оттуда. Руководство остаток видит всегда.
  const hideQty = !!dishwareInv && !dishwareCanManage();

  list.innerHTML = known.concat(rest).map(cat=>{
    const rows = groups[cat].map(it=>{
      const q2 = Number(it.qty)||0;
      const low = q2<=0;
      const stockLine = hideQty
        ? `<div style="font-size:13px;color:var(--text-muted)">🔒 ${t('dinv.qtyHidden')}</div>`
        : `<div style="font-size:13px;color:${low?'#A32D2D':'var(--text-muted)'}">${t('inv.remaining')} <b>${dishwareFmt(q2)} ${t('dish.pcs')}</b>${dishwareCanManage()?` · ${formatNum(it.cost)} ${t('dish.perPcs')}`:''}</div>`;
      return `<div class="card" style="display:flex;align-items:center;gap:10px">
        ${dishwareThumb(it)}
        <div style="flex:1;min-width:0;cursor:pointer" onclick="openDishwareHistory(${it.id})">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(it.name)}</div>
          ${stockLine}
        </div>
        <button onclick="openDishwareBreak(${it.id})" style="background:#FCEBEB;color:#A32D2D;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;flex:0 0 auto">${t('dish.breakBtn')}</button>
      </div>`;
    }).join('');
    return `<div class="section-label" style="margin:14px 4px 6px">${escapeHtml(dishwareCatLabel(cat))} · ${groups[cat].length}</div>${rows}`;
  }).join('');
}

// Новая позиция / редактирование существующей
function openDishwareItemModal(itemId) {
  if(!dishwareCanManage()) return;
  dishwareEditId = itemId || null;
  const it = itemId ? dishwareStock.find(x=>x.id===itemId) : null;
  document.getElementById('dishware-item-title').textContent = it ? t('dish.editTitle') : t('dish.newItemTitle');
  document.getElementById('dishware-item-save').textContent = it ? t('dish.save') : t('dish.create');
  document.getElementById('dishware-item-name').value = it ? it.name : '';
  document.getElementById('dishware-item-cost').value = it ? (it.cost||'') : '';
  document.getElementById('dishware-item-qty').value = it ? (it.qty||0) : '';
  const sel = document.getElementById('dishware-item-category');
  sel.innerHTML = `<option value="">${t('dish.catOther')}</option>` +
    DISHWARE_CATS.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(dishwareCatLabel(c))}</option>`).join('');
  sel.value = it && DISHWARE_CATS.includes(it.category) ? it.category : '';
  document.getElementById('dishware-item-filial').textContent = t('inv.warehouseFilial') + getFilialName(currentFilial);
  openModal('modal-dishware-item');
}
async function saveDishwareItem() {
  const name = document.getElementById('dishware-item-name').value.trim();
  const cost = parseFloat(document.getElementById('dishware-item-cost').value)||0;
  const qty = parseFloat(document.getElementById('dishware-item-qty').value)||0;
  const category = document.getElementById('dishware-item-category').value || null;
  if(!name) return showToast(t('inv.enterName'));
  try {
    // Имя позиции уникально в пределах филиала, поэтому ошибку показываем:
    // молча проглоченный дубль выглядел бы как «сохранил, но ничего не изменилось».
    if(dishwareEditId) {
      const { error } = await sb.from('dishware_items').update({ name, cost, qty, category }).eq('id', dishwareEditId);
      if(error) return showToast(error.code==='23505' ? t('dish.dupName') : t('common.error')+error.message);
      closeModal('modal-dishware-item');
      showToast(t('dish.itemUpdated'));
    } else {
      const { error } = await sb.from('dishware_items').insert({ name, cost, qty, category, filial: currentFilial });
      if(error) return showToast(error.code==='23505' ? t('dish.dupName') : t('common.error')+error.message);
      closeModal('modal-dishware-item');
      showToast(t('inv.itemCreated'));
    }
    dishwareEditId = null;
    closeModal('modal-dishware-history');
    loadDishwareStock();
  } catch(e) { showToast(t('common.error')+e.message); }
}

// Фото позиции
function pickDishwarePhoto(itemId) {
  if(!dishwareCanManage()) return;
  dishwarePhotoItemId = itemId;
  const inp = document.getElementById('dishware-photo-input');
  inp.value = '';
  inp.click();
}
async function onDishwarePhotoPicked(input) {
  const file = input.files && input.files[0];
  const itemId = dishwarePhotoItemId;
  if(!file || !itemId) return;
  showToast(t('dish.uploading'));
  try {
    // 400px хватает и на миниатюру в списке, и на просмотр в карточке, а снимок
    // с телефона ужимается с мегабайтов до десятков килобайт
    const fileToUpload = await compressImage(file, 400, 0.6);
    const ext = fileToUpload.type.startsWith('image') ? 'jpg' : (file.name.split('.').pop()||'jpg');
    // Папка dishware/ намеренно: очистка медиа в админке смотрит только корень
    // бакета, так что фото каталога не пропадут вместе со старыми отчётами
    const path = `dishware/${itemId}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('task-reports').upload(path, fileToUpload);
    if(upErr) { showToast(t('common.uploadErr')+upErr.message); return; }
    const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
    const prev = dishwareStock.find(x=>x.id===itemId);
    const { error: updErr } = await sb.from('dishware_items').update({ photo_url: urlData.publicUrl }).eq('id', itemId);
    if(updErr) { showToast(t('common.error')+updErr.message); return; }
    // Прошлый снимок больше не нужен — иначе они копятся в хранилище
    const old = prev && prev.photo_url && prev.photo_url.match(/dishware\/[^/?#]+$/);
    if(old) await sb.storage.from('task-reports').remove([old[0]]);
    if(prev) prev.photo_url = urlData.publicUrl;
    showToast(t('dish.photoUpdated'));
    renderDishwareStock();
    if(document.getElementById('modal-dishware-history').classList.contains('open')) openDishwareHistory(itemId);
  } catch(e) { showToast(t('common.error')+e.message); }
  finally { dishwarePhotoItemId = null; input.value = ''; }
}

// Приход
async function openDishwareIn(itemId) {
  if(!dishwareCanManage()) return;
  const { data: it } = await sb.from('dishware_items').select('*').eq('id', itemId).single();
  if(!it) return showToast(t('common.loadErrConn'));
  document.getElementById('dishware-in-item-id').value = itemId;
  document.getElementById('dishware-in-item-name').textContent = it.name;
  document.getElementById('dishware-in-qty').value = '';
  document.getElementById('dishware-in-cost').value = '';
  openModal('modal-dishware-in');
}
async function saveDishwareIn() {
  const itemId = parseInt(document.getElementById('dishware-in-item-id').value);
  const qty = parseFloat(document.getElementById('dishware-in-qty').value);
  const newCost = document.getElementById('dishware-in-cost').value;
  if(!qty || qty<=0) return showToast(t('inv.enterQty'));
  try {
    const { data: it } = await sb.from('dishware_items').select('*').eq('id', itemId).single();
    const updatedQty = Number(it.qty||0) + qty;
    const upd = { qty: updatedQty };
    if(newCost!=='' && !isNaN(parseFloat(newCost))) upd.cost = parseFloat(newCost);
    await sb.from('dishware_items').update(upd).eq('id', itemId);
    await sb.from('dishware_moves').insert({
      item_id: itemId, move_type:'in', qty, cost_at_moment: upd.cost!==undefined?upd.cost:it.cost,
      filial: currentFilial, user_id: currentUser.id, user_name: currentProfile?.name||currentUser?.email
    });
    closeModal('modal-dishware-in');
    closeModal('modal-dishware-history');
    showToast(t('dish.receivedIn',{n:dishwareFmt(qty)}));
    loadDishwareStock();
  } catch(e) { showToast(t('common.error')+e.message); }
}

// Бой
async function openDishwareBreak(itemId) {
  const { data: it } = await sb.from('dishware_items').select('*').eq('id', itemId).single();
  // См. openSupplyOut: без проверки обрыв связи давал падение на it.name и немую кнопку.
  if(!it) return showToast(t('common.loadErrConn'));
  document.getElementById('dishware-break-item-id').value = itemId;
  document.getElementById('dishware-break-thumb').innerHTML = dishwareThumb(it, 48);
  document.getElementById('dishware-break-item-name').textContent = it.name;
  document.getElementById('dishware-break-stock').textContent = t('inv.remaining') + ' ' + dishwareFmt(it.qty) + ' ' + t('dish.pcs') + ' · ' + formatNum(it.cost) + ' ' + t('dish.perPcs');
  document.getElementById('dishware-break-qty').value = '';
  document.getElementById('dishware-break-note').value = '';
  // Список сотрудников филиала
  const { data: allEmps } = await sb.from('employees').select('id,name,filials').order('name');
  const emps = (allEmps||[]).filter(e => (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));
  const sel = document.getElementById('dishware-break-who');
  sel.innerHTML = `<option value="">${t('dish.selectEmp')}</option>` + emps.map(e=>`<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join('');
  openModal('modal-dishware-break');
}
async function saveDishwareBreak() {
  const itemId = parseInt(document.getElementById('dishware-break-item-id').value);
  const qty = parseFloat(document.getElementById('dishware-break-qty').value);
  const who = document.getElementById('dishware-break-who').value;
  const note = document.getElementById('dishware-break-note').value.trim();
  if(!qty || qty<=0) return showToast(t('inv.enterQty'));
  try {
    const { data: it } = await sb.from('dishware_items').select('*').eq('id', itemId).single();
    const newQty = Number(it.qty||0) - qty;
    await sb.from('dishware_items').update({ qty: newQty }).eq('id', itemId);
    await sb.from('dishware_moves').insert({
      item_id: itemId, move_type:'break', qty, cost_at_moment: it.cost,
      filial: currentFilial, user_id: currentUser.id,
      user_name: who || (currentProfile?.name||currentUser?.email), note: note||null
    });
    const loss = qty * Number(it.cost||0);
    closeModal('modal-dishware-break');
    closeModal('modal-dishware-history');
    showToast(t('dish.breakRecorded',{n:dishwareFmt(qty),loss:formatNum(Math.round(loss))}));
    loadDishwareStock();
  } catch(e) { showToast(t('common.error')+e.message); }
}

// Карточка позиции: фото, остаток и история движений
async function openDishwareHistory(itemId) {
  openModal('modal-dishware-history');
  const body = document.getElementById('dishware-history-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data: it } = await sb.from('dishware_items').select('*').eq('id', itemId).single();
    if(!it) { body.innerHTML=`<div class="empty"><div class="empty-text">${t('common.loadErr')}</div></div>`; return; }
    const cached = dishwareStock.find(x=>x.id===itemId);
    if(cached) Object.assign(cached, it); else dishwareStock.push(it);
    document.getElementById('dishware-history-title').textContent = it.name;

    // Карточка позиции — второй путь к остатку, его тоже закрываем на время
    // пересчёта, иначе прятать число в списке бессмысленно
    const hideQty = !!dishwareInv && !dishwareCanManage();
    const head = `<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
        ${dishwareThumb(it, 64)}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--text-muted)">${escapeHtml(dishwareCatLabel(it.category))}</div>
          ${hideQty
            ? `<div style="font-size:14px;color:var(--text-muted)">🔒 ${t('dinv.qtyHidden')}</div>`
            : `<div style="font-size:14px;color:var(--text-primary)">${t('inv.remaining')} <b>${dishwareFmt(it.qty)} ${t('dish.pcs')}</b>${dishwareCanManage()?` · ${formatNum(it.cost)} ${t('dish.perPcs')}`:''}</div>`}
        </div>
      </div>
      ${dishwareCanManage()?`<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button onclick="openDishwareItemModal(${it.id})" style="flex:1;min-width:96px;background:var(--surface-2);color:var(--text-primary);border:none;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer">${t('dish.edit')}</button>
        <button onclick="pickDishwarePhoto(${it.id})" style="flex:1;min-width:96px;background:var(--surface-2);color:var(--text-primary);border:none;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer">${t('dish.photo')}</button>
        <button onclick="openDishwareIn(${it.id})" style="flex:1;min-width:96px;background:#e2efda;color:#3B6D11;border:none;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer">${t('inv.inBtn')}</button>
      </div>`:''}
      <div class="section-label">${t('dish.moves')}</div>`;

    const { data: moves } = await sb.from('dishware_moves').select('*').eq('item_id', itemId).eq('filial', currentFilial).order('created_at',{ascending:false}).limit(60);
    if(!moves || moves.length===0) { body.innerHTML = head + `<div class="empty"><div class="empty-text">${t('inv.noMoves')}</div></div>`; return; }
    body.innerHTML = head + moves.map(m=>{
      const isBreak = m.move_type==='break';
      const isInv = m.move_type==='inventory';
      const loss = isBreak ? Number(m.qty)*Number(m.cost_at_moment||0) : 0;
      // У инвентаризации qty — это разница, со своим знаком: недостача пишется
      // минусом, излишек плюсом, поэтому знак не подставляем, а берём из числа
      const qtyTxt = isInv
        ? `📋 ${Number(m.qty)>0?'+':''}${dishwareFmt(m.qty)}`
        : `${isBreak?'💥 −':'📥 +'}${dishwareFmt(m.qty)}`;
      return `<div class="list-item">
        <div class="item-info">
          <div class="item-name">${qtyTxt} ${t('dish.pcs')}${isBreak&&dishwareCanManage()?' · −'+formatNum(Math.round(loss))+' '+t('common.sum'):''}</div>
          <div class="item-sub">${new Date(m.created_at).toLocaleDateString('ru-RU')} · ${escapeHtml(m.user_name||'')}${m.note?' · '+escapeHtml(m.note):''}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { body.innerHTML=`<div class="empty"><div class="empty-text">${t('common.loadErr')}</div></div>`; }
}

// Отчёт боя за период
async function loadDishwareReport() {
  const content = document.getElementById('dishware-content');
  const now = new Date();
  const defFrom = ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = ymdLocal(now);
  content.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div style="flex:1;min-width:120px"><label class="form-label">${t('inv.from')}</label><input class="form-input" type="date" id="dishware-rep-from" value="${defFrom}"></div>
        <div style="flex:1;min-width:120px"><label class="form-label">${t('inv.to')}</label><input class="form-input" type="date" id="dishware-rep-to" value="${defTo}"></div>
        <button class="btn btn-primary" style="flex:0 0 auto;width:auto;padding:10px 16px" onclick="runDishwareReport()">${t('inv.show')}</button>
      </div>
    </div>
    <div id="dishware-report-result"></div>`;
  runDishwareReport();
}

async function runDishwareReport() {
  const from = document.getElementById('dishware-rep-from').value;
  const to = document.getElementById('dishware-rep-to').value;
  const res = document.getElementById('dishware-report-result');
  res.innerHTML = `<div class="loading">${t('hr.calculating')}</div>`;
  try {
    const { data: items } = await sb.from('dishware_items').select('id,name,category,photo_url').eq('filial', currentFilial);
    const itemMap = {}; (items||[]).forEach(it=>itemMap[it.id]=it);
    const { data: moves } = await sb.from('dishware_moves').select('*').eq('filial', currentFilial).eq('move_type','break')
      .gte('created_at', from+'T00:00:00').lte('created_at', to+'T23:59:59');
    if(!moves || moves.length===0) { res.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('dish.noBreak')}</div></div></div>`; return; }

    // По позициям
    const byItem = {}; let totalQty=0, totalLoss=0;
    // По сотрудникам
    const byWho = {};
    moves.forEach(m=>{
      const loss = Number(m.qty)*Number(m.cost_at_moment||0);
      totalQty += Number(m.qty); totalLoss += loss;
      if(!byItem[m.item_id]) byItem[m.item_id]={qty:0,loss:0};
      byItem[m.item_id].qty += Number(m.qty); byItem[m.item_id].loss += loss;
      const w = m.user_name||'—';
      if(!byWho[w]) byWho[w]={qty:0,loss:0};
      byWho[w].qty += Number(m.qty); byWho[w].loss += loss;
    });

    const itemRows = Object.keys(byItem).map(id=>({
      name:(itemMap[id]&&itemMap[id].name)||t('inv.deleted'), item:itemMap[id], ...byItem[id]
    })).sort((a,b)=>b.loss-a.loss || b.qty-a.qty);
    const whoRows = Object.keys(byWho).map(w=>({name:w,...byWho[w]})).sort((a,b)=>b.qty-a.qty);

    res.innerHTML = `
      <div class="card" style="background:linear-gradient(135deg,#3a1f1f,#5a2d2d);border:none;color:#f5e9e9;text-align:center">
        <div style="font-size:12px;opacity:0.7">${t('dish.brokenPeriod',{f:getFilialName(currentFilial)})}</div>
        <div style="font-size:26px;font-weight:700;margin-top:4px">${dishwareFmt(totalQty)} ${t('dish.pcs')}</div>
        <div style="font-size:15px;opacity:0.85">${t('dish.loss',{n:formatNum(Math.round(totalLoss))})}</div>
      </div>
      <div class="card">
        <div class="section-label">${t('inv.byItems')}</div>
        ${itemRows.map(r=>`<div class="list-item" style="display:flex;align-items:center;gap:10px">${dishwareThumb(r.item, 36)}<div class="item-info"><div class="item-name">${escapeHtml(r.name)}</div><div class="item-sub">${dishwareFmt(r.qty)} ${t('dish.pcs')}${r.item&&r.item.category?' · '+escapeHtml(dishwareCatLabel(r.item.category)):''}</div></div><div style="font-weight:700;color:#A32D2D;white-space:nowrap">−${formatNum(Math.round(r.loss))}</div></div>`).join('')}
      </div>
      <div class="card">
        <div class="section-label">${t('dish.whoBreaks')}</div>
        ${whoRows.map((r,i)=>`<div class="list-item"><div class="item-info"><div class="item-name">${i===0?'🥇 ':''}${escapeHtml(r.name)}</div><div class="item-sub">${dishwareFmt(r.qty)} ${t('dish.pcs')} · −${formatNum(Math.round(r.loss))} ${t('common.sum')}</div></div></div>`).join('')}
      </div>`;
  } catch(e) { res.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('common.error')+e.message}</div></div></div>`; }
}

// ============ ИНВЕНТАРИЗАЦИЯ ============
// Управляющий открывает пересчёт, официанты вбивают фактическое количество
// вслепую (учётный остаток им не показывается), управляющий смотрит
// расхождения и утверждает. Остатки правятся только в момент утверждения —
// одной транзакцией на стороне базы (apply_dishware_inventory).

async function loadDishwareInventory() {
  const content = document.getElementById('dishware-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    await loadDishwareOpenInventory();
    if(!dishwareInv) { await renderDishwareInvIdle(); return; }
    const [{ data: items }, { data: counts }] = await Promise.all([
      sb.from('dishware_items').select('*').eq('filial', currentFilial).order('name'),
      sb.from('dishware_counts').select('*').eq('inventory_id', dishwareInv.id),
    ]);
    dishwareStock = items || [];
    dishwareCounts = {};
    (counts||[]).forEach(c => { dishwareCounts[c.item_id] = c; });
    renderDishwareInvActive();
  } catch(e) {
    content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('common.error')+e.message}</div></div></div>`;
  }
}

// Пересчёт не идёт: официанту сообщаем, что делать нечего, руководству даём кнопку
async function renderDishwareInvIdle() {
  const content = document.getElementById('dishware-content');
  content.innerHTML = dishwareCanManage()
    ? `<div class="card">
         <div class="card-title">📋 ${t('dinv.startTitle')}</div>
         <div style="font-size:13px;color:var(--text-muted);margin:8px 0 12px;line-height:1.5">${t('dinv.startDesc')}</div>
         <button class="btn btn-primary" onclick="startDishwareInventory()">${t('dinv.startBtn')}</button>
       </div>
       <div id="dishware-inv-history"></div>`
    : `<div class="card"><div class="empty"><div class="empty-icon">📋</div>
         <div class="empty-text">${t('dinv.notStarted')}<br><span style="font-size:12px">${t('dinv.notStartedHint')}</span></div></div></div>`;
  if(dishwareCanManage()) renderDishwareInvHistory();
}

async function renderDishwareInvHistory() {
  const el = document.getElementById('dishware-inv-history');
  if(!el) return;
  try {
    const { data } = await sb.from('dishware_inventories').select('*')
      .eq('filial', currentFilial).neq('status','open')
      .order('created_at', { ascending: false }).limit(10);
    if(!data || data.length===0) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="card"><div class="section-label">${t('dinv.history')}</div>${data.map(inv=>`
      <div class="list-item"><div class="item-info">
        <div class="item-name">${inv.status==='applied'?'✅':'✖️'} ${fmtLocale(new Date(inv.date+'T12:00:00'), {day:'numeric', month:'long', year:'numeric'})}</div>
        <div class="item-sub">${inv.status==='applied'?t('dinv.statusApplied'):t('dinv.statusCancelled')}${inv.closed_by_name?' · '+escapeHtml(inv.closed_by_name):''}</div>
      </div></div>`).join('')}</div>`;
  } catch(e) { el.innerHTML = ''; }
}

function dishwareInvProgress() {
  const total = dishwareStock.length;
  const done = dishwareStock.filter(it => dishwareCounts[it.id]).length;
  return { done, total, pct: total ? Math.round(done/total*100) : 0 };
}

function renderDishwareInvActive() {
  const content = document.getElementById('dishware-content');
  const p = dishwareInvProgress();
  const chips = [{ id:'', label:t('dinv.zoneAll') }].concat(DISHWARE_CATS.map(c=>({ id:c, label:dishwareCatLabel(c) })));

  content.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,#1a2e1a,#2b4a2b);border:none;color:#eef5ee">
      <div style="font-size:11px;opacity:0.75;margin-bottom:4px">${t('dinv.running')} · ${getFilialName(currentFilial)}</div>
      <div style="font-size:20px;font-weight:700">📋 ${fmtLocale(new Date(dishwareInv.date+'T12:00:00'), {day:'numeric', month:'long'})}</div>
      <!-- Тёмная карточка: стандартные цвета полоски (золото на светлом треке
           со светлой рамкой) на ней сливаются в одну белёсую линию -->
      <div class="progress-track" style="margin-top:10px;background:rgba(0,0,0,0.28);border:none"><div class="progress-fill" id="dinv-bar" style="width:${p.pct}%;background:#8fd694"></div></div>
      <div style="font-size:13px;opacity:0.85;margin-top:6px" id="dinv-progress">${t('dinv.progress',{done:p.done,total:p.total})}</div>
      ${dishwareInv.started_by_name?`<div style="font-size:11px;opacity:0.6;margin-top:4px">${t('dinv.startedBy',{name:escapeHtml(dishwareInv.started_by_name)})}</div>`:''}
      ${dishwareCanManage()?`<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button onclick="openDishwareDiff()" style="flex:1;min-width:140px;background:var(--gold);color:#1a1a1a;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:700;cursor:pointer">${t('dinv.diffBtn')}</button>
        <button onclick="cancelDishwareInventory()" style="background:rgba(255,255,255,0.14);color:#fff;border:none;border-radius:10px;padding:11px 14px;font-size:14px;cursor:pointer;flex:0 0 auto">${t('dinv.cancelBtn')}</button>
      </div>`:''}
    </div>
    ${!dishwareCanManage()?`<div class="card" style="background:#FFF8E6;border:1px solid #f0dfae"><div style="font-size:13px;color:#7a5c11;line-height:1.5">💡 ${t('dinv.blindHint')}</div></div>`:''}
    <div class="hscroll" style="display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px">
      ${chips.map(c=>`<button onclick="setDishwareInvZone('${escJsAttr(c.id)}')" style="flex:0 0 auto;padding:8px 14px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;background:${dishwareInvZone===c.id?'var(--gold-dark)':'var(--surface-2)'};color:${dishwareInvZone===c.id?'#fff':'var(--text-primary)'}">${escapeHtml(c.label)}</button>`).join('')}
    </div>
    <div class="card" style="padding:8px"><input class="form-input" id="dinv-search" placeholder="${t('dish.search')}" value="${escapeHtml(dishwareInvSearch)}" oninput="renderDishwareInvList()"></div>
    <div id="dinv-list"></div>`;
  renderDishwareInvList();
}

function setDishwareInvZone(zone) {
  dishwareInvZone = zone;
  renderDishwareInvActive();
}

// Список перерисовывается только целиком по фильтру/поиску. После сохранения
// одной позиции трогаем ровно её строку: перерисовка списка на каждую введённую
// цифру уводила бы экран в начало прямо посреди пересчёта.
function renderDishwareInvList() {
  const list = document.getElementById('dinv-list');
  if(!list) return;
  const inp = document.getElementById('dinv-search');
  dishwareInvSearch = inp ? inp.value : '';
  const q = dishwareInvSearch.trim().toLowerCase();

  let items = dishwareStock;
  if(dishwareInvZone) items = items.filter(it => (it.category||'') === dishwareInvZone);
  if(q) items = items.filter(it => (it.name||'').toLowerCase().includes(q));
  if(items.length===0) { list.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('dish.nothingFound')}</div></div></div>`; return; }

  list.innerHTML = items.map(it => {
    const c = dishwareCounts[it.id];
    return `<div class="card" id="dinv-row-${it.id}" style="display:flex;align-items:center;gap:10px;border-left:3px solid ${c?'#3B6D11':'transparent'}">
      ${dishwareThumb(it)}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(it.name)}</div>
        <div style="font-size:12px;margin-top:2px" id="dinv-sub-${it.id}">${dishwareCountSub(it.id)}</div>
      </div>
      <input type="number" inputmode="decimal" step="any" min="0" id="dinv-qty-${it.id}"
        value="${c ? dishwareFmt(c.qty) : ''}" placeholder="${t('dish.pcs')}"
        onchange="saveDishwareCount(${it.id}, this)"
        style="width:78px;flex:0 0 auto;text-align:center;font-size:17px;font-weight:700;padding:10px 6px;border-radius:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary)">
    </div>`;
  }).join('');
}

function dishwareCountSub(itemId) {
  const c = dishwareCounts[itemId];
  if(!c) return `<span style="color:var(--text-muted)">${t('dinv.notCountedYet')}</span>`;
  const when = new Date(c.updated_at || c.created_at);
  const time = isNaN(when) ? '' : ' · ' + when.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  return `<span style="color:#3B6D11">✅ ${escapeHtml(c.user_name||'')}${time}</span>`;
}

function refreshDishwareInvRow(itemId) {
  const sub = document.getElementById('dinv-sub-'+itemId);
  if(sub) sub.innerHTML = dishwareCountSub(itemId);
  const row = document.getElementById('dinv-row-'+itemId);
  if(row) row.style.borderLeftColor = dishwareCounts[itemId] ? '#3B6D11' : 'transparent';
  const p = dishwareInvProgress();
  const bar = document.getElementById('dinv-bar');
  if(bar) bar.style.width = p.pct + '%';
  const txt = document.getElementById('dinv-progress');
  if(txt) txt.textContent = t('dinv.progress', { done: p.done, total: p.total });
}

async function saveDishwareCount(itemId, input) {
  if(!dishwareInv) return showToast(t('dinv.notRunning'));
  const raw = String(input.value || '').trim().replace(',', '.');
  const sub = document.getElementById('dinv-sub-'+itemId);

  // Пустое поле — стереть свой пересчёт: ошиблись строкой, убрали цифру
  if(raw === '') {
    if(!dishwareCounts[itemId]) return;
    try {
      const { error } = await sb.from('dishware_counts').delete()
        .eq('inventory_id', dishwareInv.id).eq('item_id', itemId);
      if(error) throw error;
      delete dishwareCounts[itemId];
      refreshDishwareInvRow(itemId);
    } catch(e) { showToast(t('common.error')+e.message); }
    return;
  }

  const qty = parseFloat(raw);
  if(isNaN(qty) || qty < 0) {
    showToast(t('dinv.badQty'));
    input.value = dishwareCounts[itemId] ? dishwareFmt(dishwareCounts[itemId].qty) : '';
    return;
  }

  if(sub) sub.innerHTML = `<span style="color:var(--text-muted)">${t('dinv.saving')}</span>`;
  try {
    const it = dishwareStock.find(x => x.id === itemId);
    // expected_qty — снимок учётного остатка на момент ввода: если потом
    // возникнет спор «почему списали шесть», видно, от чего считали
    const { data, error } = await sb.from('dishware_counts').upsert({
      inventory_id: dishwareInv.id, item_id: itemId, qty,
      expected_qty: Number(it?.qty) || 0,
      user_name: currentProfile?.name || currentUser?.email,
    }, { onConflict: 'inventory_id,item_id' }).select().single();
    if(error) throw error;
    dishwareCounts[itemId] = data;
    refreshDishwareInvRow(itemId);
  } catch(e) {
    if(sub) sub.innerHTML = `<span style="color:#A32D2D">${t('dinv.saveErr')}</span>`;
    showToast(t('common.error')+e.message);
  }
}

async function startDishwareInventory() {
  if(!dishwareCanManage()) return showToast(t('common.observerMode'));
  try {
    const { data, error } = await sb.from('dishware_inventories').insert({
      filial: currentFilial,
      started_by: currentUser.id,
      started_by_name: currentProfile?.name || currentUser?.email,
    }).select().single();
    // 23505 — частичный уникальный индекс: кто-то уже открыл пересчёт с другого телефона
    if(error) return showToast(error.code === '23505' ? t('dinv.alreadyOpen') : t('common.error')+error.message);
    dishwareInv = data;
    showToast(t('dinv.startedToast'));
    notifyDishwareWaiters(`📋 <b>${t('dinv.tgStarted')}</b>\n\n📍 ${tgEscape(getFilialName(currentFilial))}\n👤 ${tgEscape(currentProfile?.name||'')}\n\n${tgEscape(t('dinv.tgStartedBody'))}`);
    loadDishwareInventory();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function cancelDishwareInventory() {
  if(!dishwareCanManage() || !dishwareInv) return;
  if(!await confirmDialog(t('dinv.cancelConfirm'), { title: t('dinv.cancelBtn'), okText: t('dinv.cancelOk') })) return;
  try {
    const { error } = await sb.from('dishware_inventories').update({
      status: 'cancelled', closed_at: new Date().toISOString(),
      closed_by: currentUser.id, closed_by_name: currentProfile?.name || currentUser?.email,
    }).eq('id', dishwareInv.id);
    if(error) return showToast(t('common.error')+error.message);
    dishwareInv = null; dishwareCounts = {};
    showToast(t('dinv.cancelled'));
    loadDishwareInventory();
  } catch(e) { showToast(t('common.error')+e.message); }
}

// Официантам филиала — «идёт пересчёт». Логика та же, что в го/стоп-листе:
// у сотрудника без филиалов их считаем оба.
async function notifyDishwareWaiters(msg) {
  try {
    const { data: emps } = await sb.from('employees').select('id,filials').eq('department','Официанты').neq('status','Уволен');
    const ids = (emps||[])
      .filter(e => (e.filials && e.filials.length ? e.filials : ['istikbol','chekhov']).includes(currentFilial))
      .map(e => e.id);
    if(ids.length === 0) return;
    const { data: profs } = await sb.from('profiles').select('user_id,telegram_id,notify_prefs').in('employee_id', ids);
    for(const p of (profs||[])) {
      if(p.user_id !== currentUser?.id && p.telegram_id && _wantsNotif(p.notify_prefs, 'dishware')) {
        await sendTelegram(p.telegram_id, msg);
      }
    }
  } catch(e) { console.error('notify inventory', e); }
}

// ===== Расхождения и утверждение =====
async function openDishwareDiff() {
  if(!dishwareCanManage() || !dishwareInv) return;
  openModal('modal-dishware-diff');
  const body = document.getElementById('dishware-diff-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    // Данные берём заново: пока считали, могли записать бой или добавить позицию
    const [{ data: items }, { data: counts }] = await Promise.all([
      sb.from('dishware_items').select('*').eq('filial', currentFilial),
      sb.from('dishware_counts').select('*').eq('inventory_id', dishwareInv.id),
    ]);
    const itemMap = {}; (items||[]).forEach(it => { itemMap[it.id] = it; });
    const rows = (counts||[]).map(c => {
      const it = itemMap[c.item_id];
      if(!it) return null;
      const was = Number(it.qty) || 0, now = Number(c.qty) || 0;
      return { it, was, now, diff: now - was, loss: (now - was) * (Number(it.cost) || 0), who: c.user_name };
    }).filter(r => r && r.diff !== 0).sort((a,b) => a.loss - b.loss || a.diff - b.diff);

    const notCounted = (items||[]).length - (counts||[]).length;
    if(!counts || counts.length === 0) {
      body.innerHTML = `<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">${t('dinv.nothingCounted')}</div></div>`;
      return;
    }

    const short = rows.filter(r => r.diff < 0), surp = rows.filter(r => r.diff > 0);
    const shortQty = short.reduce((s,r) => s - r.diff, 0), shortLoss = short.reduce((s,r) => s - r.loss, 0);
    const surpQty = surp.reduce((s,r) => s + r.diff, 0);

    body.innerHTML = `
      <div class="card" style="background:linear-gradient(135deg,#3a1f1f,#5a2d2d);border:none;color:#f5e9e9;text-align:center">
        <div style="font-size:12px;opacity:0.7">${t('dinv.shortage')}</div>
        <div style="font-size:26px;font-weight:700;margin-top:2px">${dishwareFmt(shortQty)} ${t('dish.pcs')}</div>
        <div style="font-size:15px;opacity:0.85">${t('dish.loss',{n:formatNum(Math.round(shortLoss))})}</div>
        ${surpQty>0?`<div style="font-size:13px;opacity:0.75;margin-top:6px">${t('dinv.surplus')}: +${dishwareFmt(surpQty)} ${t('dish.pcs')}</div>`:''}
      </div>
      ${notCounted>0?`<div class="card" style="background:#FFF8E6;border:1px solid #f0dfae"><div style="font-size:13px;color:#7a5c11;line-height:1.5">⚠️ ${t('dinv.notCountedWarn',{n:notCounted})}</div></div>`:''}
      <div class="card">
        <div class="section-label">${t('dinv.diffList',{n:rows.length})}</div>
        ${rows.length===0
          ? `<div class="empty"><div class="empty-text">${t('dinv.noDiff')}</div></div>`
          : rows.map(r=>`<div class="list-item" style="display:flex;align-items:center;gap:10px">
              ${dishwareThumb(r.it, 36)}
              <div class="item-info">
                <div class="item-name">${escapeHtml(r.it.name)}</div>
                <div class="item-sub">${t('dinv.wasNow',{was:dishwareFmt(r.was),now:dishwareFmt(r.now)})}${r.who?' · '+escapeHtml(r.who):''}</div>
              </div>
              <div style="font-weight:700;white-space:nowrap;color:${r.diff<0?'#A32D2D':'#3B6D11'}">${r.diff>0?'+':''}${dishwareFmt(r.diff)}</div>
            </div>`).join('')}
      </div>
      <button class="btn btn-primary" onclick="applyDishwareInventory()">${t('dinv.applyBtn')}</button>`;
  } catch(e) { body.innerHTML = `<div class="empty"><div class="empty-text">${t('common.error')+e.message}</div></div>`; }
}

async function applyDishwareInventory() {
  if(!dishwareCanManage() || !dishwareInv) return;
  // Окно расхождений закрываем до вопроса: у всех модалок один z-index, и
  // подтверждение, объявленное в разметке раньше, оказалось бы под ним
  closeModal('modal-dishware-diff');
  if(!await confirmDialog(t('dinv.applyConfirm'), { title: t('dinv.applyBtn'), okText: t('dinv.applyOk'), danger: false })) {
    openDishwareDiff();
    return;
  }
  try {
    // Одна транзакция в базе: остатки, движения и закрытие сессии либо
    // проходят целиком, либо не проходят вовсе
    const { data, error } = await sb.rpc('apply_dishware_inventory', { p_inventory_id: dishwareInv.id });
    if(error) return showToast(t('common.error')+error.message);
    const res = data || {};
    showToast(t('dinv.applied',{ n: res.changed || 0 }));
    const loss = Number(res.diff_loss) || 0;
    await notifyAdminsAll(`📋 <b>${t('dinv.tgApplied')}</b>\n\n📍 ${tgEscape(getFilialName(currentFilial))}\n👤 ${tgEscape(currentProfile?.name||'')}\n🔢 ${t('dinv.tgCounted',{n:res.counted||0,m:res.changed||0})}`
      + (loss<0?`\n💸 ${t('dish.loss',{n:formatNum(Math.round(-loss))})}`:''), 'dishware');
    dishwareInv = null; dishwareCounts = {};
    loadDishwareInventory();
  } catch(e) { showToast(t('common.error')+e.message); }
}
