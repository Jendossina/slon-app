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
async function openKassaModal() {
  const t = today();
  document.getElementById('kassa-date-display').textContent = '📅 ' + t + ' · ' + getFilialName(currentFilial);
  document.getElementById('kassa-existing-id').value = '';
  document.getElementById('kassa-amount').value = '';
  document.getElementById('kassa-hint').textContent = 'Загрузка...';
  openModal('modal-kassa');
  try {
    const { data } = await sb.from('finances').select('id,amount').eq('filial',currentFilial).eq('type','income').eq('category','Выручка').eq('date',t).order('id',{ascending:false}).limit(1);
    const existing = data && data[0];
    if(existing) {
      document.getElementById('kassa-existing-id').value = existing.id;
      document.getElementById('kassa-amount').value = existing.amount;
      document.getElementById('kassa-hint').textContent = 'Касса на сегодня уже внесена: '+formatNum(existing.amount)+' сум. Сохранение перезапишет её.';
    } else {
      document.getElementById('kassa-hint').textContent = 'Введите итоговую выручку за сегодня.';
    }
  } catch(e) { document.getElementById('kassa-hint').textContent = ''; }
}

async function saveKassa() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const raw = document.getElementById('kassa-amount').value;
  const amount = parseFloat(raw);
  if(!raw || isNaN(amount) || amount<0) return showToast('Введите сумму кассы');
  const existingId = document.getElementById('kassa-existing-id').value;
  try {
    let err;
    if(existingId) {
      ({ error: err } = await sb.from('finances').update({ amount }).eq('id', existingId));
    } else {
      ({ error: err } = await sb.from('finances').insert({ type:'income', amount, category:'Выручка', description:'Касса дня', date:today(), filial: currentFilial }));
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
  if(!confirm('Удалить эту операцию?')) return;
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

