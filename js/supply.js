// ============ ХОЗЧАСТЬ (SUPPLY) ============
let supplyTab = 'stock';
function supplyCanManage() { return canEditData(); }

function switchSupplyTab(tab) {
  supplyTab = tab;
  const s = document.getElementById('supply-tab-stock');
  const r = document.getElementById('supply-tab-report');
  if(s&&r){
    s.style.background = tab==='stock' ? 'var(--gold-dark)' : 'var(--surface-2)';
    s.style.color = tab==='stock' ? '#fff' : 'var(--text-primary)';
    r.style.background = tab==='report' ? 'var(--gold-dark)' : 'var(--surface-2)';
    r.style.color = tab==='report' ? '#fff' : 'var(--text-primary)';
  }
  if(tab==='stock') loadSupplyStock(); else loadSupplyReport();
}

async function loadSupply() {
  const addBtn = document.getElementById('supply-add-item-btn');
  if(addBtn) addBtn.style.display = supplyCanManage() ? 'block' : 'none';
  document.getElementById('supply-subtitle').textContent = getFilialName(currentFilial);
  switchSupplyTab(supplyTab);
}

// --- Остатки ---
async function loadSupplyStock() {
  const content = document.getElementById('supply-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data: items } = await sb.from('supply_items').select('*').eq('filial', currentFilial).order('name');
    if(!items || items.length===0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">🧴</div><div class="empty-text">${t('inv.noItems')}${supplyCanManage()?t('inv.addItemHint'):''}</div></div></div>`;
      return;
    }
    // Остатки: сумма qty_left по партиям каждой позиции
    const { data: batches } = await sb.from('supply_batches').select('item_id,qty_left,unit_price').eq('filial', currentFilial);
    const stock = {};      // item_id -> кол-во
    const stockVal = {};   // item_id -> стоимость остатка
    (batches||[]).forEach(b=>{
      stock[b.item_id] = (stock[b.item_id]||0) + Number(b.qty_left);
      stockVal[b.item_id] = (stockVal[b.item_id]||0) + Number(b.qty_left)*Number(b.unit_price);
    });

    content.innerHTML = items.map(it=>{
      const q = stock[it.id]||0;
      const val = stockVal[it.id]||0;
      const low = q <= 0;
      return `<div class="card" style="display:flex;align-items:center;gap:12px">
        <div style="flex:1;cursor:pointer" onclick="openSupplyHistory(${it.id})">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(it.name)}</div>
          <div style="font-size:13px;color:${low?'#A32D2D':'var(--text-muted)'}">${t('inv.remaining')} <b>${formatSupplyQty(q)} ${escapeHtml(it.unit)}</b>${supplyCanManage()&&val>0?` · ${formatNum(Math.round(val))} ${t('common.sum')}`:''}</div>
        </div>
        ${!isBoss()?`<button onclick="openSupplyOut(${it.id})" style="background:#f0e6d2;color:#8a6a2f;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer">${t('sup.takeBtn')}</button>`:''}
        ${supplyCanManage()?`<button onclick="openSupplyIn(${it.id})" style="background:#e2efda;color:#3B6D11;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer">${t('inv.inBtn')}</button>`:''}
      </div>`;
    }).join('');
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('sup.errNotSetup')}</div></div></div>`; }
}

function formatSupplyQty(n) {
  n = Number(n)||0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/,'');
}

// --- Новая позиция ---
function openSupplyItemModal() {
  if(!supplyCanManage()) return;
  document.getElementById('supply-item-name').value = '';
  document.getElementById('supply-item-unit').value = 'л';
  document.getElementById('supply-item-filial').textContent = t('inv.warehouseFilial') + getFilialName(currentFilial);
  openModal('modal-supply-item');
}
async function saveSupplyItem() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const name = document.getElementById('supply-item-name').value.trim();
  const unit = document.getElementById('supply-item-unit').value;
  if(!name) return showToast(t('inv.enterName'));
  try {
    await sb.from('supply_items').insert({ name, unit, filial: currentFilial });
    closeModal('modal-supply-item');
    showToast(t('inv.itemCreated'));
    loadSupplyStock();
  } catch(e) { showToast(t('common.error')+e.message); }
}

// --- Приход ---
async function openSupplyIn(itemId) {
  if(!supplyCanManage()) return;
  const { data: it } = await sb.from('supply_items').select('*').eq('id', itemId).single();
  document.getElementById('supply-in-item-id').value = itemId;
  document.getElementById('supply-in-item-name').textContent = it.name;
  document.getElementById('supply-in-unit').textContent = it.unit;
  document.getElementById('supply-in-unit2').textContent = it.unit;
  document.getElementById('supply-in-qty').value = '';
  document.getElementById('supply-in-price').value = '';
  document.getElementById('supply-in-note').value = '';
  openModal('modal-supply-in');
}
async function saveSupplyIn() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const itemId = document.getElementById('supply-in-item-id').value;
  const qty = parseFloat(document.getElementById('supply-in-qty').value);
  const price = parseFloat(document.getElementById('supply-in-price').value);
  const note = document.getElementById('supply-in-note').value.trim();
  if(!qty || qty<=0) return showToast(t('inv.enterQty'));
  if(isNaN(price) || price<0) return showToast(t('sup.enterPrice'));
  try {
    await sb.from('supply_batches').insert({
      item_id: parseInt(itemId), qty_in: qty, qty_left: qty, unit_price: price,
      filial: currentFilial, note: note||null, created_by: currentUser.id
    });
    closeModal('modal-supply-in');
    showToast(t('sup.receivedIn',{n:formatSupplyQty(qty)}));
    loadSupplyStock();
  } catch(e) { showToast(t('common.error')+e.message); }
}

// --- Расход (списание по FIFO) ---
async function openSupplyOut(itemId) {
  const { data: it } = await sb.from('supply_items').select('*').eq('id', itemId).single();
  const { data: batches } = await sb.from('supply_batches').select('qty_left').eq('item_id', itemId).eq('filial', currentFilial);
  const stock = (batches||[]).reduce((s,b)=>s+Number(b.qty_left),0);
  document.getElementById('supply-out-item-id').value = itemId;
  document.getElementById('supply-out-item-name').textContent = it.name;
  document.getElementById('supply-out-unit').textContent = it.unit;
  document.getElementById('supply-out-stock').textContent = t('inv.remaining') + ' ' + formatSupplyQty(stock) + ' ' + it.unit;
  document.getElementById('supply-out-qty').value = '';
  document.getElementById('supply-out-note').value = '';
  openModal('modal-supply-out');
}
async function saveSupplyOut() {
  if(isBoss()) return showToast(t('common.observerMode'));
  const itemId = parseInt(document.getElementById('supply-out-item-id').value);
  let qty = parseFloat(document.getElementById('supply-out-qty').value);
  const note = document.getElementById('supply-out-note').value.trim();
  if(!qty || qty<=0) return showToast(t('inv.enterQty'));
  try {
    // Берём партии по возрасту (FIFO — сначала самые старые)
    const { data: batches } = await sb.from('supply_batches').select('*').eq('item_id', itemId).eq('filial', currentFilial).gt('qty_left', 0).order('created_at',{ascending:true});
    const available = (batches||[]).reduce((s,b)=>s+Number(b.qty_left),0);
    if(qty > available) return showToast(t('sup.notEnough',{n:formatSupplyQty(available)}));

    let remaining = qty;
    let cost = 0;
    for(const b of (batches||[])) {
      if(remaining<=0) break;
      const take = Math.min(remaining, Number(b.qty_left));
      cost += take * Number(b.unit_price);
      const newLeft = Number(b.qty_left) - take;
      await sb.from('supply_batches').update({ qty_left: newLeft }).eq('id', b.id);
      remaining -= take;
    }

    await sb.from('supply_moves').insert({
      item_id: itemId, qty, cost, filial: currentFilial,
      user_id: currentUser.id, user_name: currentProfile?.name||currentUser?.email, note: note||null
    });

    closeModal('modal-supply-out');
    showToast(t('sup.writtenOff',{n:formatSupplyQty(qty)}));
    loadSupplyStock();
  } catch(e) { showToast(t('common.error')+e.message); }
}

// --- История позиции ---
async function openSupplyHistory(itemId) {
  openModal('modal-supply-history');
  const body = document.getElementById('supply-history-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data: it } = await sb.from('supply_items').select('*').eq('id', itemId).single();
    document.getElementById('supply-history-title').textContent = it.name;
    const { data: moves } = await sb.from('supply_moves').select('*').eq('item_id', itemId).eq('filial', currentFilial).order('created_at',{ascending:false}).limit(50);
    const { data: batches } = await sb.from('supply_batches').select('*').eq('item_id', itemId).eq('filial', currentFilial).order('created_at',{ascending:false}).limit(50);

    let html = '';
    if(supplyCanManage()) {
      html += `<div class="section-label">${t('sup.purchases')}</div>`;
      if(!batches || batches.length===0) html += `<div style="font-size:13px;color:var(--text-muted);padding:8px">${t('inv.nothingYet')}</div>`;
      else html += batches.map(b=>`<div class="list-item"><div class="item-info"><div class="item-name">+${formatSupplyQty(b.qty_in)} ${escapeHtml(it.unit)} · ${formatNum(b.unit_price)} ${t('common.sum')}/${escapeHtml(it.unit)}</div><div class="item-sub">${new Date(b.created_at).toLocaleDateString('ru-RU')} · ${t('inv.leftover')} ${formatSupplyQty(b.qty_left)}${b.note?' · '+escapeHtml(b.note):''}</div></div></div>`).join('');
    }
    html += `<div class="section-label">${t('sup.writeoffs')}</div>`;
    if(!moves || moves.length===0) html += `<div style="font-size:13px;color:var(--text-muted);padding:8px">${t('inv.nothingYet')}</div>`;
    else html += moves.map(m=>`<div class="list-item"><div class="item-info"><div class="item-name">−${formatSupplyQty(m.qty)} ${escapeHtml(it.unit)}${supplyCanManage()?' · '+formatNum(Math.round(m.cost))+' '+t('common.sum'):''}</div><div class="item-sub">${new Date(m.created_at).toLocaleDateString('ru-RU')} · ${escapeHtml(m.user_name||'')}${m.note?' · '+escapeHtml(m.note):''}</div></div></div>`).join('');
    body.innerHTML = html;
  } catch(e) { body.innerHTML = `<div class="empty"><div class="empty-text">${t('common.loadErr')}</div></div>`; }
}

// --- Отчёт расхода за период ---
async function loadSupplyReport() {
  const content = document.getElementById('supply-content');
  const now = new Date();
  const defFrom = ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = ymdLocal(now);
  content.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div style="flex:1;min-width:120px"><label class="form-label">${t('inv.from')}</label><input class="form-input" type="date" id="supply-rep-from" value="${defFrom}"></div>
        <div style="flex:1;min-width:120px"><label class="form-label">${t('inv.to')}</label><input class="form-input" type="date" id="supply-rep-to" value="${defTo}"></div>
        <button class="btn btn-primary" style="flex:0 0 auto;width:auto;padding:10px 16px" onclick="runSupplyReport()">${t('inv.show')}</button>
      </div>
    </div>
    <div id="supply-report-result"></div>`;
  runSupplyReport();
}

async function runSupplyReport() {
  const from = document.getElementById('supply-rep-from').value;
  const to = document.getElementById('supply-rep-to').value;
  const res = document.getElementById('supply-report-result');
  res.innerHTML = `<div class="loading">${t('hr.calculating')}</div>`;
  try {
    const { data: items } = await sb.from('supply_items').select('*').eq('filial', currentFilial);
    const itemMap = {}; (items||[]).forEach(it=>itemMap[it.id]=it);
    const { data: moves } = await sb.from('supply_moves').select('*').eq('filial', currentFilial)
      .gte('created_at', from+'T00:00:00').lte('created_at', to+'T23:59:59');

    if(!moves || moves.length===0) { res.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('sup.noWriteoffs')}</div></div></div>`; return; }

    const agg = {}; // item_id -> {qty, cost}
    moves.forEach(m=>{
      if(!agg[m.item_id]) agg[m.item_id]={qty:0,cost:0};
      agg[m.item_id].qty += Number(m.qty);
      agg[m.item_id].cost += Number(m.cost);
    });
    let totalCost = 0;
    const rows = Object.keys(agg).map(id=>{
      const it = itemMap[id] || {name:t('inv.deleted'),unit:''};
      totalCost += agg[id].cost;
      return { name: it.name, unit: it.unit, qty: agg[id].qty, cost: agg[id].cost };
    }).sort((a,b)=>b.cost-a.cost);

    res.innerHTML = `<div class="card">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${t('sup.spentPeriod',{from:new Date(from).toLocaleDateString('ru-RU'),to:new Date(to).toLocaleDateString('ru-RU'),f:getFilialName(currentFilial)})}</div>
      ${rows.map(r=>`<div class="list-item"><div class="item-info"><div class="item-name">${escapeHtml(r.name)}</div><div class="item-sub">${formatSupplyQty(r.qty)} ${escapeHtml(r.unit)}</div></div><div style="font-weight:700;color:var(--text-primary);white-space:nowrap">${formatNum(Math.round(r.cost))} ${t('common.sum')}</div></div>`).join('')}
      <div class="list-item" style="border-top:2px solid var(--border);margin-top:6px"><div class="item-info"><div class="item-name">${t('inv.totalSpent')}</div></div><div style="font-weight:700;font-size:16px;color:var(--gold-dark);white-space:nowrap">${formatNum(Math.round(totalCost))} ${t('common.sum')}</div></div>
    </div>`;
  } catch(e) { res.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('common.error')+e.message}</div></div></div>`; }
}

