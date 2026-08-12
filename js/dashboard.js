// ============ ДАШБОРД ВЛАДЕЛЬЦА ============
let dashPeriod = 'month'; // today | week | month

// Пока идёт пилот (PILOT_MODE) — дашборд показывает только пилотный филиал.
// Когда пилот выключат, автоматически развернётся на все филиалы сети.
function dashActiveFilials() {
  return (typeof PILOT_MODE !== 'undefined' && PILOT_MODE)
    ? FILIALS.filter(f => f.id === PILOT_FILIAL)
    : FILIALS;
}

function dashPeriodLabel() {
  return dashPeriod==='today' ? t('dash.plToday') : dashPeriod==='week' ? t('dash.plWeek') : t('dash.plMonth');
}

// Текущий период
function dashDateRange() {
  const now = new Date();
  let from;
  if(dashPeriod==='today') from = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  else if(dashPeriod==='week') { from = new Date(now); from.setDate(now.getDate()-6); }
  else from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: ymdLocal(from), to: ymdLocal(now) };
}

// Сопоставимый предыдущий период (равной длины) для сравнения ↑↓
function dashPrevRange() {
  const now = new Date();
  if(dashPeriod==='today') {
    const y = new Date(now); y.setDate(now.getDate()-1);
    const s = ymdLocal(y);
    return { from: s, to: s };
  } else if(dashPeriod==='week') {
    const to = new Date(now); to.setDate(now.getDate()-7);
    const from = new Date(now); from.setDate(now.getDate()-13);
    return { from: ymdLocal(from), to: ymdLocal(to) };
  } else {
    // Прошлый месяц до того же числа (честное сравнение с неполным текущим)
    const day = now.getDate();
    const pFrom = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const pTo = new Date(now.getFullYear(), now.getMonth()-1, Math.min(day, lastDayPrev));
    return { from: ymdLocal(pFrom), to: ymdLocal(pTo) };
  }
}

// Бейдж динамики: сравнивает cur с prev. inverse=true — когда меньше = лучше (опоздания).
function dashDelta(cur, prev, inverse) {
  if((cur||0)===0 && (prev||0)===0) return '';
  const pct = prev ? Math.round((cur-prev)/Math.abs(prev)*100) : 100;
  const up = cur >= prev;
  const good = inverse ? !up : up;
  const color = good ? '#a3e07a' : '#ff9b9b';
  const sign = pct>0 ? '+' : '';
  return ` <span style="font-size:12px;font-weight:600;color:${color}">${up?'↑':'↓'}${sign}${pct}%</span>`;
}

// Кнопки периода рисуем ОТДЕЛЬНО от содержимого вкладки. Раньше это делал только
// «Обзор», поэтому на других вкладках подсветка оставалась на старом периоде:
// данные уже за «сегодня», а горит «месяц».
function renderDashPeriods() {
  const sw = document.getElementById('dash-period-switcher');
  if(!sw) return;
  const periods = [{id:'today',label:t('dash.periodToday')},{id:'week',label:t('dash.periodWeek')},{id:'month',label:t('dash.periodMonth')}];
  sw.innerHTML = periods.map(p=>`<button onclick="setDashPeriod('${p.id}')" style="flex:1;padding:9px;border-radius:10px;border:none;font-size:13px;font-weight:600;cursor:pointer;background:${p.id===dashPeriod?'var(--gold-dark)':'var(--surface-2)'};color:${p.id===dashPeriod?'#fff':'var(--text-primary)'}">${p.label}</button>`).join('');
}

async function loadDashOverview() {

  const content = document.getElementById('dashboard-content');
  content.innerHTML = `<div class="loading">${t('dash.collecting')}</div>`;

  const activeFilials = dashActiveFilials();
  const fids = activeFilials.map(f=>f.id);
  const { from, to } = dashDateRange();
  const prev = dashPrevRange();
  // Для прогноза ФОТ по месяцу берём график до конца месяца (будущие смены тоже)
  const forecastTo = dashPeriod==='month'
    ? ymdLocal(new Date(new Date().getFullYear(), new Date().getMonth()+1, 0))
    : to;
  const canFin = canSeeFinance();
  const money = n => formatNum(Math.round(n));
  const pl = dashPeriodLabel();
  const scope = activeFilials.length===1 ? activeFilials[0].name : t('dash.allNetwork');

  try {
    // ---- Текущий период ----
    const [finRes, taskRes, attRes, schedRes, bookRes, revRes] = await Promise.all([
      canFin ? sb.from('finances').select('amount,type').in('filial',fids).gte('date',from).lte('date',to) : Promise.resolve({data:[]}),
      sb.from('tasks').select('status,assigned_to_name').in('filial',fids).gte('due_date',from).lte('due_date',to),
      sb.from('attendance').select('is_late,penalty,late_minutes,check_in_time,employee_id').in('filial',fids).gte('date',from).lte('date',to),
      sb.from('schedules').select('employee_id,is_day_off,date').in('filial',fids).gte('date',from).lte('date',forecastTo),
      sb.from('bookings').select('id').in('filial',fids).gte('date',from).lte('date',to),
      sb.from('reviews').select('sentiment').in('filial',fids).gte('created_at',from+'T00:00:00').lte('created_at',to+'T23:59:59'),
    ]);

    // ---- Предыдущий период (только для сравнения) ----
    const [pFinRes, pAttRes] = await Promise.all([
      canFin ? sb.from('finances').select('amount,type').in('filial',fids).gte('date',prev.from).lte('date',prev.to) : Promise.resolve({data:[]}),
      sb.from('attendance').select('is_late').in('filial',fids).gte('date',prev.from).lte('date',prev.to),
    ]);

    // ---- Сотрудники: ставка и имя по id (для ФОТ и рейтинга) ----
    // Берём всех (в т.ч. уволенных) — у них может быть явка/смены в периоде, и ставка нужна для ФОТ
    const { data: allEmps } = await sb.from('employees').select('id,name,salary');
    const empRate = {}, empName = {};
    (allEmps||[]).forEach(e=>{ empRate[e.id]=Number(e.salary)||0; empName[e.id]=e.name; });

    // ---- Агрегаты текущего периода ----
    let income=0, expense=0;
    (finRes.data||[]).forEach(f=>{ if(f.type==='income') income+=Number(f.amount); else expense+=Number(f.amount); });
    const profit = income - expense;

    const tasks = taskRes.data||[];
    const tasksTotal = tasks.length;
    const tasksDone = tasks.filter(t=>t.status==='done').length;
    const taskPct = tasksTotal ? Math.round(tasksDone/tasksTotal*100) : 0;

    const att = attRes.data||[];
    const checkins = att.filter(a=>a.check_in_time).length;
    const lateRecords = att.filter(a=>a.is_late);
    const lates = lateRecords.length;
    const penalties = att.reduce((s,a)=>s+(Number(a.penalty)||0),0);
    const avgLate = lates ? Math.round(lateRecords.reduce((s,a)=>s+(Number(a.late_minutes)||0),0)/lates) : 0;

    const schedRows = schedRes.data||[];
    const plannedShifts = schedRows.filter(s=>!s.is_day_off && s.date<=to).length; // плановые смены в прошедшей части периода (для % явки)
    const attendPct = plannedShifts ? Math.round(checkins/plannedShifts*100) : 0;

    // ---- ФОТ: фактический (по отработанным сменам) и плановый (по графику) ----
    let actualFOT = 0;
    att.forEach(a=>{ if(a.check_in_time) actualFOT += (empRate[a.employee_id]||0) - (Number(a.penalty)||0); });
    let plannedFOT = 0;
    schedRows.forEach(s=>{ if(!s.is_day_off) plannedFOT += (empRate[s.employee_id]||0); });

    const books = (bookRes.data||[]).length;
    const revs = revRes.data||[];
    const revPos = revs.filter(r=>r.sentiment==='positive').length;
    const revNeg = revs.filter(r=>r.sentiment==='negative').length;

    // ---- Агрегаты предыдущего периода ----
    let pIncome=0, pExpense=0;
    (pFinRes.data||[]).forEach(f=>{ if(f.type==='income') pIncome+=Number(f.amount); else pExpense+=Number(f.amount); });
    const pProfit = pIncome - pExpense;
    const pLates = (pAttRes.data||[]).filter(a=>a.is_late).length;

    // ---- Рейтинг сотрудников ----
    const doneByName = {};
    tasks.filter(t=>t.status==='done' && t.assigned_to_name).forEach(t=>{ doneByName[t.assigned_to_name]=(doneByName[t.assigned_to_name]||0)+1; });
    const topDone = Object.entries(doneByName).sort((a,b)=>b[1]-a[1]).slice(0,3);

    const lateByEmp = {};
    lateRecords.forEach(a=>{ lateByEmp[a.employee_id]=(lateByEmp[a.employee_id]||0)+1; });
    const topLate = Object.entries(lateByEmp).map(([id,n])=>[empName[id]||('#'+id), n]).sort((a,b)=>b[1]-a[1]).slice(0,3);

    document.getElementById('dash-subtitle').textContent = scope + ' · ' + pl;

    // ======== РЕНДЕР ========
    let html = '';

    // Верхняя сводка с динамикой
    html += `<div class="card" style="background:linear-gradient(135deg,#1a2e1a,#2d4a2d);border:none;color:#e9f0e9;margin-bottom:12px">
      <div style="font-size:11px;opacity:0.7;margin-bottom:10px;text-transform:uppercase">${scope} · ${pl}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${canFin?`<div><div style="font-size:22px;font-weight:700">${money(income)}${dashDelta(income,pIncome)}</div><div style="font-size:11px;opacity:0.7">${t('dash.revenue')}</div></div>
        <div><div style="font-size:22px;font-weight:700;color:${profit>=0?'#a3e07a':'#ff9b9b'}">${money(profit)}${dashDelta(profit,pProfit)}</div><div style="font-size:11px;opacity:0.7">${t('dash.profit')}</div></div>`:''}
        <div><div style="font-size:22px;font-weight:700">${tasksDone}/${tasksTotal}</div><div style="font-size:11px;opacity:0.7">${t('dash.tasksPct',{n:taskPct})}</div></div>
        <div><div style="font-size:22px;font-weight:700;color:${lates>0?'#ff9b9b':'#a3e07a'}">${lates}${dashDelta(lates,pLates,true)}</div><div style="font-size:11px;opacity:0.7">${t('dash.lates')}</div></div>
      </div>
      <div style="font-size:10px;opacity:0.55;margin-top:10px">${t('dash.compare')}</div>
    </div>`;

    // ФОТ как доля от выручки (главная цифра) + суммы факт/прогноз
    if(canFin) {
      const share = income>0 ? Math.round(actualFOT/income*100) : null;
      const forecastLabel = dashPeriod==='month' ? t('dash.forecastMonth') : t('dash.forecastSched');
      // Для гостевого бизнеса ФОТ обычно 25–35% от выручки: <30% зелёный, 30–45% жёлтый, выше красный
      const shareColor = share===null ? 'var(--text-muted)' : share>45 ? '#A32D2D' : share>30 ? '#8a6a2f' : '#3B6D11';
      html += `<div class="card">
        <div style="font-size:13px;font-weight:700;color:var(--gold-dark);margin-bottom:8px">${t('dash.fotShare',{pl})}</div>
        <div style="font-size:34px;font-weight:800;color:${shareColor};line-height:1">${share!==null?share+'%':'—'}</div>
        ${share===null?`<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${t('dash.noRevenue')}</div>`:''}
        <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);margin-top:10px;flex-wrap:wrap">
          <div>${t('dash.fotActual')}<b style="color:var(--text-primary)">${money(actualFOT)}</b></div>
          <div>${forecastLabel}: <b style="color:var(--text-primary)">${money(plannedFOT)}</b></div>
          ${income>0?`<div>${t('dash.revenueLabel')}<b style="color:var(--text-primary)">${money(income)}</b></div>`:''}
        </div>
      </div>`;
    }

    // Явка и дисциплина
    html += `<div class="card">
      <div style="font-size:13px;font-weight:700;color:var(--gold-dark);margin-bottom:10px">${t('dash.attendance',{pl})}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center">
        <div><div style="font-size:20px;font-weight:700;color:${attendPct>=90?'#3B6D11':attendPct>=70?'#8a6a2f':'#A32D2D'}">${plannedShifts?attendPct+'%':'—'}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.attend')}<br>${t('dash.shiftsOf',{done:checkins,total:plannedShifts})}</div></div>
        <div><div style="font-size:20px;font-weight:700;color:${taskPct>=80?'#3B6D11':'#8a6a2f'}">${tasksTotal?taskPct+'%':'—'}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.tasks')}<br>${tasksDone}/${tasksTotal}</div></div>
        <div><div style="font-size:20px;font-weight:700;color:${avgLate>0?'#A32D2D':'#3B6D11'}">${lates?avgLate+'м':'0'}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.avgLate')}<br>${t('dash.cases',{n:lates})}</div></div>
      </div>
      ${penalties>0&&canFin?`<div style="font-size:11px;color:#A32D2D;margin-top:8px">${t('dash.penaltiesPeriod',{n:money(penalties)})}</div>`:''}
    </div>`;

    // Рейтинг сотрудников
    const medal = ['🥇','🥈','🥉'];
    let ratingHtml = '';
    if(topDone.length) {
      ratingHtml += `<div style="font-size:12px;font-weight:600;color:#3B6D11;margin-bottom:6px">${t('dash.mostTasks')}</div>`;
      ratingHtml += topDone.map((e,i)=>`<div class="list-item"><div class="item-info"><div class="item-name">${medal[i]||''} ${escapeHtml(e[0])}</div></div><span style="font-weight:700;color:var(--gold-dark)">${e[1]}</span></div>`).join('');
    }
    if(topLate.length) {
      ratingHtml += `<div style="font-size:12px;font-weight:600;color:#A32D2D;margin:12px 0 6px">${t('dash.mostLates')}</div>`;
      ratingHtml += topLate.map(e=>`<div class="list-item"><div class="item-info"><div class="item-name">${escapeHtml(e[0])}</div></div><span class="badge badge-red">${e[1]}</span></div>`).join('');
    }
    if(!ratingHtml) ratingHtml = `<div class="empty"><div class="empty-text">${t('dash.noPeriodData')}</div></div>`;
    html += `<div class="card"><div style="font-size:13px;font-weight:700;color:var(--gold-dark);margin-bottom:8px">${t('dash.rating',{pl})}</div>${ratingHtml}</div>`;

    // Брони и отзывы
    html += `<div class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:center">
        <div><div style="font-size:20px;font-weight:700;color:var(--text-primary)">${books}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.bookings',{pl})}</div></div>
        <div><div style="font-size:20px;font-weight:700;color:var(--text-primary)">👍${revPos} 👎${revNeg}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.reviews')}</div></div>
      </div>
    </div>`;

    content.innerHTML = html;
  } catch(e) {
    console.error('dashboard', e);
    content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('dash.loadErr')+(e?.message||e)}</div></div></div>`;
  }
}

function setDashPeriod(p) { dashPeriod = p; dashClTpl = null; loadDashboard(); }

// ===== ВКЛАДКИ ДАШБОРДА =====
// Управляющий видит подробную отчётность по вкладкам, владелец — только «Обзор»:
// он в приложении наблюдатель, ему нужна сводка, а не разбор по людям.
let dashTab = 'overview';

function dashTabList() {
  const hookah = { id:'hookah', label:t('dash.tab.hookah') };
  // Старший кальянной станции заходит в дашборд только ради своей вкладки:
  // всё остальное — чужие цеха и деньги заведения.
  if(typeof myLeadDept === 'function' && myLeadDept() === 'Кальянные мастера' && !canEditData() && !isBoss()) {
    return [hookah];
  }
  const positions = { id:'positions', label:t('dash.tab.positions') };
  const all = [
    { id:'overview',   label:t('dash.tab.overview') },
    { id:'attendance', label:t('dash.tab.attendance') },
    { id:'tasks',      label:t('dash.tab.tasks') },
    { id:'checklists', label:t('dash.tab.checklists') },
    { id:'people',     label:t('dash.tab.people') },
    positions,
    hookah,
  ];
  return isBoss() ? [all[0], hookah] : all;
}

function renderDashTabs() {
  const el = document.getElementById('dash-tabs');
  if(!el) return;
  const tabs = dashTabList();
  if(tabs.length < 2) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = tabs.map(x => '<button onclick="setDashTab(\'' + x.id + '\')" class="chip' + (x.id===dashTab?' on':'') + '">' + x.label + '</button>').join('');
}

function setDashTab(id) { dashTab = id; dashClTpl = null; renderDashPeriods(); renderDashTabs(); loadDashboardTab(); }

async function loadDashboard() {
  if(!dashTabList().some(x => x.id === dashTab)) dashTab = 'overview';
  renderDashPeriods();
  renderDashTabs();
  await loadDashboardTab();
}

async function loadDashboardTab() {
  // Охват и период — в подзаголовке экрана на каждой вкладке, а не только в «Обзоре»
  const sub = document.getElementById('dash-subtitle');
  if(sub) sub.textContent = dashScopeLabel() + ' · ' + dashPeriodLabel();
  if(dashTab === 'attendance') return loadDashAttendance();
  if(dashTab === 'tasks')      return loadDashTasks();
  if(dashTab === 'checklists') return loadDashChecklists();
  if(dashTab === 'people')     return loadDashPeople();
  if(dashTab === 'positions')  return loadDashPositions();
  if(dashTab === 'hookah')     return loadDashHookah();
  return loadDashOverview();
}

// ===== Общие блоки отчётов =====
// Вкладки дашборда собираются из одного набора: шапка → плитки-итоги → секции
// со списками. Стили лежат в index.html (.dsh-*), здесь только сборка разметки.

function dashScopeLabel() {
  const f = dashActiveFilials();
  return f.length === 1 ? f[0].name : t('dash.allNetwork');
}

// Шапка вкладки: период и охват — чтобы цифры нельзя было прочитать не за тот срок
function dashHead(title, extra) {
  return `<div class="dsh-toolbar">
    <h2>${title}</h2>
    <span>${dashScopeLabel()} · ${dashPeriodLabel()}${extra ? '<br>' + extra : ''}</span>
  </div>`;
}

// Цвет цифры по светофору: доля выполнена на pct%, good/mid — пороги
function dashTone(pct, good, mid) {
  return pct >= (good === undefined ? 95 : good) ? 'var(--ok)'
       : pct >= (mid === undefined ? 70 : mid) ? 'var(--warn)' : 'var(--bad)';
}
// Шкала. Цвет берётся из currentColor, поэтому задаётся на родителе
function dashBar(pct, color) {
  const w = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return `<div class="dsh-bar" style="color:${color || 'var(--gold-dark)'}"><i style="width:${w}%"></i></div>`;
}
// Плитки с главными цифрами вкладки: [{ val, label, color?, bar? }]
function dashKpis(items) {
  return `<div class="card"><div class="dsh-kpis">` + items.map(k =>
    `<div class="dsh-kpi">
      <div class="dsh-kpi-val"${k.color ? ` style="color:${k.color}"` : ''}>${k.val}</div>
      <div class="dsh-kpi-lbl">${k.label}</div>
      ${k.bar !== undefined ? dashBar(k.bar, k.color) : ''}
    </div>`).join('') + '</div></div>';
}
// Секция-карточка: цветной акцент, заголовок, счётчик строк и необязательная подсказка
function dashSection(title, body, opts) {
  const o = opts || {};
  if(!body) return '';
  return `<div class="card">
    <div class="dsh-sec-h" style="color:${o.color || 'var(--gold-dark)'}"><b>${title}</b>${o.count !== undefined ? `<i>${o.count}</i>` : ''}</div>
    ${o.hint ? `<div class="dsh-sec-hint">${o.hint}</div>` : ''}
    ${body}
  </div>`;
}
function dashChip(text, tone) { return `<span class="dsh-chip${tone ? ' ' + tone : ''}">${text}</span>`; }
// «Кахрамонов Шохджахон Азаматович» → «Кахрамонов Ш. А.»: в метках рядом с
// цифрами полные ФИО занимают три строки и ломают ряд меток на телефоне
function dashShortName(full) {
  const p = String(full || '').trim().split(/\s+/);
  return p.length < 2 ? (p[0] || '') : p[0] + ' ' + p.slice(1).map(w => w[0].toUpperCase() + '.').join(' ');
}
// Строка отчёта: имя + главная цифра справа, под ними подпись, шкала и метки
function dashLine(o) {
  return `<div class="dsh-row${o.onclick ? ' dsh-tap' : ''}"${o.onclick ? ` onclick="${o.onclick}"` : ''}>
    <div class="dsh-row-top">
      <div class="dsh-row-name">${o.name}</div>
      ${o.val ? `<div class="dsh-row-val" style="color:${o.color || 'var(--text-primary)'}">${o.val}</div>` : ''}
    </div>
    ${o.meta ? `<div class="dsh-row-meta">${o.meta}</div>` : ''}
    ${o.bar !== undefined ? dashBar(o.bar, o.color) : ''}
    ${o.chips && o.chips.length ? `<div class="dsh-chips">${o.chips.join('')}</div>` : ''}
  </div>`;
}
// Сворачиваемый блок: длинные хвосты списков и разбивка по дням
function dashFold(title, right, body, open) {
  return `<details class="dsh-fold"${open ? ' open' : ''}>
    <summary><div class="dsh-fold-h"><b>${title}</b>${right || ''}</div></summary>
    <div class="dsh-fold-body">${body}</div>
  </details>`;
}

function dashEmpty(text) { return `<div class="card"><div class="empty"><div class="empty-text">${text}</div></div></div>`; }
function dashRow(name, sub, right, rightColor) {
  return `<div class="list-item">
    <div class="item-info"><div class="item-name">${escapeHtml(name)}</div>${sub ? `<div class="item-sub">${sub}</div>` : ''}</div>
    <div style="font-weight:700;white-space:nowrap;color:${rightColor || 'var(--text-primary)'}">${right}</div>
  </div>`;
}

// ---- Явка и опоздания ----
async function loadDashAttendance() {
  const content = document.getElementById('dashboard-content');
  content.innerHTML = `<div class="loading">${t('dash.collecting')}</div>`;
  const fids = dashActiveFilials().map(f => f.id);
  const { from, to } = dashDateRange();
  try {
    const [attRes, schedRes, empRes] = await Promise.all([
      sb.from('attendance').select('employee_id,date,check_in_time,is_late,late_minutes,penalty').in('filial', fids).gte('date', from).lte('date', to),
      sb.from('schedules').select('employee_id,date,is_day_off').in('filial', fids).gte('date', from).lte('date', to),
      sb.from('employees').select('id,name,department'),
    ]);
    const emp = {}; (empRes.data || []).forEach(e => { emp[e.id] = e; });
    const stat = {};
    const touch = id => (stat[id] = stat[id] || { planned:0, came:0, late:0, lateMin:0, penalty:0 });
    (schedRes.data || []).forEach(s => { if(!s.is_day_off) touch(s.employee_id).planned++; });
    (attRes.data || []).forEach(a => {
      const x = touch(a.employee_id);
      if(a.check_in_time) x.came++;
      if(a.is_late) { x.late++; x.lateMin += Number(a.late_minutes) || 0; }
      x.penalty += Number(a.penalty) || 0;
    });

    const rows = Object.entries(stat)
      .map(([id, x]) => Object.assign({ id, name: emp[id]?.name || t('dash.a.gone', { id }), dept: emp[id]?.department || '' }, x))
      .filter(r => r.planned > 0 || r.came > 0);
    // Пропуск = смена стоит в графике, а отметки прихода за неё нет
    rows.forEach(r => {
      r.miss = Math.max(0, r.planned - r.came);
      r.pct = r.planned ? Math.round(r.came / r.planned * 100) : 100;
    });

    if(rows.length === 0) { content.innerHTML = dashHead(t('dash.tab.attendance')) + dashEmpty(t('dash.noPeriodData')); return; }

    const totPlanned = rows.reduce((s, r) => s + r.planned, 0);
    const totCame = rows.reduce((s, r) => s + r.came, 0);
    const totLate = rows.reduce((s, r) => s + r.late, 0);
    const pct = totPlanned ? Math.round(totCame / totPlanned * 100) : 0;

    // Сначала те, с кем есть о чём говорить: сперва пропуски, потом опоздания.
    // Раньше список сортировался только по опозданиям и человек, не вышедший ни
    // разу, получал зелёную галочку — самая частая причина «ничего не понятно».
    const byName = (a, b) => (a.name > b.name ? 1 : -1);
    const problem = rows.filter(r => r.miss > 0 || r.late > 0)
      .sort((a, b) => (b.miss - a.miss) || (b.late - a.late) || byName(a, b));
    const clean = rows.filter(r => !(r.miss > 0 || r.late > 0)).sort(byName);

    const personRow = r => {
      const tone = r.planned ? dashTone(r.pct, 100, 75) : 'var(--text-muted)';
      const chips = [];
      if(r.miss) chips.push(dashChip(t('dash.a.chipMiss', { n:r.miss }), 'bad'));
      if(r.late) chips.push(dashChip(t('dash.a.chipLate', { n:r.late, m:Math.round(r.lateMin / r.late) }), 'warn'));
      if(r.penalty > 0 && canSeeFinance()) chips.push(dashChip(t('dash.a.chipPenalty', { n:formatNum(r.penalty) }), 'bad'));
      if(!r.planned) chips.push(dashChip(t('dash.a.chipNoPlan'), ''));
      if(!chips.length) chips.push(dashChip(t('dash.a.chipOk'), 'ok'));
      return dashLine({
        name: escapeHtml(r.name),
        val: r.planned ? `${r.came}/${r.planned} <small>${t('dash.a.shifts')}</small>` : `${r.came} <small>${t('dash.a.shifts')}</small>`,
        color: tone,
        meta: escapeHtml(r.dept || ''),
        bar: r.planned ? r.pct : undefined,
        chips,
      });
    };

    content.innerHTML = dashHead(t('dash.tab.attendance'))
      + dashKpis([
          { val: totPlanned ? pct + '%' : '—', label: t('dash.attend'), color: dashTone(pct, 90, 70), bar: pct },
          { val: `${totCame}<small>/${totPlanned}</small>`, label: t('dash.a.kpiShifts') },
          { val: String(totLate), label: t('dash.lates'), color: totLate ? 'var(--bad)' : 'var(--ok)' },
        ])
      + `<div class="dsh-note">${t('dash.a.note')}</div>`
      + dashSection(t('dash.a.problem'), problem.map(personRow).join(''), { count: problem.length, color: 'var(--bad)' })
      // Если замечаний нет вовсе, разворачиваем список сразу: иначе вкладка
      // выглядит пустой при том, что смены отработаны
      + (clean.length ? dashSection(t('dash.a.clean'),
          dashFold(t('dash.a.cleanFold', { n:clean.length }), '', clean.map(personRow).join(''), !problem.length),
          { count: clean.length, color: 'var(--ok)' }) : '');
  } catch(e) { content.innerHTML = dashEmpty(t('dash.loadErr') + (e?.message || e)); }
}

// ---- Задачи ----
async function loadDashTasks() {
  const content = document.getElementById('dashboard-content');
  content.innerHTML = `<div class="loading">${t('dash.collecting')}</div>`;
  const fids = dashActiveFilials().map(f => f.id);
  const { from, to } = dashDateRange();
  try {
    const { data } = await sb.from('tasks').select('id,title,status,due_date,assigned_to_name')
      .in('filial', fids).gte('due_date', from).lte('due_date', to).order('due_date');
    const tasks = data || [];
    if(tasks.length === 0) { content.innerHTML = dashHead(t('dash.tab.tasks')) + dashEmpty(t('dash.noPeriodData')); return; }

    const todayStr = today();
    const done = tasks.filter(x => x.status === 'done');
    const overdue = tasks.filter(x => x.status !== 'done' && x.due_date < todayStr);
    const open = tasks.filter(x => x.status !== 'done' && x.due_date >= todayStr);
    const pct = Math.round(done.length / tasks.length * 100);

    const byPerson = {};
    tasks.forEach(x => {
      const k = x.assigned_to_name || t('dash.t.nobody');
      const b = byPerson[k] = byPerson[k] || { all:0, done:0, overdue:0 };
      b.all++;
      if(x.status === 'done') b.done++;
      else if(x.due_date < todayStr) b.overdue++;
    });
    const people = Object.entries(byPerson).sort((a, b) => b[1].overdue - a[1].overdue || b[1].all - a[1].all);

    content.innerHTML = dashHead(t('dash.tab.tasks'))
      + dashKpis([
          { val: pct + '%', label: t('dash.t.doneShort'), color: dashTone(pct, 80, 50), bar: pct },
          { val: `${done.length}<small>/${tasks.length}</small>`, label: t('dash.tasks') },
          { val: String(overdue.length), label: t('dash.t.overdue'), color: overdue.length ? 'var(--bad)' : 'var(--ok)' },
        ])
      + `<div class="card"><div style="font-size:12px;font-weight:700;color:var(--gold-dark);margin-bottom:6px">${t('dash.t.byPerson')}</div>`
      + people.map(([name, b]) => dashRow(name,
          t('dash.t.personSub', { done:b.done, all:b.all }) + (b.overdue ? ` · <span style="color:#A32D2D">${t('dash.t.overdueN', { n:b.overdue })}</span>` : ''),
          Math.round(b.done / b.all * 100) + '%', b.done / b.all >= 0.8 ? '#3B6D11' : '#8a6a2f')).join('')
      + '</div>'
      + (overdue.length ? `<div class="card"><div style="font-size:12px;font-weight:700;color:#A32D2D;margin-bottom:6px">${t('dash.t.overdueList')}</div>`
          + overdue.slice(0, 20).map(x => dashRow(x.title || '—',
              fmtDateShort(x.due_date, { day:'numeric', month:'short' }) + ' · ' + escapeHtml(x.assigned_to_name || t('dash.t.nobody')),
              '', '')).join('') + '</div>' : '')
      + (open.length ? `<div style="font-size:11px;color:var(--text-muted);padding:0 4px">${t('dash.t.stillOpen', { n:open.length })}</div>` : '');
  } catch(e) { content.innerHTML = dashEmpty(t('dash.loadErr') + (e?.message || e)); }
}

// ---- Чек-листы: сводка + разбивка по сотрудникам и по дням ----
let dashClTpl = null;   // открыт разбор конкретного чек-листа

function openDashChecklist(id) { dashClTpl = id; loadDashChecklists(); }
function closeDashChecklist() { dashClTpl = null; loadDashChecklists(); }

async function loadDashChecklists() {
  const content = document.getElementById('dashboard-content');
  content.innerHTML = `<div class="loading">${t('dash.collecting')}</div>`;
  const fids = dashActiveFilials().map(f => f.id);
  const { from, to } = dashDateRange();
  try {
    const [logRes, tplRes, missRes] = await Promise.all([
      sb.from('checklist_logs').select('template_id,date,items_done,items_by,completed,user_name').in('filial', fids).gte('date', from).lte('date', to),
      sb.from('checklist_templates').select('id,name,department,items').eq('is_active', true),
      sb.from('checklist_misses').select('*').in('filial', fids).gte('date', from).lte('date', to).order('date', { ascending:false }),
    ]);
    const tpl = {}; (tplRes.data || []).forEach(x => { tpl[x.id] = x; });
    const logs = logRes.data || [];
    const misses = missRes.data || [];
    const totalOf = id => ((tpl[id]?.items) || []).length || 1;
    const pctOf = l => Math.min(100, Math.round(((l.items_done || []).length / totalOf(l.template_id)) * 100));
    // Кто сколько пунктов отметил в этом заполнении, короткими именами
    const whoChips = l => {
      const counts = {};
      Object.values(l.items_by || {}).forEach(n => { if(n) counts[n] = (counts[n] || 0) + 1; });
      return Object.entries(counts).sort((a, b) => b[1] - a[1])
        .map(([n, c]) => dashChip(escapeHtml(dashShortName(n)) + ' · ' + c));
    };

    // ===== Разбор одного чек-листа: по дням =====
    if(dashClTpl) {
      const tt = tpl[dashClTpl];
      const days = logs.filter(l => l.template_id === dashClTpl).sort((a, b) => b.date.localeCompare(a.date));
      const full = days.filter(l => l.completed).length;
      const avg = days.length ? Math.round(days.reduce((s, l) => s + pctOf(l), 0) / days.length) : 0;
      let html = `<button onclick="closeDashChecklist()" class="chip" style="margin-bottom:10px">${t('dash.c.back')}</button>`;
      html += dashHead(escapeHtml(tt?.name || '—'), escapeHtml(tt?.department || ''));
      html += days.length
        ? dashKpis([
            { val: avg + '%', label: t('dash.c.kpiAvg'), color: dashTone(avg), bar: avg },
            { val: `${full}<small>/${days.length}</small>`, label: t('dash.c.kpiFull') },
          ])
          + dashSection(t('dash.c.byDay'), days.map(l => {
              const p = pctOf(l);
              return dashLine({
                name: fmtDateShort(l.date, { weekday:'long', day:'numeric', month:'long' }),
                val: p + '%', color: dashTone(p), bar: p,
                meta: t('dash.c.doneOf', { done:(l.items_done || []).length, total:totalOf(l.template_id) }),
                chips: whoChips(l),
              });
            }).join(''), { count: days.length })
        : dashEmpty(t('dash.noPeriodData'));
      content.innerHTML = html;
      return;
    }

    let html = dashHead(t('dash.tab.checklists'));

    if(!logs.length && !misses.length) { content.innerHTML = html + dashEmpty(t('dash.noPeriodData')); return; }

    // ===== Итоги вкладки =====
    const totalFull = logs.filter(l => l.completed).length;
    const avgAll = logs.length ? Math.round(logs.reduce((s, l) => s + pctOf(l), 0) / logs.length) : 0;
    html += dashKpis([
      { val: logs.length ? avgAll + '%' : '—', label: t('dash.c.kpiAvg'), color: dashTone(avgAll), bar: avgAll },
      { val: `${totalFull}<small>/${logs.length}</small>`, label: t('dash.c.kpiFull') },
      { val: String(misses.length), label: t('dash.c.kpiMisses'), color: misses.length ? 'var(--bad)' : 'var(--ok)' },
    ]);
    html += `<div class="dsh-note">${t('dash.c.note')}</div>`;

    // ===== Невыполнения: то, ради чего вкладку открывают — сразу под итогами =====
    // Имена дежурных приходят одной строкой через запятую — разбиваем на метки,
    // иначе четыре ФИО дают красный блок в три строки
    const nameChips = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
      .map(n => dashChip(escapeHtml(dashShortName(n))));
    const missRow = m => dashLine({
      name: escapeHtml(m.template_name || '—'),
      val: m.points_given > 0 ? `−${m.points_given} <small>${t('dash.c.points')}</small>` : '', color: 'var(--bad)',
      meta: fmtDateShort(m.date, { weekday:'short', day:'numeric', month:'short' })
            + ' · ' + t('cld.wasDue', { time:(m.due_time || '').slice(0, 5) }),
      chips: nameChips(m.employee_names),
    });
    if(misses.length) {
      misses.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const head = misses.slice(0, 8), tail = misses.slice(8);
      html += dashSection(t('dash.c.missesTitle'),
        head.map(missRow).join('') + (tail.length ? dashFold(t('dash.c.showRest', { n:tail.length }), '', tail.map(missRow).join('')) : ''),
        { count: misses.length, color: 'var(--bad)', hint: t('dash.c.missesHint') });
    }

    // ===== По чек-листам =====
    const byTpl = {};
    logs.forEach(l => {
      if(!tpl[l.template_id]) return;
      const b = byTpl[l.template_id] = byTpl[l.template_id] || { id:l.template_id, name:tpl[l.template_id].name, dept:tpl[l.template_id].department, days:0, full:0, sum:0 };
      b.days++;
      if(l.completed) b.full++;
      b.sum += pctOf(l);
    });
    const rows = Object.values(byTpl).sort((a, b) => (a.sum / a.days) - (b.sum / b.days));

    html += dashSection(t('dash.c.byChecklist'), rows.map(r => {
      const avg = Math.round(r.sum / r.days);
      return dashLine({
        name: escapeHtml(r.name), val: avg + '%', color: dashTone(avg), bar: avg,
        meta: escapeHtml(r.dept || '') + ' · ' + t('dash.c.daysFull', { full:r.full, days:r.days }),
        onclick: `openDashChecklist(${r.id})`,
      });
    }).join(''), { count: rows.length, hint: t('dash.c.tapHint') });

    // ===== По сотрудникам: сколько пунктов отметил каждый =====
    const byPerson = {};
    logs.forEach(l => {
      Object.values(l.items_by || {}).forEach(n => { if(n) byPerson[n] = (byPerson[n] || 0) + 1; });
    });
    const persons = Object.entries(byPerson).sort((a, b) => b[1] - a[1]);
    if(persons.length) {
      const max = persons[0][1] || 1;
      html += dashSection(t('dash.c.byPerson'), persons.map(([n, c]) => dashLine({
        name: escapeHtml(n), val: String(c), bar: c / max * 100, color: 'var(--gold-dark)',
      })).join(''), { count: persons.length, hint: t('dash.c.byPersonHint') });
    }

    // ===== День в день: каждый день свёрнут, раскрытым только последний =====
    const byDay = {};
    logs.forEach(l => {
      const d = byDay[l.date] = byDay[l.date] || { started:0, full:0 };
      d.started++;
      if(l.completed) d.full++;
    });
    misses.forEach(m => { byDay[m.date] = byDay[m.date] || { started:0, full:0 }; });
    const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));

    if(days.length) {
      html += dashSection(t('dash.c.byDay'), days.map(([d, x], i) => {
        const dayLogs = logs.filter(l => l.date === d && tpl[l.template_id])
          .sort((a, b) => (tpl[a.template_id].department || '').localeCompare(tpl[b.template_id].department || '')
                       || tpl[a.template_id].name.localeCompare(tpl[b.template_id].name));
        const dayMiss = misses.filter(m => m.date === d);
        // Лист может быть и начат, и записан в невыполнения (не успели к сроку).
        // В знаменателе он должен считаться один раз, иначе «закрыто 6 из 12»
        // там, где листов было 9.
        const started = new Set(dayLogs.map(l => l.template_id));
        const lateOf = {}; dayMiss.forEach(m => { lateOf[m.template_id] = m; });
        const missOnly = dayMiss.filter(m => !started.has(m.template_id));
        const total = dayLogs.length + missOnly.length;
        const tone = dayMiss.length ? 'var(--bad)' : x.full === x.started ? 'var(--ok)' : 'var(--warn)';
        const right = `<span style="color:${tone}">${t('dash.c.daySub', { full:x.full, started:total })}</span>`;
        const body = dayLogs.map(l => {
          const p = pctOf(l);
          const late = lateOf[l.template_id];
          return dashLine({
            name: escapeHtml(tpl[l.template_id].name), val: p + '%', color: dashTone(p), bar: p,
            meta: t('dash.c.doneOf', { done:(l.items_done || []).length, total:totalOf(l.template_id) }),
            chips: (late ? [dashChip(t('dash.c.lateChip', { time:(late.due_time || '').slice(0, 5) }), 'bad')] : []).concat(whoChips(l)),
          });
        }).join('')
        // Не начатые в этот день чек-листы видны только как невыполнения
        + missOnly.map(m => dashLine({
            name: escapeHtml(m.template_name || '—'), val: t('dash.c.notStarted'), color: 'var(--bad)',
            meta: t('cld.wasDue', { time:(m.due_time || '').slice(0, 5) }),
            chips: nameChips(m.employee_names),
          })).join('');
        return dashFold(fmtDateShort(d, { weekday:'long', day:'numeric', month:'long' }), right, body, i === 0);
      }).join(''), { count: days.length, hint: t('dash.c.dayHint') });
    }

    content.innerHTML = html;
  } catch(e) { content.innerHTML = dashEmpty(t('dash.loadErr') + (e?.message || e)); }
}

// ---- Люди и зарплата ----
async function loadDashPeople() {
  const content = document.getElementById('dashboard-content');
  content.innerHTML = `<div class="loading">${t('dash.collecting')}</div>`;
  if(!canSeeSalaryRole()) { content.innerHTML = dashEmpty(t('dash.p.noAccess')); return; }
  const fids = dashActiveFilials().map(f => f.id);
  const { from, to } = dashDateRange();
  try {
    const [attRes, schedRes, empRes, pointRes] = await Promise.all([
      sb.from('attendance').select('employee_id,date,check_in_time,penalty').in('filial', fids).gte('date', from).lte('date', to),
      sb.from('schedules').select('employee_id,date,shift_start,is_day_off').in('filial', fids).gte('date', from).lte('date', to),
      sb.from('employees').select('id,name,role,department,salary,status'),
      sb.from('waiter_points').select('employee_id,points,category').in('filial', fids).gte('date', from).lte('date', to),
    ]);
    const emp = {}; (empRes.data || []).forEach(e => { emp[e.id] = e; });
    const shiftAt = {};
    const bartendersByDate = {};
    (schedRes.data || []).forEach(s => {
      if(s.is_day_off) return;
      shiftAt[s.employee_id + '_' + s.date] = s.shift_start;
      if(emp[s.employee_id]?.department === 'Бармены') bartendersByDate[s.date] = (bartendersByDate[s.date] || 0) + 1;
    });

    const stat = {};
    (attRes.data || []).forEach(a => {
      const e = emp[a.employee_id];
      if(!e) return;
      const x = stat[a.employee_id] = stat[a.employee_id] || { name:e.name, role:e.role, shifts:0, earned:0, penalty:0, pts:0 };
      x.penalty += Number(a.penalty) || 0;
      if(a.check_in_time) {
        x.shifts++;
        const alone = e.department === 'Бармены' && bartendersByDate[a.date] === 1;
        x.earned += computeShiftPay(e.role, e.salary, shiftAt[a.employee_id + '_' + a.date], alone).amount;
      }
    });
    (pointRes.data || []).forEach(p => { if(stat[p.employee_id]) stat[p.employee_id].pts += Number(p.points) || 0; });

    // Сортируем по той же сумме, что и показываем (за вычетом штрафов), иначе
    // список выглядит перепутанным: 950 000 стоит выше 1 000 000
    const rows = Object.values(stat).filter(r => r.shifts > 0)
      .sort((a, b) => (b.earned - b.penalty) - (a.earned - a.penalty));
    if(rows.length === 0) { content.innerHTML = dashHead(t('dash.tab.people')) + dashEmpty(t('dash.noPeriodData')); return; }
    const fot = rows.reduce((s, r) => s + r.earned - r.penalty, 0);

    content.innerHTML = dashHead(t('dash.tab.people'))
      + dashKpis([
          { val: formatNum(fot), label: t('dash.p.fot'), color: 'var(--gold-dark)' },
          { val: String(rows.reduce((s, r) => s + r.shifts, 0)), label: t('dash.p.shifts') },
        ])
      + '<div class="card">' + rows.map(r => dashRow(r.name,
          [t('dash.p.sub', { n:r.shifts, role:escapeHtml(r.role || '') }),
           r.penalty > 0 ? `<span style="color:#A32D2D">${t('dash.p.penalty', { n:formatNum(r.penalty) })}</span>` : '',
           r.pts > 0 ? `<span style="color:#A32D2D">${t('dash.p.points', { n:r.pts })}</span>` : ''].filter(Boolean).join(' · '),
          formatNum(r.earned - r.penalty))).join('') + '</div>'
      + `<div style="font-size:11px;color:var(--text-muted);padding:0 4px">${t('dash.p.hint')}</div>`;
  } catch(e) { content.innerHTML = dashEmpty(t('dash.loadErr') + (e?.message || e)); }
}

// ---- Позиции официантов: честно ли делится зал ----
// Раздача сама не даёт одну и ту же позицию две смены подряд и выравнивает
// накопленный вес, так что смотреть сюда каждый день не нужно. Вкладка нужна,
// когда официант говорит «мне вечно достаётся слабая»: здесь это либо видно,
// либо опровергается за пять секунд.
//
// Главная цифра — не «сколько раз стоял», а ВЕС НА СМЕНУ. Позиции неравноценны,
// и три смены на топовой стоят больше шести на слабой; сравнивать надо это.
async function loadDashPositions() {
  const content = document.getElementById('dashboard-content');
  content.innerHTML = `<div class="loading">${t('dash.collecting')}</div>`;
  const fids = dashActiveFilials().map(f => f.id);
  const { from, to } = dashDateRange();
  try {
    const [posRes, asgRes] = await Promise.all([
      sb.from('waiter_positions').select('id,name,weight,sort').in('filial', fids).order('sort'),
      sb.from('waiter_position_assignments').select('date,employee_id,employee_name,position_ids,weight,source')
        .in('filial', fids).gte('date', from).lte('date', to).order('date'),
    ]);
    const positions = posRes.data || [];
    const rows = asgRes.data || [];
    if(positions.length === 0 || rows.length === 0) {
      content.innerHTML = dashHead(t('dash.tab.positions')) + dashEmpty(t('dash.pos.noData'));
      return;
    }

    const posById = {}; positions.forEach(p => { posById[p.id] = p; });

    // Копим по человеку: сколько смен на каждой позиции, общий вес, ручные
    // правки и повторы подряд. «Подряд» — по соседним СМЕНАМ человека, а не по
    // календарю: между сменами могут быть выходные, и это всё равно повтор.
    const stat = {};
    rows.forEach(a => {
      const s = stat[a.employee_id] = stat[a.employee_id] || {
        name: a.employee_name || '', shifts: 0, weight: 0, manual: 0,
        byPos: {}, repeats: 0, lastPos: null, days: [],
      };
      const primary = (a.position_ids || [])[0] || null;
      s.shifts++;
      s.weight += Number(a.weight) || 0;
      if(a.source === 'manual') s.manual++;
      (a.position_ids || []).forEach(id => { s.byPos[id] = (s.byPos[id] || 0) + 1; });
      if(primary && s.lastPos && primary === s.lastPos) s.repeats++;
      s.lastPos = primary;
      s.days.push({ date: a.date, ids: a.position_ids || [] });
    });

    const list = Object.values(stat).sort((a, b) => (b.weight / b.shifts) - (a.weight / a.shifts));
    const totalShifts = list.reduce((s, r) => s + r.shifts, 0);
    const totalWeight = list.reduce((s, r) => s + r.weight, 0);
    const repeats = list.reduce((s, r) => s + r.repeats, 0);
    const avg = totalShifts ? totalWeight / totalShifts : 0;
    // Перекос: насколько разошлись лучший и худший по весу на смену. Пока
    // раздача честная, это около нуля; полбалла — уже заметная разница.
    const spread = list.length > 1
      ? (list[0].weight / list[0].shifts) - (list[list.length-1].weight / list[list.length-1].shifts) : 0;

    const fmt1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');

    // Матрица: строки — официанты, столбцы — позиции. Уезжает вбок на телефоне,
    // поэтому в своей прокрутке, а не растягивает экран.
    const matrix = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:600;font-size:11px">${t('dash.pos.waiter')}</th>
          ${positions.map(p => `<th style="padding:6px 8px;color:var(--text-muted);font-weight:600;font-size:11px;white-space:nowrap">${escapeHtml(p.name)}<br><span style="font-weight:400">${t('dash.pos.weightShort',{n:p.weight})}</span></th>`).join('')}
          <th style="padding:6px 8px;color:var(--text-muted);font-weight:600;font-size:11px">${t('dash.pos.perShift')}</th>
        </tr></thead>
        <tbody>${list.map(r => {
          const per = r.weight / r.shifts;
          const tone = Math.abs(per - avg) < 0.35 ? 'var(--ok)' : Math.abs(per - avg) < 0.75 ? 'var(--warn)' : 'var(--bad)';
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:7px 8px;white-space:nowrap">${escapeHtml(dashShortName(r.name))}</td>
            ${positions.map(p => `<td style="padding:7px 8px;text-align:center;color:${r.byPos[p.id]?'var(--text-primary)':'var(--text-muted)'}">${r.byPos[p.id] || '—'}</td>`).join('')}
            <td style="padding:7px 8px;text-align:center;font-weight:700;color:${tone}">${fmt1(per)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;

    // Повторы подряд бывают по двум причинам: расставили руками или у алгоритма
    // не было выбора (двое в смене — вариантов мало). И то и другое стоит видеть.
    const repeatRows = list.filter(r => r.repeats > 0)
      .map(r => dashRow(r.name, t('dash.pos.repeatSub', { n: r.repeats }), String(r.repeats), 'var(--bad)')).join('');

    const manualRows = list.filter(r => r.manual > 0)
      .map(r => dashRow(r.name, t('dash.pos.manualSub', { n: r.manual, all: r.shifts }), `${r.manual}/${r.shifts}`)).join('');

    content.innerHTML = dashHead(t('dash.tab.positions'))
      + dashKpis([
          { val: String(totalShifts), label: t('dash.pos.shifts') },
          { val: fmt1(avg), label: t('dash.pos.avgWeight') },
          { val: fmt1(spread), label: t('dash.pos.spread'),
            color: spread < 0.35 ? 'var(--ok)' : spread < 0.75 ? 'var(--warn)' : 'var(--bad)' },
          { val: String(repeats), label: t('dash.pos.repeats'),
            color: repeats === 0 ? 'var(--ok)' : 'var(--bad)' },
        ])
      + dashSection(t('dash.pos.matrixTitle'), matrix, { hint: t('dash.pos.matrixHint') })
      + dashSection(t('dash.pos.repeatsTitle'), repeatRows, { count: repeatRows ? undefined : 0, color: 'var(--bad)', hint: t('dash.pos.repeatsHint') })
      + dashSection(t('dash.pos.manualTitle'), manualRows, { hint: t('dash.pos.manualHint') })
      + `<div style="font-size:11px;color:var(--text-muted);padding:0 4px">${t('dash.pos.footHint')}</div>`;
  } catch(e) { content.innerHTML = dashEmpty(t('dash.loadErr') + (e?.message || e)); }
}
