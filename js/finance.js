let financeSelectedDate = null; // выбранный день (YYYY-MM-DD)

function onFinanceDateChange(v) { financeSelectedDate = v || today(); loadFinance(); }
function shiftFinanceDay(delta) {
  const d = new Date(financeSelectedDate || today());
  d.setDate(d.getDate() + delta);
  financeSelectedDate = ymdLocal(d);
  loadFinance();
}

async function loadFinance() {
  try {
    if(!financeSelectedDate) financeSelectedDate = businessToday();
    const sel = financeSelectedDate;
    const y = +sel.slice(0,4), m = +sel.slice(5,7);
    const monthStart = `${sel.slice(0,7)}-01`;
    // Последний день месяца. Собираем из локальных компонентов, а НЕ через toISOString(),
    // иначе на UTC+5 дата уезжает на день назад и последний день месяца выпадает из статистики.
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${sel.slice(0,7)}-${String(lastDay).padStart(2,'0')}`;
    const canEdit = canEditData();

    const dateInput = document.getElementById('finance-date'); if(dateInput) dateInput.value = sel;
    document.getElementById('finance-period').textContent = getFilialName(currentFilial);
    document.getElementById('finance-month-label').textContent =
      t('fin.monthDefault') + ' · ' + fmtLocale(new Date(sel), {month:'long',year:'numeric'});
    document.getElementById('finance-day-label').textContent =
      t('fin.dayDefault') + ' · ' + fmtLocale(new Date(sel), {weekday:'long',day:'numeric',month:'long'});

    // Финансы за выбранный месяц
    const { data: fins } = await sb.from('finances').select('*').eq('filial', currentFilial)
      .gte('date', monthStart).lte('date', monthEnd).order('date',{ascending:false}).order('id',{ascending:false});
    const all = fins||[];

    // --- Сводка за месяц ---
    const income = all.filter(f=>f.type==='income').reduce((s,f)=>s+Number(f.amount),0);
    const expense = all.filter(f=>f.type==='expense').reduce((s,f)=>s+Number(f.amount),0);
    const profit = income - expense;
    document.getElementById('finance-income').textContent = formatNum(income);
    document.getElementById('finance-expense').textContent = formatNum(expense);
    const pEl = document.getElementById('finance-profit');
    pEl.textContent = formatNum(profit);
    pEl.className = 'stat-val '+(profit>=0?'finance-positive':'finance-negative');

    // Посещаемость и средний чек за месяц
    const monthGuests = all.filter(f=>f.type==='income' && f.breakdown)
      .reduce((s,f)=>s+(Number(f.breakdown.guests)||0), 0);
    const monthAvg = monthGuests > 0 ? Math.round(income/monthGuests) : null;
    const visEl = document.getElementById('finance-month-visits');
    if(visEl) visEl.innerHTML = `<div class="card" style="display:flex;gap:8px">
      <div style="flex:1;text-align:center"><div class="stat-sub">${t('fin.guestsMonth')}</div><div style="font-size:22px;font-weight:800">${monthGuests || '—'}</div></div>
      <div style="flex:1;text-align:center;border-left:1px solid var(--border)"><div class="stat-sub">${t('fin.avgCheck')}</div><div style="font-size:22px;font-weight:800" class="finance-positive">${monthAvg!=null?formatNum(monthAvg):'—'}</div></div>
    </div>`;

    // Разбивка выручки по типам оплат за месяц
    const typeTotals = {};
    all.filter(f=>f.type==='income' && f.breakdown && Array.isArray(f.breakdown.lines)).forEach(f=>{
      f.breakdown.lines.forEach(l=>{ if(l && l.label) typeTotals[l.label] = (typeTotals[l.label]||0) + Number(l.amount||0); });
    });
    const typeRows = Object.entries(typeTotals).sort((a,b)=>b[1]-a[1]);
    const mbEl = document.getElementById('finance-month-breakdown');
    mbEl.innerHTML = typeRows.length ? `<div class="card">
      <div class="card-title" style="margin-bottom:6px">${t('fin.revByType')}</div>
      ${typeRows.map(([label,sum])=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:14px">
        <span style="color:var(--text-secondary)">${escapeHtml(label)}</span>
        <b class="finance-positive">${formatNum(sum)}</b></div>`).join('')}
    </div>` : '';

    // --- Детализация выбранного дня ---
    renderFinanceDay(sel, all, canEdit);

    // --- Операции за месяц ---
    const list = document.getElementById('finance-list');
    if(all.length===0) { list.innerHTML=`<div class="empty"><div class="empty-icon">💰</div><div class="empty-text">${t('fin.noOps')}</div></div>`; }
    else list.innerHTML = all.map(f=>`
      <div class="list-item">
        <div class="avatar ${f.type==='income'?'av-teal':'av-coral'}">${f.type==='income'?'↑':'↓'}</div>
        <div class="item-info"><div class="item-name">${escapeHtml(f.category||'')}</div><div class="item-sub">${escapeHtml(f.description||'')}${f.description?' · ':''}${f.date||''}</div></div>
        <span style="font-weight:600;font-size:14px" class="${f.type==='income'?'finance-positive':'finance-negative'}">${f.type==='income'?'+':'−'}${formatNum(f.amount)}</span>
        ${canEdit?`<button onclick="deleteFinance(${f.id})" aria-label="Удалить" style="background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;padding:0 4px;margin-left:6px">✕</button>`:''}
      </div>`).join('');
  } catch(e) { console.error(e); document.getElementById('finance-list').innerHTML = `<div class="empty"><div class="empty-text">${t('common.loadErrConn')}</div></div>`; }
}

// Карточка выбранного дня: касса с разбивкой + движение + расходы + кнопки (без модалок для просмотра)
function renderFinanceDay(sel, all, canEdit) {
  const card = document.getElementById('finance-day-card');
  const dayIncome = all.find(f=>f.type==='income' && f.category==='Выручка' && f.date===sel);
  const dayExpenses = all.filter(f=>f.type==='expense' && f.date===sel);
  const expSum = dayExpenses.reduce((s,f)=>s+Number(f.amount),0);
  const b = dayIncome?.breakdown || {};
  const lines = Array.isArray(b.lines) ? b.lines : [];

  let html = `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
    <div><div class="stat-sub">${t('fin.kassa')}</div><div style="font-size:24px;font-weight:800" class="finance-positive">${dayIncome?formatNum(dayIncome.amount):'—'}</div></div>
    <div style="text-align:right"><div class="stat-sub">${t('fin.expenses')}</div><div style="font-size:20px;font-weight:700" class="finance-negative">${expSum?('−'+formatNum(expSum)):'0'}</div></div>
  </div>`;

  if(dayIncome) {
    if(lines.length) html += `<div style="margin:6px 0 4px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px">${t('fin.payTypes')}</div>`
      + lines.map(l=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:14px"><span style="color:var(--text-secondary)">${escapeHtml(l.label||'')}</span><b>${formatNum(l.amount||0)}</b></div>`).join('');
    // Показываем только ненулевые значения — пустые поля кассы дают 0, их незачем выводить
    const mv = [];
    if(b.deposits) mv.push(`${t('fin.deposits')} <b class="finance-positive">${formatNum(b.deposits)}</b>`);
    if(b.withdrawals) mv.push(`${t('fin.withdrawals')} <b class="finance-negative">${formatNum(b.withdrawals)}</b>`);
    if(b.cash_expected) mv.push(`${t('fin.inCash')} <b>${formatNum(b.cash_expected)}</b>`);
    if(mv.length) html += `<div style="margin-top:8px;font-size:13px;color:var(--text-secondary)">${mv.join(' · ')}</div>`;
    // Гости и средний чек
    const guests = Number(b.guests) || 0;
    const avg = guests > 0 ? Math.round(Number(dayIncome.amount)/guests) : null;
    html += `<div style="display:flex;gap:8px;margin-top:10px">
      <div style="flex:1;background:var(--surface-2);border-radius:10px;padding:10px;text-align:center"><div class="stat-sub">${t('fin.guests')}</div><div style="font-size:18px;font-weight:700">${guests || '—'}</div></div>
      <div style="flex:1;background:var(--surface-2);border-radius:10px;padding:10px;text-align:center"><div class="stat-sub">${t('fin.avgCheck')}</div><div style="font-size:18px;font-weight:700" class="finance-positive">${avg!=null?formatNum(avg):'—'}</div></div>
    </div>`;
    if(dayIncome.photo_url) html += `<img src="${escapeHtml(dayIncome.photo_url)}" loading="lazy" decoding="async" onclick="viewReport('${escJsAttr(dayIncome.photo_url)}','image')" style="margin-top:10px;max-width:100%;border-radius:10px;max-height:140px;object-fit:cover;cursor:pointer">`;
  } else {
    html += `<div style="color:var(--text-muted);font-size:13px;padding:6px 0">${t('fin.noKassaDay')}</div>`;
  }

  if(dayExpenses.length) html += `<div style="margin:10px 0 4px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px">${t('fin.dayExpenses')}</div>`
    + dayExpenses.map(f=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:14px">
        <span style="color:var(--text-secondary)">${escapeHtml(f.description||f.category||t('fin.expenseFallback'))}</span>
        <span style="display:flex;align-items:center;gap:8px"><b class="finance-negative">−${formatNum(f.amount)}</b>${canEdit?`<button onclick="deleteFinance(${f.id})" style="background:none;border:none;color:var(--text-muted);font-size:15px;cursor:pointer">✕</button>`:''}</span></div>`).join('');

  if(canEdit) html += `<div style="display:flex;gap:8px;margin-top:12px">
    <button onclick="openKassaModal('${sel}')" style="flex:1;background:var(--gold-dark);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer">${dayIncome?t('fin.editKassa'):t('fin.enterKassa')}</button>
    <button onclick="openExpenseModal('${sel}')" style="flex:1;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer">${t('fin.expenseBtn')}</button>
  </div>`;

  card.innerHTML = html;
}

// «Касса дня»: одна запись выручки на день — при повторном внесении перезаписываем,
// чтобы не задваивать выручку (иначе поедет ФОТ% и прибыль в дашборде).
function _kv(id){ const v=parseFloat(document.getElementById(id).value); return isNaN(v)?0:v; }

// Гибкая разбивка: строки {название, сумма}. Добавляются вручную или из распознанного чека.
function kassaClearLines(){ document.getElementById('kassa-lines').innerHTML = ''; }
function kassaAddLine(label, amount) {
  const wrap = document.getElementById('kassa-lines');
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
  div.innerHTML = `
    <input class="form-input kassa-line-label" placeholder="Тип оплаты" value="${escapeHtml(label||'')}" style="flex:1;margin:0">
    <input class="form-input kassa-line-amount" type="number" inputmode="numeric" placeholder="0" value="${amount!=null?amount:''}" oninput="recalcKassa()" style="width:118px;margin:0">
    <button type="button" onclick="this.parentElement.remove();recalcKassa()" style="background:#FCEBEB;color:#A32D2D;border:none;border-radius:8px;width:34px;height:34px;flex:0 0 auto;cursor:pointer">✕</button>`;
  wrap.appendChild(div);
}
// Итог = сумма всех строк разбивки
function recalcKassa() {
  let sum = 0;
  document.querySelectorAll('.kassa-line-amount').forEach(i=>{ const v=parseFloat(i.value); if(!isNaN(v)) sum+=v; });
  document.getElementById('kassa-amount').value = sum || '';
  kassaCheckSums();
  updateAvgCheck();
  return sum;
}

// Средний чек = выручка ÷ гости (живой пересчёт в модалке)
function updateAvgCheck() {
  const amount = parseFloat(document.getElementById('kassa-amount').value);
  const guests = parseFloat(document.getElementById('kassa-guests').value);
  const el = document.getElementById('kassa-avg-check');
  if(!el) return;
  el.textContent = (guests > 0 && !isNaN(amount) && amount > 0) ? formatNum(Math.round(amount/guests)) : '—';
}

let kassaEditDate = null; // день, для которого редактируется касса

// ===== Карточка «Касса» на главной (менеджер и управляющий) =====
// Раздел «Финансы» скрыт (FINANCE_ENABLED), но кассу за день вносить надо:
// из неё дашборд считает выручку, средний чек и долю ФОТ. Карточка показывает
// сегодняшний кассовый день и дни прошлой недели, за которые кассы нет.
async function renderKassaCard() {
  const el = document.getElementById('home-kassa-card');
  if(!el) return;
  if(!canEditData()) { el.innerHTML = ''; return; }
  try {
    const day = businessToday();
    const from = new Date(day + 'T00:00:00'); from.setDate(from.getDate() - 7);
    const [{ data }, { data: exps }] = await Promise.all([
      sb.from('finances').select('date,amount,breakdown').eq('filial', currentFilial)
        .eq('type', 'income').eq('category', 'Выручка').gte('date', ymdLocal(from)).lte('date', day),
      sb.from('finances').select('id,amount,category,description').eq('filial', currentFilial)
        .eq('type', 'expense').eq('date', day).order('id'),
    ]);
    const expList = exps || [];
    const expSum = expList.reduce((s, x) => s + Number(x.amount || 0), 0);
    const byDate = {}; (data || []).forEach(r => { byDate[r.date] = r; });
    const missed = [];
    for(let d = new Date(from); ymdLocal(d) < day; d.setDate(d.getDate() + 1)) {
      if(!byDate[ymdLocal(d)]) missed.push(ymdLocal(d));
    }
    const cur = byDate[day];
    const g = cur && Number(cur.breakdown?.guests) || 0;
    const fmtD = s => fmtLocale(new Date(s + 'T00:00:00'), { day:'numeric', month:'short' });
    el.innerHTML = `<div class="card" style="margin-bottom:12px">
      <div class="card-title">💰 ${t('fin.cardTitle', { d: fmtD(day) })}</div>
      ${cur ? `<div style="font-size:20px;font-weight:700" class="finance-positive">${formatNum(cur.amount)}</div>
               <div style="font-size:12px;color:var(--text-muted)">${g ? t('fin.cardGuests', { g, a: formatNum(Math.round(cur.amount / g)) }) : t('fin.cardNoGuests')}</div>`
            : `<div style="font-size:12px;color:var(--text-muted)">${t('fin.cardHint')}</div>`}
      ${missed.length ? `<div style="font-size:12px;color:#A32D2D;margin-top:8px">${t('fin.cardMissed')}
          ${missed.map(d => `<button onclick="openKassaModal('${d}')" style="margin:4px 4px 0 0;background:#FCEBEB;color:#A32D2D;border:none;border-radius:8px;padding:5px 9px;font-size:12px;font-weight:600;cursor:pointer">${fmtD(d)}</button>`).join('')}</div>` : ''}
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-secondary)"><span>${t('fin.cardExpenses')}</span><b class="finance-negative">${expSum ? '−' + formatNum(expSum) : '0'}</b></div>
        ${expList.map(x => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-muted);padding:3px 0">
            <span>${escapeHtml(x.category || '')}${x.description ? ' · ' + escapeHtml(x.description) : ''}</span>
            <span style="display:flex;align-items:center;gap:6px">−${formatNum(x.amount)}<button onclick="deleteFinance(${x.id})" aria-label="Удалить" style="background:none;border:none;color:var(--text-muted);font-size:14px;cursor:pointer;padding:0 2px">✕</button></span></div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn ${cur ? 'btn-secondary' : 'btn-primary'}" onclick="openKassaModal('${day}')" style="flex:1;margin:0">${cur ? t('fin.cardEdit') : t('fin.cardAdd')}</button>
        <button class="btn btn-secondary" onclick="openExpenseModal('${day}')" style="flex:1;margin:0">${t('fin.cardExpenseBtn')}</button>
      </div>
    </div>`;
  } catch(e) { el.innerHTML = ''; }
}

// Локальную дату НЕ называем `t` — это имя занято функцией перевода t(),
// и её затенение здесь уже ломало кнопку «Внести кассу» (t is not a function).
async function openKassaModal(date) {
  const day = date || financeSelectedDate || businessToday();
  const di = document.getElementById('kassa-date'); if(di) di.value = day;
  document.getElementById('kassa-filial-label').textContent = getFilialName(currentFilial);
  document.getElementById('kassa-scan-status').textContent = tr('fin.scanHint');
  openModal('modal-kassa');
  await loadKassaForDate(day);
}

// Смена даты прямо в модалке — подгружаем кассу за выбранное число (или чистим форму)
function onKassaDateChange(v) { loadKassaForDate(v || businessToday()); }

// Что ещё считали с чеков, кроме выручки: изъятия (уходят расходами дня),
// списания и «оплачено как скидка» — для справки в разбивке кассы.
let kassaZ = { expenses: [], writeoffs: [], discounts: [] };

function renderKassaZ() {
  const el = document.getElementById('kassa-zexp');
  if(!el) return;
  const sum = a => a.reduce((s,x)=>s+(Number(x.amount)||0), 0);
  let html = '';
  if(kassaZ.expenses.length) {
    html += `<div class="form-label" style="margin:10px 0 4px">${t('fin.zExpenses')} · ${formatNum(sum(kassaZ.expenses))}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">${t('fin.zExpHint')}</div>`;
    html += kassaZ.expenses.map((x,i)=>`<div style="display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">${escapeHtml(x.label)}${x.who?` · <span style="color:var(--text-muted)">${escapeHtml(x.who)}</span>`:''}
          <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(x.category||'Прочее')}</div></div>
        <div style="white-space:nowrap">${formatNum(x.amount)}</div>
        <button type="button" onclick="kassaZRemove(${i})" style="background:none;border:none;color:var(--text-muted);font-size:15px;cursor:pointer;padding:2px 6px">✕</button>
      </div>`).join('');
  }
  const info = [];
  const wo = kassaZ.writeoffs.filter(x=>Number(x.amount));
  if(wo.length) info.push(`${t('fin.writeoffs')}: ${wo.map(x=>`${escapeHtml(x.label)} ${formatNum(x.amount)}`).join(', ')}`);
  const dc = kassaZ.discounts.filter(x=>Number(x.amount));
  if(dc.length) info.push(`${t('fin.discounts')}: ${dc.map(x=>`${escapeHtml(x.label)} ${formatNum(x.amount)}`).join(', ')}`);
  if(info.length) html += `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.6">${info.join('<br>')}</div>`;
  el.innerHTML = html;
  kassaCheckSums();
}
function kassaZRemove(i) { kassaZ.expenses.splice(i,1); renderKassaZ(); }

// Сверка: типы оплат должны дать итог, расходы — сумму изъятий. Не сходится —
// значит, ИИ ошибся в цифре или чек обрезан: пусть человек сверит глазами.
function kassaCheckSums() {
  const el = document.getElementById('kassa-sumcheck');
  if(!el) return;
  const warn = [];
  let lines = 0, any = false;
  document.querySelectorAll('.kassa-line-amount').forEach(i=>{ const v=parseFloat(i.value); if(!isNaN(v)) { lines+=v; any=true; } });
  const total = _kv('kassa-amount');
  if(any && total && Math.round(lines) !== Math.round(total)) warn.push(t('fin.mismatchLines',{a:formatNum(lines),b:formatNum(total)}));
  const wd = _kv('kassa-withdrawals');
  const ex = kassaZ.expenses.reduce((s,x)=>s+(Number(x.amount)||0), 0);
  if(kassaZ.expenses.length && wd && Math.round(ex) !== Math.round(wd)) warn.push(t('fin.mismatchExp',{a:formatNum(ex),b:formatNum(wd)}));
  el.innerHTML = warn.map(w=>`<div>${w}</div>`).join('');
}

async function loadKassaForDate(t) {
  kassaEditDate = t;
  kassaZ = { expenses: [], writeoffs: [], discounts: [] };
  renderKassaZ();
  ['kassa-existing-id','kassa-amount','kassa-deposits','kassa-withdrawals','kassa-expected','kassa-guests','kassa-photo-url'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  kassaClearLines();
  updateAvgCheck();
  document.getElementById('kassa-photo-preview').innerHTML = '';
  document.getElementById('kassa-hint').textContent = tr('common.loading');
  try {
    const { data } = await sb.from('finances').select('id,amount,breakdown,photo_url').eq('filial',currentFilial).eq('type','income').eq('category','Выручка').eq('date',t).order('id',{ascending:false}).limit(1);
    const existing = data && data[0];
    if(existing) {
      document.getElementById('kassa-existing-id').value = existing.id;
      document.getElementById('kassa-amount').value = existing.amount;
      const b = existing.breakdown || {};
      (b.lines || []).forEach(l => kassaAddLine(l.label, l.amount));
      const set = (id,v)=>{ const e=document.getElementById(id); if(e && v!=null) e.value=v; };
      set('kassa-deposits', b.deposits); set('kassa-withdrawals', b.withdrawals); set('kassa-expected', b.cash_expected);
      set('kassa-guests', b.guests);
      updateAvgCheck();
      kassaZ = { expenses: b.expenses || [], writeoffs: b.writeoffs || [], discounts: b.discounts || [] };
      renderKassaZ();
      if(existing.photo_url) {
        document.getElementById('kassa-photo-url').value = existing.photo_url;
        document.getElementById('kassa-photo-preview').innerHTML = `<img src="${escapeHtml(existing.photo_url)}" style="max-width:100%;border-radius:10px;max-height:160px;object-fit:cover" onclick="viewReport('${escJsAttr(existing.photo_url)}','image')">`;
      }
      document.getElementById('kassa-hint').textContent = tr('fin.kassaExists',{d:t,n:formatNum(existing.amount)});
    } else {
      document.getElementById('kassa-hint').textContent = tr('fin.scanOrManual');
    }
  } catch(e) { document.getElementById('kassa-hint').textContent = ''; }
}

// «Считать с чека»: фото → хранилище → распознавание (Claude Vision) → заполнение строк
function scanReceipt() {
  const input = document.createElement('input');
  // Без capture: телефон предложит выбор — снять камерой ИЛИ взять из галереи.
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const status = document.getElementById('kassa-scan-status');
    status.textContent = t('fin.scanLoading');
    try {
      const fileToUpload = await compressImage(file, 2000, 0.85);
      const path = `receipt-${Date.now()}.jpg`;
      const { error: upErr } = await sb.storage.from('task-reports').upload(path, fileToUpload);
      if(upErr) { status.textContent = t('common.uploadErr')+upErr.message; return; }
      const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
      const photoUrl = urlData.publicUrl;
      document.getElementById('kassa-photo-url').value = photoUrl;
      document.getElementById('kassa-photo-preview').innerHTML = `<img src="${escapeHtml(photoUrl)}" style="max-width:100%;border-radius:10px;max-height:160px;object-fit:cover">`;
      status.textContent = t('fin.scanRecognizing');
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData?.session?.access_token || SUPABASE_KEY;
      const res = await fetch('https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/read-receipt', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer '+token },
        body: JSON.stringify({ imageUrl: photoUrl })
      });
      const result = await res.json();
      // «Не распознал» и «сервис недоступен» — разные беды и лечатся по-разному:
      // в первом случае чек надо переснять, во втором переснимать бесполезно.
      if(!result.ok || !result.data) { status.textContent = aiErrorText(result.code, 'fin.scanFail'); return; }
      const d = result.data;
      // Кассовый день — день открытия смены с чека. Менеджер вносит ночью или
      // утром, и дату в окне легко забыть переключить.
      let dateNote = '';
      if(d.shift_date && /^\d{4}-\d{2}-\d{2}$/.test(d.shift_date) && d.shift_date !== kassaEditDate) {
        const di = document.getElementById('kassa-date'); if(di) di.value = d.shift_date;
        await loadKassaForDate(d.shift_date);
        document.getElementById('kassa-photo-url').value = photoUrl;
        document.getElementById('kassa-photo-preview').innerHTML = `<img src="${escapeHtml(photoUrl)}" style="max-width:100%;border-radius:10px;max-height:160px;object-fit:cover">`;
        dateNote = ' ' + t('fin.dateFromReceipt',{d:d.shift_date.split('-').reverse().join('.')});
      }
      kassaClearLines();
      (d.lines || []).forEach(l => { if(l && l.label) kassaAddLine(l.label, l.amount); });
      const set = (id,v)=>{ const el=document.getElementById(id); if(el && v!=null) el.value=v; };
      set('kassa-deposits', d.deposits); set('kassa-withdrawals', d.withdrawals); set('kassa-expected', d.cash_expected);
      document.getElementById('kassa-amount').value = (d.total!=null ? d.total : recalcKassa());
      kassaZ = { expenses: d.expenses || [], writeoffs: d.writeoffs || [], discounts: d.discounts || [] };
      renderKassaZ();
      updateAvgCheck();
      status.textContent = t('fin.scanDone') + dateNote;
    } catch(err) { status.textContent = t('common.error')+err.message; }
  };
  input.click();
}

async function saveKassa() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const raw = document.getElementById('kassa-amount').value;
  const amount = parseFloat(raw);
  if(!raw || isNaN(amount) || amount<0) return showToast(t('fin.enterRevenue'));
  // Без гостей не посчитать средний чек на дашборде (владелец, 03.11.2026)
  if(!(_kv('kassa-guests') > 0)) return showToast(t('fin.enterGuests'));
  // Фото Z-отчёта обязательно (владелец, 12.11.2026): по нему сверяют цифры
  if(!document.getElementById('kassa-photo-url').value) return showToast(t('fin.photoRequired'));
  // собираем строки разбивки
  const lines = [];
  document.querySelectorAll('#kassa-lines > div').forEach(row => {
    const label = (row.querySelector('.kassa-line-label')?.value || '').trim();
    const amt = parseFloat(row.querySelector('.kassa-line-amount')?.value);
    if(label || !isNaN(amt)) lines.push({ label, amount: isNaN(amt) ? 0 : amt });
  });
  const breakdown = {
    lines,
    deposits: _kv('kassa-deposits'), withdrawals: _kv('kassa-withdrawals'), cash_expected: _kv('kassa-expected'),
    guests: _kv('kassa-guests') || null,
    expenses: kassaZ.expenses, writeoffs: kassaZ.writeoffs, discounts: kassaZ.discounts
  };
  const photo_url = document.getElementById('kassa-photo-url').value || null;
  const description = lines.length
    ? lines.slice(0,3).map(l=>`${l.label} ${formatNum(l.amount)}`).join(' · ') + (lines.length>3?' …':'')
    : t('fin.kassaDefault');
  const existingId = document.getElementById('kassa-existing-id').value;
  try {
    let err;
    const row = { amount, breakdown, photo_url, description };
    if(existingId) {
      ({ error: err } = await sb.from('finances').update(row).eq('id', existingId));
    } else {
      ({ error: err } = await sb.from('finances').insert({ type:'income', category:'Выручка', date: kassaEditDate || businessToday(), filial: currentFilial, ...row }));
    }
    if(err) return showToast(t('common.error')+err.message);
    // Изъятия с чека → расходы дня. Прежние строки «с чека» за этот день
    // заменяем целиком: пересохранение кассы не должно их удваивать.
    // Расходы, внесённые руками кнопкой «➖ Расход», не трогаем.
    const day = kassaEditDate || businessToday();
    const { error: delErr } = await sb.from('finances').delete()
      .eq('type','expense').eq('filial', currentFilial).eq('date', day).eq('breakdown->>source','z');
    if(delErr) return showToast(t('common.error')+delErr.message);
    if(kassaZ.expenses.length) {
      const rows = kassaZ.expenses.map(x => ({
        type:'expense', date: day, filial: currentFilial, amount: Number(x.amount)||0,
        category: x.category || 'Прочее',
        description: x.who ? `${x.label} — ${x.who}` : x.label,
        breakdown: { source:'z', label: x.label, who: x.who || '' }
      }));
      const { error: insErr } = await sb.from('finances').insert(rows);
      if(insErr) return showToast(t('common.error')+insErr.message);
    }
    closeModal('modal-kassa');
    showToast(t('fin.kassaSaved'));
    if(kassaEditDate) financeSelectedDate = kassaEditDate; // экран прыгает на день сохранённой кассы
    if(FINANCE_ENABLED) loadFinance();
    if(typeof renderKassaCard === 'function') renderKassaCard();
  } catch(e) { showToast(t('common.error')+e.message); }
}

let expenseDate = null; // день, к которому добавляется расход

function openExpenseModal(date) {
  expenseDate = date || businessToday();
  // Дату можно поменять — расходы за пропущенные дни вносят задним числом
  document.getElementById('exp-date').value = expenseDate;
  document.getElementById('exp-date-display').textContent = getFilialName(currentFilial);
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-desc').value = '';
  openModal('modal-expense');
}

async function saveExpense() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const amount = parseFloat(document.getElementById('exp-amount').value);
  if(isNaN(amount) || amount<=0) return showToast(t('fin.enterAmount'));
  const date = document.getElementById('exp-date').value || expenseDate || businessToday();
  try {
    const { error: err } = await sb.from('finances').insert({ type:'expense', amount, category:document.getElementById('exp-category').value, description:document.getElementById('exp-desc').value, date, filial: currentFilial });
    if(err) return showToast(t('common.error')+err.message);
    closeModal('modal-expense');
    showToast(t('fin.expenseAdded'));
    if(FINANCE_ENABLED) loadFinance();
    if(typeof renderKassaCard === 'function') renderKassaCard();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function deleteFinance(id) {
  if(!canEditData()) return showToast(t('common.observerMode'));
  if(!await confirmDialog(t('fin.deleteOp'))) return;
  try {
    const { error: err } = await sb.from('finances').delete().eq('id', id);
    if(err) return showToast(t('common.error')+err.message);
    showToast(t('sch.deleted'));
    if(FINANCE_ENABLED) loadFinance();
    if(typeof renderKassaCard === 'function') renderKassaCard();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function addFinance() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const amount = document.getElementById('fin-amount').value;
  if(!amount) return showToast(t('fin.enterAmount'));
  try {
    await sb.from('finances').insert({ type:document.getElementById('fin-type').value, amount:parseFloat(amount), category:document.getElementById('fin-category').value, description:document.getElementById('fin-desc').value, date:today(), filial: currentFilial });
    closeModal('modal-add-finance');
    ['fin-amount','fin-desc'].forEach(id=>document.getElementById(id).value='');
    showToast(t('fin.opAdded'));
    loadFinance();
  } catch(e) { showToast(t('common.error')+e.message); }
}

