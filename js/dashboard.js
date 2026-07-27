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

async function loadDashOverview() {
  const sw = document.getElementById('dash-period-switcher');
  const periods = [{id:'today',label:t('dash.periodToday')},{id:'week',label:t('dash.periodWeek')},{id:'month',label:t('dash.periodMonth')}];
  if(sw) sw.innerHTML = periods.map(p=>`<button onclick="setDashPeriod('${p.id}')" style="flex:1;padding:9px;border-radius:10px;border:none;font-size:13px;font-weight:600;cursor:pointer;background:${p.id===dashPeriod?'var(--gold-dark)':'var(--surface-2)'};color:${p.id===dashPeriod?'#fff':'var(--text-primary)'}">${p.label}</button>`).join('');

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
  const all = [
    { id:'overview',   label:t('dash.tab.overview') },
    { id:'attendance', label:t('dash.tab.attendance') },
    { id:'tasks',      label:t('dash.tab.tasks') },
    { id:'checklists', label:t('dash.tab.checklists') },
    { id:'people',     label:t('dash.tab.people') },
  ];
  return isBoss() ? all.slice(0, 1) : all;
}

function renderDashTabs() {
  const el = document.getElementById('dash-tabs');
  if(!el) return;
  const tabs = dashTabList();
  if(tabs.length < 2) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = tabs.map(x => '<button onclick="setDashTab(\'' + x.id + '\')" class="chip' + (x.id===dashTab?' on':'') + '">' + x.label + '</button>').join('');
}

function setDashTab(id) { dashTab = id; dashClTpl = null; renderDashTabs(); loadDashboardTab(); }

async function loadDashboard() {
  if(!dashTabList().some(x => x.id === dashTab)) dashTab = 'overview';
  renderDashTabs();
  await loadDashboardTab();
}

async function loadDashboardTab() {
  if(dashTab === 'attendance') return loadDashAttendance();
  if(dashTab === 'tasks')      return loadDashTasks();
  if(dashTab === 'checklists') return loadDashChecklists();
  if(dashTab === 'people')     return loadDashPeople();
  return loadDashOverview();
}

// Шапка вкладки: период и охват — чтобы цифры нельзя было прочитать не за тот срок
function dashHead(title, extra) {
  return `<div class="card" style="padding:10px 12px;margin-bottom:10px">
    <div style="font-size:13px;font-weight:700;color:var(--gold-dark)">${title}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${dashPeriodLabel()}${extra ? ' · ' + extra : ''}</div>
  </div>`;
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
      .map(([id, x]) => Object.assign({ id, name: emp[id]?.name || ('#' + id), dept: emp[id]?.department || '' }, x))
      .filter(r => r.planned > 0 || r.came > 0)
      .sort((a, b) => (b.late - a.late) || (a.name > b.name ? 1 : -1));

    if(rows.length === 0) { content.innerHTML = dashHead(t('dash.tab.attendance')) + dashEmpty(t('dash.noPeriodData')); return; }

    const totPlanned = rows.reduce((s, r) => s + r.planned, 0);
    const totCame = rows.reduce((s, r) => s + r.came, 0);
    const totLate = rows.reduce((s, r) => s + r.late, 0);
    const pct = totPlanned ? Math.round(totCame / totPlanned * 100) : 0;

    content.innerHTML = dashHead(t('dash.tab.attendance'))
      + `<div class="card" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;margin-bottom:10px">
          <div><div style="font-size:20px;font-weight:800;color:${pct>=90?'#3B6D11':pct>=70?'#8a6a2f':'#A32D2D'}">${totPlanned?pct+'%':'—'}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.attend')}</div></div>
          <div><div style="font-size:20px;font-weight:800">${totCame}/${totPlanned}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.a.shifts')}</div></div>
          <div><div style="font-size:20px;font-weight:800;color:${totLate?'#A32D2D':'#3B6D11'}">${totLate}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.lates')}</div></div>
        </div>`
      + '<div class="card">' + rows.map(r => {
          const miss = r.planned - r.came;
          const sub = [
            t('dash.a.came', { came:r.came, planned:r.planned }),
            r.late ? `<span style="color:#A32D2D">${t('dash.a.late', { n:r.late, m:Math.round(r.lateMin/r.late) })}</span>` : '',
            miss > 0 ? `<span style="color:#A32D2D">${t('dash.a.missed', { n:miss })}</span>` : '',
            (r.penalty > 0 && canSeeFinance()) ? t('dash.a.penalty', { n:formatNum(r.penalty) }) : '',
          ].filter(Boolean).join(' · ');
          return dashRow(r.name, sub, r.late ? r.late : '✓', r.late ? '#A32D2D' : '#3B6D11');
        }).join('') + '</div>';
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
      + `<div class="card" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;margin-bottom:10px">
          <div><div style="font-size:20px;font-weight:800;color:${pct>=80?'#3B6D11':'#8a6a2f'}">${pct}%</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.t.doneShort')}</div></div>
          <div><div style="font-size:20px;font-weight:800">${done.length}/${tasks.length}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.tasks')}</div></div>
          <div><div style="font-size:20px;font-weight:800;color:${overdue.length?'#A32D2D':'#3B6D11'}">${overdue.length}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.t.overdue')}</div></div>
        </div>`
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

    // ===== Разбор одного чек-листа: по дням =====
    if(dashClTpl) {
      const tt = tpl[dashClTpl];
      const days = logs.filter(l => l.template_id === dashClTpl).sort((a, b) => b.date.localeCompare(a.date));
      let html = `<button onclick="closeDashChecklist()" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:9px 14px;font-size:13px;cursor:pointer;margin-bottom:10px">${t('dash.c.back')}</button>`;
      html += dashHead(tt?.name || '—', tt?.department || '');
      html += days.length ? '<div class="card">' + days.map(l => {
        const counts = {};
        Object.values(l.items_by || {}).forEach(n => { if(n) counts[n] = (counts[n] || 0) + 1; });
        const who = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${escapeHtml(n)} — ${c}`).join(', ');
        const p = pctOf(l);
        return dashRow(fmtDateShort(l.date, { weekday:'short', day:'numeric', month:'short' }),
          `${t('dash.c.doneOf', { done:(l.items_done||[]).length, total:totalOf(l.template_id) })}${who ? ' · ' + who : ''}`,
          (l.completed ? '✅ ' : '') + p + '%', p >= 100 ? '#3B6D11' : p >= 70 ? '#8a6a2f' : '#A32D2D');
      }).join('') + '</div>' : dashEmpty(t('dash.noPeriodData'));
      content.innerHTML = html;
      return;
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

    // ===== По сотрудникам: сколько пунктов отметил каждый =====
    const byPerson = {};
    logs.forEach(l => {
      Object.values(l.items_by || {}).forEach(n => { if(n) byPerson[n] = (byPerson[n] || 0) + 1; });
    });
    const persons = Object.entries(byPerson).sort((a, b) => b[1] - a[1]);

    // ===== По дням: сколько чек-листов закрыто полностью =====
    const byDay = {};
    logs.forEach(l => {
      const d = byDay[l.date] = byDay[l.date] || { started:0, full:0 };
      d.started++;
      if(l.completed) d.full++;
    });
    const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));

    let html = dashHead(t('dash.tab.checklists'));

    html += rows.length
      ? `<div class="card"><div style="font-size:12px;font-weight:700;color:var(--gold-dark);margin-bottom:6px">${t('dash.c.byChecklist')}</div>`
        + rows.map(r => {
            const avg = Math.round(r.sum / r.days);
            return `<div onclick="openDashChecklist(${r.id})" style="cursor:pointer">`
              + dashRow(r.name + ' ›', escapeHtml(r.dept || '') + ' · ' + t('dash.c.daysFull', { full:r.full, days:r.days }),
                  avg + '%', avg >= 95 ? '#3B6D11' : avg >= 70 ? '#8a6a2f' : '#A32D2D')
              + '</div>';
          }).join('') + '</div>'
      : dashEmpty(t('dash.noPeriodData'));

    if(persons.length) {
      html += `<div class="card"><div style="font-size:12px;font-weight:700;color:var(--gold-dark);margin-bottom:6px">${t('dash.c.byPerson')}</div>`
        + persons.map(([n, c]) => dashRow(n, t('dash.c.itemsTicked', { n:c }), c)).join('') + '</div>';
    }

    if(days.length) {
      // День в день: внутри каждого дня каждый чек-лист отдельной строкой —
      // открытие отдельно, закрытие отдельно, а не одна цифра «закрыто 2 из 3».
      html += `<div class="card"><div style="font-size:12px;font-weight:700;color:var(--gold-dark);margin-bottom:6px">${t('dash.c.byDay')}</div>`;
      html += days.map(([d, x]) => {
        const dayLogs = logs.filter(l => l.date === d && tpl[l.template_id])
          .sort((a, b) => (tpl[a.template_id].department || '').localeCompare(tpl[b.template_id].department || '')
                       || tpl[a.template_id].name.localeCompare(tpl[b.template_id].name));
        const dayMiss = misses.filter(m => m.date === d);
        const head = `<div style="display:flex;justify-content:space-between;align-items:baseline;margin:10px 0 4px;padding-top:8px;border-top:1px solid var(--border)">
            <span style="font-size:13px;font-weight:700;color:var(--text-primary)">${fmtDateShort(d, { weekday:'long', day:'numeric', month:'long' })}</span>
            <span style="font-size:12px;font-weight:700;color:${x.full===x.started?'#3B6D11':'#8a6a2f'}">${t('dash.c.daySub', { full:x.full, started:x.started })}</span>
          </div>`;
        const rows = dayLogs.map(l => {
          const counts = {};
          Object.values(l.items_by || {}).forEach(n => { if(n) counts[n] = (counts[n] || 0) + 1; });
          const who = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${escapeHtml(n)} — ${c}`).join(', ');
          const p = pctOf(l);
          return dashRow((l.completed ? '✅ ' : '') + tpl[l.template_id].name,
            t('dash.c.doneOf', { done:(l.items_done || []).length, total:totalOf(l.template_id) }) + (who ? ' · ' + who : ''),
            p + '%', p >= 100 ? '#3B6D11' : p >= 70 ? '#8a6a2f' : '#A32D2D');
        }).join('');
        // Не начатые в этот день чек-листы видны только как невыполнения
        const missRows = dayMiss.map(m => dashRow('⚠️ ' + (m.template_name || '—'),
          t('dash.c.notStarted') + ' · ' + escapeHtml(m.employee_names || '—'), '0%', '#A32D2D')).join('');
        return head + rows + missRows;
      }).join('') + '</div>';
    }

    html += `<div class="card"><div style="font-size:12px;font-weight:700;color:${misses.length?'#A32D2D':'#3B6D11'};margin-bottom:6px">${t('dash.c.misses', { n:misses.length })}</div>`;
    html += misses.length
      ? misses.map(m => dashRow(m.template_name || '—',
          fmtDateShort(m.date, { day:'numeric', month:'short' }) + ' · ' + t('cld.wasDue', { time:(m.due_time || '').slice(0, 5) }) + ' · ' + escapeHtml(m.employee_names || '—'),
          m.points_given > 0 ? '−' + m.points_given : '', '#A32D2D')).join('')
      : `<div style="font-size:12px;color:var(--text-muted)">${t('dash.c.noMisses')}</div>`;
    html += '</div>';
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

    const rows = Object.values(stat).filter(r => r.shifts > 0).sort((a, b) => b.earned - a.earned);
    if(rows.length === 0) { content.innerHTML = dashHead(t('dash.tab.people')) + dashEmpty(t('dash.noPeriodData')); return; }
    const fot = rows.reduce((s, r) => s + r.earned - r.penalty, 0);

    content.innerHTML = dashHead(t('dash.tab.people'))
      + `<div class="card" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center;margin-bottom:10px">
          <div><div style="font-size:20px;font-weight:800;color:var(--gold-dark)">${formatNum(fot)}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.p.fot')}</div></div>
          <div><div style="font-size:20px;font-weight:800">${rows.reduce((s, r) => s + r.shifts, 0)}</div><div style="font-size:11px;color:var(--text-muted)">${t('dash.p.shifts')}</div></div>
        </div>`
      + '<div class="card">' + rows.map(r => dashRow(r.name,
          [t('dash.p.sub', { n:r.shifts, role:escapeHtml(r.role || '') }),
           r.penalty > 0 ? `<span style="color:#A32D2D">${t('dash.p.penalty', { n:formatNum(r.penalty) })}</span>` : '',
           r.pts > 0 ? `<span style="color:#A32D2D">${t('dash.p.points', { n:r.pts })}</span>` : ''].filter(Boolean).join(' · '),
          formatNum(r.earned - r.penalty))).join('') + '</div>'
      + `<div style="font-size:11px;color:var(--text-muted);padding:0 4px">${t('dash.p.hint')}</div>`;
  } catch(e) { content.innerHTML = dashEmpty(t('dash.loadErr') + (e?.message || e)); }
}
