async function loadFinance() {
  try {
    const { data: fins } = await sb.from('finances').select('*').eq('filial', currentFilial).order('date',{ascending:false}).order('id',{ascending:false});
    const all = fins||[];
    const income = all.filter(f=>f.type==='income').reduce((s,f)=>s+Number(f.amount),0);
    const expense = all.filter(f=>f.type==='expense').reduce((s,f)=>s+Number(f.amount),0);
    document.getElementById('finance-income').textContent = formatNum(income);
    document.getElementById('finance-expense').textContent = formatNum(expense);
    const profit = income-expense;
    const el = document.getElementById('finance-profit');
    el.textContent = formatNum(profit);
    el.className = 'stat-val '+(profit>=0?'finance-positive':'finance-negative');

    // Итоги за сегодня + быстрые кнопки
    const t = today();
    const todayIncome = all.filter(f=>f.type==='income' && f.date===t).reduce((s,f)=>s+Number(f.amount),0);
    const todayExpense = all.filter(f=>f.type==='expense' && f.date===t).reduce((s,f)=>s+Number(f.amount),0);
    const tiEl = document.getElementById('fin-today-income'); if(tiEl) tiEl.textContent = formatNum(todayIncome);
    const teEl = document.getElementById('fin-today-expense'); if(teEl) teEl.textContent = formatNum(todayExpense);
    const actions = document.getElementById('fin-quick-actions'); if(actions) actions.style.display = canEditData() ? 'flex' : 'none';

    const canEdit = canEditData();
    const list = document.getElementById('finance-list');
    if(all.length===0) { list.innerHTML='<div class="empty"><div class="empty-icon">💰</div><div class="empty-text">Операций пока нет.<br>Внесите кассу или расход выше.</div></div>'; return; }
    list.innerHTML = all.slice(0,30).map(f=>`
      <div class="list-item">
        <div class="avatar ${f.type==='income'?'av-teal':'av-coral'}">${f.type==='income'?'↑':'↓'}</div>
        <div class="item-info"><div class="item-name">${escapeHtml(f.category||'')}</div><div class="item-sub">${escapeHtml(f.description||'')}${f.description?' · ':''}${f.date||''}</div></div>
        <span style="font-weight:600;font-size:14px" class="${f.type==='income'?'finance-positive':'finance-negative'}">${f.type==='income'?'+':'−'}${formatNum(f.amount)}</span>
        ${canEdit?`<button onclick="deleteFinance(${f.id})" aria-label="Удалить" style="background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;padding:0 4px;margin-left:6px">✕</button>`:''}
      </div>`).join('');
  } catch(e) { console.error(e); document.getElementById('finance-list').innerHTML = '<div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div>'; }
}

// «Касса дня»: одна запись выручки на день — при повторном внесении перезаписываем,
// чтобы не задваивать выручку (иначе поедет ФОТ% и прибыль в дашборде).
function _kv(id){ const v=parseFloat(document.getElementById(id).value); return isNaN(v)?0:v; }
// Итог = наличные + карты + безнал; проставляем в поле «Итого», если не правят вручную
function recalcKassa() {
  const sum = _kv('kassa-cash') + _kv('kassa-card') + _kv('kassa-cashback');
  document.getElementById('kassa-amount').value = sum || '';
  return sum;
}

async function openKassaModal() {
  const t = today();
  document.getElementById('kassa-date-display').textContent = '📅 ' + t + ' · ' + getFilialName(currentFilial);
  ['kassa-existing-id','kassa-amount','kassa-cash','kassa-card','kassa-cashback','kassa-deposits','kassa-withdrawals','kassa-photo-url'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  document.getElementById('kassa-photo-preview').innerHTML = '';
  document.getElementById('kassa-scan-status').textContent = 'Сфоткайте Z-отчёт — суммы подставятся сами, останется сверить.';
  document.getElementById('kassa-hint').textContent = 'Загрузка...';
  openModal('modal-kassa');
  try {
    const { data } = await sb.from('finances').select('id,amount,breakdown,photo_url').eq('filial',currentFilial).eq('type','income').eq('category','Выручка').eq('date',t).order('id',{ascending:false}).limit(1);
    const existing = data && data[0];
    if(existing) {
      document.getElementById('kassa-existing-id').value = existing.id;
      document.getElementById('kassa-amount').value = existing.amount;
      const b = existing.breakdown || {};
      const set = (id,v)=>{ const e=document.getElementById(id); if(e && v!=null) e.value=v; };
      set('kassa-cash', b.cash); set('kassa-card', b.card); set('kassa-cashback', b.cashback);
      set('kassa-deposits', b.deposits); set('kassa-withdrawals', b.withdrawals);
      if(existing.photo_url) {
        document.getElementById('kassa-photo-url').value = existing.photo_url;
        document.getElementById('kassa-photo-preview').innerHTML = `<img src="${escapeHtml(existing.photo_url)}" style="max-width:100%;border-radius:10px;max-height:160px;object-fit:cover" onclick="viewReport('${escJsAttr(existing.photo_url)}','image')">`;
      }
      document.getElementById('kassa-hint').textContent = 'Касса на сегодня уже внесена: '+formatNum(existing.amount)+' сум. Сохранение перезапишет её.';
    } else {
      document.getElementById('kassa-hint').textContent = 'Введите выручку или считайте с чека.';
    }
  } catch(e) { document.getElementById('kassa-hint').textContent = ''; }
}

// «Считать с чека»: фото → хранилище → распознавание (Claude Vision) → подстановка сумм
function scanReceipt() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const status = document.getElementById('kassa-scan-status');
    status.textContent = '⏳ Загружаю фото...';
    try {
      const fileToUpload = await compressImage(file, 1600, 0.8);
      const path = `receipt-${Date.now()}.jpg`;
      const { error: upErr } = await sb.storage.from('task-reports').upload(path, fileToUpload);
      if(upErr) { status.textContent = 'Ошибка загрузки: '+upErr.message; return; }
      const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
      const photoUrl = urlData.publicUrl;
      document.getElementById('kassa-photo-url').value = photoUrl;
      document.getElementById('kassa-photo-preview').innerHTML = `<img src="${escapeHtml(photoUrl)}" style="max-width:100%;border-radius:10px;max-height:160px;object-fit:cover">`;
      status.textContent = '🔍 Распознаю чек...';
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData?.session?.access_token || SUPABASE_KEY;
      const res = await fetch('https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/read-receipt', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+token },
        body: JSON.stringify({ imageUrl: photoUrl })
      });
      const result = await res.json();
      if(!result.ok || !result.data) { status.textContent = '⚠️ Не удалось распознать. Впишите вручную.'; return; }
      const d = result.data;
      const set = (id,v)=>{ const el=document.getElementById(id); if(el && v!=null) el.value=v; };
      set('kassa-cash', d.cash); set('kassa-card', d.card); set('kassa-cashback', d.cashback);
      set('kassa-deposits', d.deposits); set('kassa-withdrawals', d.withdrawals);
      document.getElementById('kassa-amount').value = (d.total!=null ? d.total : recalcKassa());
      status.textContent = '✅ Распознано — проверьте и поправьте, если нужно.';
    } catch(err) { status.textContent = 'Ошибка: '+err.message; }
  };
  input.click();
}

async function saveKassa() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const raw = document.getElementById('kassa-amount').value;
  const amount = parseFloat(raw);
  if(!raw || isNaN(amount) || amount<0) return showToast('Введите сумму кассы');
  const breakdown = {
    cash: _kv('kassa-cash'), card: _kv('kassa-card'), cashback: _kv('kassa-cashback'),
    deposits: _kv('kassa-deposits'), withdrawals: _kv('kassa-withdrawals')
  };
  const photo_url = document.getElementById('kassa-photo-url').value || null;
  const parts = [];
  if(breakdown.cash) parts.push('нал '+formatNum(breakdown.cash));
  if(breakdown.card) parts.push('карты '+formatNum(breakdown.card));
  if(breakdown.cashback) parts.push('безнал '+formatNum(breakdown.cashback));
  const description = parts.length ? parts.join(' · ') : 'Касса дня';
  const existingId = document.getElementById('kassa-existing-id').value;
  try {
    let err;
    const row = { amount, breakdown, photo_url, description };
    if(existingId) {
      ({ error: err } = await sb.from('finances').update(row).eq('id', existingId));
    } else {
      ({ error: err } = await sb.from('finances').insert({ type:'income', category:'Выручка', date:today(), filial: currentFilial, ...row }));
    }
    if(err) return showToast('Ошибка: '+err.message);
    closeModal('modal-kassa');
    showToast('✅ Касса сохранена');
    loadFinance();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

function openExpenseModal() {
  document.getElementById('exp-date-display').textContent = '📅 ' + today() + ' · ' + getFilialName(currentFilial);
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-desc').value = '';
  openModal('modal-expense');
}

async function saveExpense() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const amount = parseFloat(document.getElementById('exp-amount').value);
  if(isNaN(amount) || amount<=0) return showToast('Введите сумму');
  try {
    const { error: err } = await sb.from('finances').insert({ type:'expense', amount, category:document.getElementById('exp-category').value, description:document.getElementById('exp-desc').value, date:today(), filial: currentFilial });
    if(err) return showToast('Ошибка: '+err.message);
    closeModal('modal-expense');
    showToast('✅ Расход добавлен');
    loadFinance();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function deleteFinance(id) {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  if(!await confirmDialog('Удалить эту операцию?')) return;
  try {
    const { error: err } = await sb.from('finances').delete().eq('id', id);
    if(err) return showToast('Ошибка: '+err.message);
    showToast('✅ Удалено');
    loadFinance();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function addFinance() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const amount = document.getElementById('fin-amount').value;
  if(!amount) return showToast('Введите сумму');
  try {
    await sb.from('finances').insert({ type:document.getElementById('fin-type').value, amount:parseFloat(amount), category:document.getElementById('fin-category').value, description:document.getElementById('fin-desc').value, date:today(), filial: currentFilial });
    closeModal('modal-add-finance');
    ['fin-amount','fin-desc'].forEach(id=>document.getElementById(id).value='');
    showToast('✅ Операция добавлена');
    loadFinance();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

