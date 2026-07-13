// ============ ПОСУДА (DISHWARE) ============
let dishwareTab = 'stock';
function dishwareCanManage() { return canEditData(); }

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
  document.getElementById('dishware-subtitle').textContent = 'Филиал: ' + getFilialName(currentFilial);
  switchDishwareTab(dishwareTab);
}

function dishwareFmt(n){ n=Number(n)||0; return Number.isInteger(n)?String(n):n.toFixed(2).replace(/\.?0+$/,''); }

async function loadDishwareStock() {
  const content = document.getElementById('dishware-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const { data: items } = await sb.from('dishware_items').select('*').eq('filial', currentFilial).order('name');
    if(!items || items.length===0) {
      content.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">🍽️</div><div class="empty-text">Позиций пока нет'+(dishwareCanManage()?'.<br>Нажми «+ Позиция».':'')+'</div></div></div>';
      return;
    }
    // Итоговая стоимость склада
    const totalVal = items.reduce((s,it)=>s+Number(it.qty||0)*Number(it.cost||0),0);
    let html = dishwareCanManage() ? `<div class="card" style="text-align:center;padding:12px"><div style="font-size:12px;color:var(--text-muted)">Стоимость посуды на складе</div><div style="font-size:22px;font-weight:700;color:var(--text-primary)">${formatNum(Math.round(totalVal))} сум</div></div>` : '';

    html += items.map(it=>{
      const q = Number(it.qty)||0;
      const low = q<=0;
      return `<div class="card" style="display:flex;align-items:center;gap:12px">
        <div style="flex:1;cursor:pointer" onclick="openDishwareHistory(${it.id})">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(it.name)}</div>
          <div style="font-size:13px;color:${low?'#A32D2D':'var(--text-muted)'}">Остаток: <b>${dishwareFmt(q)} шт</b>${dishwareCanManage()?` · ${formatNum(it.cost)} сум/шт`:''}</div>
        </div>
        <button onclick="openDishwareBreak(${it.id})" style="background:#FCEBEB;color:#A32D2D;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer">💥 Бой</button>
        ${dishwareCanManage()?`<button onclick="openDishwareIn(${it.id})" style="background:#e2efda;color:#3B6D11;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer">+ Приход</button>`:''}
      </div>`;
    }).join('');
    content.innerHTML = html;
  } catch(e) { content.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка. Возможно, учёт посуды ещё не настроен в Supabase.</div></div></div>'; }
}

// Новая позиция
function openDishwareItemModal() {
  if(!dishwareCanManage()) return;
  document.getElementById('dishware-item-name').value = '';
  document.getElementById('dishware-item-cost').value = '';
  document.getElementById('dishware-item-qty').value = '';
  document.getElementById('dishware-item-filial').textContent = '📍 Склад филиала: ' + getFilialName(currentFilial);
  openModal('modal-dishware-item');
}
async function saveDishwareItem() {
  const name = document.getElementById('dishware-item-name').value.trim();
  const cost = parseFloat(document.getElementById('dishware-item-cost').value)||0;
  const qty = parseFloat(document.getElementById('dishware-item-qty').value)||0;
  if(!name) return showToast('Введите название');
  try {
    await sb.from('dishware_items').insert({ name, cost, qty, filial: currentFilial });
    closeModal('modal-dishware-item');
    showToast('✅ Позиция создана');
    loadDishwareStock();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

// Приход
async function openDishwareIn(itemId) {
  if(!dishwareCanManage()) return;
  const { data: it } = await sb.from('dishware_items').select('*').eq('id', itemId).single();
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
  if(!qty || qty<=0) return showToast('Введите количество');
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
    showToast('✅ Оприходовано: '+dishwareFmt(qty)+' шт');
    loadDishwareStock();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

// Бой
async function openDishwareBreak(itemId) {
  const { data: it } = await sb.from('dishware_items').select('*').eq('id', itemId).single();
  document.getElementById('dishware-break-item-id').value = itemId;
  document.getElementById('dishware-break-item-name').textContent = it.name;
  document.getElementById('dishware-break-stock').textContent = 'Остаток: ' + dishwareFmt(it.qty) + ' шт · ' + formatNum(it.cost) + ' сум/шт';
  document.getElementById('dishware-break-qty').value = '';
  document.getElementById('dishware-break-note').value = '';
  // Список сотрудников филиала
  const { data: allEmps } = await sb.from('employees').select('id,name,filials').order('name');
  const emps = (allEmps||[]).filter(e => (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));
  const sel = document.getElementById('dishware-break-who');
  sel.innerHTML = '<option value="">— выберите сотрудника —</option>' + emps.map(e=>`<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join('');
  openModal('modal-dishware-break');
}
async function saveDishwareBreak() {
  const itemId = parseInt(document.getElementById('dishware-break-item-id').value);
  const qty = parseFloat(document.getElementById('dishware-break-qty').value);
  const who = document.getElementById('dishware-break-who').value;
  const note = document.getElementById('dishware-break-note').value.trim();
  if(!qty || qty<=0) return showToast('Введите количество');
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
    showToast('💥 Записан бой: '+dishwareFmt(qty)+' шт · −'+formatNum(Math.round(loss))+' сум');
    loadDishwareStock();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

// История позиции
async function openDishwareHistory(itemId) {
  openModal('modal-dishware-history');
  const body = document.getElementById('dishware-history-body');
  body.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const { data: it } = await sb.from('dishware_items').select('*').eq('id', itemId).single();
    document.getElementById('dishware-history-title').textContent = it.name;
    const { data: moves } = await sb.from('dishware_moves').select('*').eq('item_id', itemId).eq('filial', currentFilial).order('created_at',{ascending:false}).limit(60);
    if(!moves || moves.length===0) { body.innerHTML='<div class="empty"><div class="empty-text">Движений пока нет</div></div>'; return; }
    body.innerHTML = moves.map(m=>{
      const isBreak = m.move_type==='break';
      const loss = isBreak ? Number(m.qty)*Number(m.cost_at_moment||0) : 0;
      return `<div class="list-item">
        <div class="item-info">
          <div class="item-name">${isBreak?'💥 −':'📥 +'}${dishwareFmt(m.qty)} шт${isBreak&&dishwareCanManage()?' · −'+formatNum(Math.round(loss))+' сум':''}</div>
          <div class="item-sub">${new Date(m.created_at).toLocaleDateString('ru-RU')} · ${escapeHtml(m.user_name||'')}${m.note?' · '+escapeHtml(m.note):''}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { body.innerHTML='<div class="empty"><div class="empty-text">Ошибка</div></div>'; }
}

// Отчёт боя за период
async function loadDishwareReport() {
  const content = document.getElementById('dishware-content');
  const now = new Date();
  const defFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const defTo = now.toISOString().slice(0,10);
  content.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div style="flex:1;min-width:120px"><label class="form-label">С</label><input class="form-input" type="date" id="dishware-rep-from" value="${defFrom}"></div>
        <div style="flex:1;min-width:120px"><label class="form-label">По</label><input class="form-input" type="date" id="dishware-rep-to" value="${defTo}"></div>
        <button class="btn btn-primary" style="flex:0 0 auto;width:auto;padding:10px 16px" onclick="runDishwareReport()">Показать</button>
      </div>
    </div>
    <div id="dishware-report-result"></div>`;
  runDishwareReport();
}

async function runDishwareReport() {
  const from = document.getElementById('dishware-rep-from').value;
  const to = document.getElementById('dishware-rep-to').value;
  const res = document.getElementById('dishware-report-result');
  res.innerHTML = '<div class="loading">Считаю...</div>';
  try {
    const { data: items } = await sb.from('dishware_items').select('id,name').eq('filial', currentFilial);
    const itemMap = {}; (items||[]).forEach(it=>itemMap[it.id]=it.name);
    const { data: moves } = await sb.from('dishware_moves').select('*').eq('filial', currentFilial).eq('move_type','break')
      .gte('created_at', from+'T00:00:00').lte('created_at', to+'T23:59:59');
    if(!moves || moves.length===0) { res.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">За этот период боя нет 👍</div></div></div>'; return; }

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

    const itemRows = Object.keys(byItem).map(id=>({name:itemMap[id]||'(удалено)',...byItem[id]})).sort((a,b)=>b.loss-a.loss);
    const whoRows = Object.keys(byWho).map(w=>({name:w,...byWho[w]})).sort((a,b)=>b.qty-a.qty);

    res.innerHTML = `
      <div class="card" style="background:linear-gradient(135deg,#3a1f1f,#5a2d2d);border:none;color:#f5e9e9;text-align:center">
        <div style="font-size:12px;opacity:0.7">Разбито за период · ${getFilialName(currentFilial)}</div>
        <div style="font-size:26px;font-weight:700;margin-top:4px">${dishwareFmt(totalQty)} шт</div>
        <div style="font-size:15px;opacity:0.85">убыток ${formatNum(Math.round(totalLoss))} сум</div>
      </div>
      <div class="card">
        <div class="section-label">По позициям</div>
        ${itemRows.map(r=>`<div class="list-item"><div class="item-info"><div class="item-name">${escapeHtml(r.name)}</div><div class="item-sub">${dishwareFmt(r.qty)} шт</div></div><div style="font-weight:700;color:#A32D2D;white-space:nowrap">−${formatNum(Math.round(r.loss))}</div></div>`).join('')}
      </div>
      <div class="card">
        <div class="section-label">Кто бьёт (антирейтинг)</div>
        ${whoRows.map((r,i)=>`<div class="list-item"><div class="item-info"><div class="item-name">${i===0?'🥇 ':''}${escapeHtml(r.name)}</div><div class="item-sub">${dishwareFmt(r.qty)} шт · −${formatNum(Math.round(r.loss))} сум</div></div></div>`).join('')}
      </div>`;
  } catch(e) { res.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка: '+e.message+'</div></div></div>'; }
}

