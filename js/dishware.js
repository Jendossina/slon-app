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

function switchDishwareTab(tab) {
  dishwareTab = tab;
  const s = document.getElementById('dishware-tab-stock');
  const r = document.getElementById('dishware-tab-report');
  if(s&&r){
    s.style.background = tab==='stock' ? 'var(--gold-dark)' : 'var(--surface-2)';
    s.style.color = tab==='stock' ? '#fff' : 'var(--text-primary)';
    r.style.background = tab==='report' ? 'var(--gold-dark)' : 'var(--surface-2)';
    r.style.color = tab==='report' ? '#fff' : 'var(--text-primary)';
  }
  if(tab==='stock') loadDishwareStock(); else loadDishwareReport();
}

async function loadDishware() {
  const addBtn = document.getElementById('dishware-add-item-btn');
  if(addBtn) addBtn.style.display = dishwareCanManage() ? 'block' : 'none';
  document.getElementById('dishware-subtitle').textContent = getFilialName(currentFilial);
  switchDishwareTab(dishwareTab);
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
    const { data: items } = await sb.from('dishware_items').select('*').eq('filial', currentFilial).order('name');
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

  list.innerHTML = known.concat(rest).map(cat=>{
    const rows = groups[cat].map(it=>{
      const q2 = Number(it.qty)||0;
      const low = q2<=0;
      return `<div class="card" style="display:flex;align-items:center;gap:10px">
        ${dishwareThumb(it)}
        <div style="flex:1;min-width:0;cursor:pointer" onclick="openDishwareHistory(${it.id})">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(it.name)}</div>
          <div style="font-size:13px;color:${low?'#A32D2D':'var(--text-muted)'}">${t('inv.remaining')} <b>${dishwareFmt(q2)} ${t('dish.pcs')}</b>${dishwareCanManage()?` · ${formatNum(it.cost)} ${t('dish.perPcs')}`:''}</div>
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

    const head = `<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
        ${dishwareThumb(it, 64)}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--text-muted)">${escapeHtml(dishwareCatLabel(it.category))}</div>
          <div style="font-size:14px;color:var(--text-primary)">${t('inv.remaining')} <b>${dishwareFmt(it.qty)} ${t('dish.pcs')}</b>${dishwareCanManage()?` · ${formatNum(it.cost)} ${t('dish.perPcs')}`:''}</div>
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
      const loss = isBreak ? Number(m.qty)*Number(m.cost_at_moment||0) : 0;
      return `<div class="list-item">
        <div class="item-info">
          <div class="item-name">${isBreak?'💥 −':'📥 +'}${dishwareFmt(m.qty)} ${t('dish.pcs')}${isBreak&&dishwareCanManage()?' · −'+formatNum(Math.round(loss))+' '+t('common.sum'):''}</div>
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
