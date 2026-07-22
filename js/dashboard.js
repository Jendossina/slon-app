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

async function loadDashboard() {
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

function setDashPeriod(p) { dashPeriod = p; loadDashboard(); }
