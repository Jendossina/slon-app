async function loadFinance() {
  try {
    const { data: fins } = await sb.from('finances').select('*').eq('filial', currentFilial).order('date',{ascending:false});
    const income = (fins||[]).filter(f=>f.type==='income').reduce((s,f)=>s+Number(f.amount),0);
    const expense = (fins||[]).filter(f=>f.type==='expense').reduce((s,f)=>s+Number(f.amount),0);
    document.getElementById('finance-income').textContent = formatNum(income);
    document.getElementById('finance-expense').textContent = formatNum(expense);
    const profit = income-expense;
    const el = document.getElementById('finance-profit');
    el.textContent = formatNum(profit);
    el.className = 'stat-val '+(profit>=0?'finance-positive':'finance-negative');
    const list = document.getElementById('finance-list');
    if(!fins||fins.length===0) { list.innerHTML='<div class="empty"><div class="empty-icon">💰</div><div class="empty-text">Операций пока нет</div></div>'; return; }
    list.innerHTML = fins.slice(0,20).map(f=>`
      <div class="list-item">
        <div class="avatar ${f.type==='income'?'av-teal':'av-coral'}">${f.type==='income'?'↑':'↓'}</div>
        <div class="item-info"><div class="item-name">${escapeHtml(f.category||'')}</div><div class="item-sub">${escapeHtml(f.description||'')} · ${f.date||''}</div></div>
        <span style="font-weight:600;font-size:14px" class="${f.type==='income'?'finance-positive':'finance-negative'}">${f.type==='income'?'+':'−'}${formatNum(f.amount)}</span>
      </div>`).join('');
  } catch(e) { console.error(e); document.getElementById('finance-list').innerHTML = '<div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div>'; }
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

