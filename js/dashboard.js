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
  return dashPeriod==='today' ? 'сегодня' : dashPeriod==='week' ? 'за неделю' : 'за месяц';
}

// Текущий период
function dashDateRange() {
  const now = new Date();
  let from;
  if(dashPeriod==='today') from = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  else if(dashPeriod==='week') { from = new Date(now); from.setDate(now.getDate()-6); }
  else from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString().slice(0,10), to: now.toISOString().slice(0,10) };
}

// Сопоставимый предыдущий период (равной длины) для сравнения ↑↓
function dashPrevRange() {
  const now = new Date();
  if(dashPeriod==='today') {
    const y = new Date(now); y.setDate(now.getDate()-1);
    const s = y.toISOString().slice(0,10);
    return { from: s, to: s };
  } else if(dashPeriod==='week') {
    const to = new Date(now); to.setDate(now.getDate()-7);
    const from = new Date(now); from.setDate(now.getDate()-13);
    return { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) };
  } else {
    // Прошлый месяц до того же числа (честное сравнение с неполным текущим)
    const day = now.getDate();
    const pFrom = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const pTo = new Date(now.getFullYear(), now.getMonth()-1, Math.min(day, lastDayPrev));
    return { from: pFrom.toISOString().slice(0,10), to: pTo.toISOString().slice(0,10) };
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
  const periods = [{id:'today',label:'Сегодня'},{id:'week',label:'Неделя'},{id:'month',label:'Месяц'}];
  if(sw) sw.innerHTML = periods.map(p=>`<button onclick="setDashPeriod('${p.id}')" style="flex:1;padding:9px;border-radius:10px;border:none;font-size:13px;font-weight:600;cursor:pointer;background:${p.id===dashPeriod?'var(--gold-dark)':'var(--surface-2)'};color:${p.id===dashPeriod?'#fff':'var(--text-primary)'}">${p.label}</button>`).join('');

  const content = document.getElementById('dashboard-content');
  content.innerHTML = '<div class="loading">Собираю данные...</div>';

  const activeFilials = dashActiveFilials();
  const fids = activeFilials.map(f=>f.id);
  const { from, to } = dashDateRange();
  const prev = dashPrevRange();
  const canFin = canSeeFinance();
  const money = n => formatNum(Math.round(n));
  const pl = dashPeriodLabel();
  const scope = activeFilials.length===1 ? activeFilials[0].name : 'Вся сеть';

  try {
    // ---- Текущий период ----
    const [finRes, taskRes, attRes, schedRes, bookRes, revRes] = await Promise.all([
      canFin ? sb.from('finances').select('amount,type').in('filial',fids).gte('date',from).lte('date',to) : Promise.resolve({data:[]}),
      sb.from('tasks').select('status,assigned_to_name').in('filial',fids).gte('due_date',from).lte('due_date',to),
      sb.from('attendance').select('is_late,penalty,late_minutes,check_in_time,employee_id').in('filial',fids).gte('date',from).lte('date',to),
      sb.from('schedules').select('employee_id,is_day_off').in('filial',fids).gte('date',from).lte('date',to),
      sb.from('bookings').select('id').in('filial',fids).gte('date',from).lte('date',to),
      sb.from('reviews').select('sentiment').in('filial',fids).gte('created_at',from+'T00:00:00').lte('created_at',to+'T23:59:59'),
    ]);

    // ---- Предыдущий период (только для сравнения) ----
    const [pFinRes, pAttRes] = await Promise.all([
      canFin ? sb.from('finances').select('amount,type').in('filial',fids).gte('date',prev.from).lte('date',prev.to) : Promise.resolve({data:[]}),
      sb.from('attendance').select('is_late').in('filial',fids).gte('date',prev.from).lte('date',prev.to),
    ]);

    // ---- Сотрудники (для рейтинга и фонда оплаты) ----
    const { data: allEmps } = await sb.from('employees').select('id,name,salary,status,filials');
    const emps = (allEmps||[]).filter(e => e.status!=='Уволен' && (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).some(f=>fids.includes(f)));
    const empName = {}; emps.forEach(e=>{ empName[e.id]=e.name; });
    const payrollFund = emps.reduce((s,e)=>s+(Number(e.salary)||0),0);

    // Выручка за текущий месяц — для доли фонда оплаты (это месячный показатель)
    let monthIncome = 0;
    if(canFin) {
      const mFromStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
      const { data: mFins } = await sb.from('finances').select('amount,type').in('filial',fids).gte('date',mFromStr);
      (mFins||[]).forEach(f=>{ if(f.type==='income') monthIncome+=Number(f.amount); });
    }

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

    const plannedShifts = (schedRes.data||[]).filter(s=>!s.is_day_off).length;
    const attendPct = plannedShifts ? Math.round(checkins/plannedShifts*100) : 0;

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
        ${canFin?`<div><div style="font-size:22px;font-weight:700">${money(income)}${dashDelta(income,pIncome)}</div><div style="font-size:11px;opacity:0.7">выручка, сум</div></div>
        <div><div style="font-size:22px;font-weight:700;color:${profit>=0?'#a3e07a':'#ff9b9b'}">${money(profit)}${dashDelta(profit,pProfit)}</div><div style="font-size:11px;opacity:0.7">прибыль, сум</div></div>`:''}
        <div><div style="font-size:22px;font-weight:700">${tasksDone}/${tasksTotal}</div><div style="font-size:11px;opacity:0.7">задачи · ${taskPct}%</div></div>
        <div><div style="font-size:22px;font-weight:700;color:${lates>0?'#ff9b9b':'#a3e07a'}">${lates}${dashDelta(lates,pLates,true)}</div><div style="font-size:11px;opacity:0.7">опозданий</div></div>
      </div>
      <div style="font-size:10px;opacity:0.55;margin-top:10px">↑↓ — сравнение с предыдущим периодом</div>
    </div>`;

    // Фонд оплаты труда
    if(canFin) {
      const share = monthIncome>0 ? Math.round(payrollFund/monthIncome*100) : null;
      html += `<div class="card">
        <div style="font-size:13px;font-weight:700;color:var(--gold-dark);margin-bottom:8px">💰 Фонд оплаты труда</div>
        <div style="display:flex;justify-content:space-between;align-items:end">
          <div><div style="font-size:22px;font-weight:700;color:var(--text-primary)">${money(payrollFund)}</div><div style="font-size:11px;color:var(--text-muted)">оклады из карточек · ${emps.length} чел.</div></div>
          ${share!==null?`<div style="text-align:right"><div style="font-size:22px;font-weight:700;color:${share>50?'#A32D2D':'#3B6D11'}">${share}%</div><div style="font-size:11px;color:var(--text-muted)">от выручки за месяц</div></div>`:''}
        </div>
      </div>`;
    }

    // Явка и дисциплина
    html += `<div class="card">
      <div style="font-size:13px;font-weight:700;color:var(--gold-dark);margin-bottom:10px">📋 Явка и дисциплина · ${pl}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center">
        <div><div style="font-size:20px;font-weight:700;color:${attendPct>=90?'#3B6D11':attendPct>=70?'#8a6a2f':'#A32D2D'}">${plannedShifts?attendPct+'%':'—'}</div><div style="font-size:11px;color:var(--text-muted)">явка<br>${checkins}/${plannedShifts} смен</div></div>
        <div><div style="font-size:20px;font-weight:700;color:${taskPct>=80?'#3B6D11':'#8a6a2f'}">${tasksTotal?taskPct+'%':'—'}</div><div style="font-size:11px;color:var(--text-muted)">задачи<br>${tasksDone}/${tasksTotal}</div></div>
        <div><div style="font-size:20px;font-weight:700;color:${avgLate>0?'#A32D2D':'#3B6D11'}">${lates?avgLate+'м':'0'}</div><div style="font-size:11px;color:var(--text-muted)">ср. опоздание<br>${lates} случаев</div></div>
      </div>
      ${penalties>0&&canFin?`<div style="font-size:11px;color:#A32D2D;margin-top:8px">Удержано штрафов за период: −${money(penalties)} сум</div>`:''}
    </div>`;

    // Рейтинг сотрудников
    const medal = ['🥇','🥈','🥉'];
    let ratingHtml = '';
    if(topDone.length) {
      ratingHtml += `<div style="font-size:12px;font-weight:600;color:#3B6D11;margin-bottom:6px">✅ Больше всего задач</div>`;
      ratingHtml += topDone.map((e,i)=>`<div class="list-item"><div class="item-info"><div class="item-name">${medal[i]||''} ${escapeHtml(e[0])}</div></div><span style="font-weight:700;color:var(--gold-dark)">${e[1]}</span></div>`).join('');
    }
    if(topLate.length) {
      ratingHtml += `<div style="font-size:12px;font-weight:600;color:#A32D2D;margin:12px 0 6px">⏰ Больше всего опозданий</div>`;
      ratingHtml += topLate.map(e=>`<div class="list-item"><div class="item-info"><div class="item-name">${escapeHtml(e[0])}</div></div><span class="badge badge-red">${e[1]}</span></div>`).join('');
    }
    if(!ratingHtml) ratingHtml = '<div class="empty"><div class="empty-text">Пока нет данных за период</div></div>';
    html += `<div class="card"><div style="font-size:13px;font-weight:700;color:var(--gold-dark);margin-bottom:8px">🏆 Рейтинг сотрудников · ${pl}</div>${ratingHtml}</div>`;

    // Брони и отзывы
    html += `<div class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:center">
        <div><div style="font-size:20px;font-weight:700;color:var(--text-primary)">${books}</div><div style="font-size:11px;color:var(--text-muted)">броней ${pl}</div></div>
        <div><div style="font-size:20px;font-weight:700;color:var(--text-primary)">👍${revPos} 👎${revNeg}</div><div style="font-size:11px;color:var(--text-muted)">отзывы</div></div>
      </div>
    </div>`;

    content.innerHTML = html;
  } catch(e) {
    console.error('dashboard', e);
    content.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка загрузки: '+(e?.message||e)+'</div></div></div>';
  }
}

function setDashPeriod(p) { dashPeriod = p; loadDashboard(); }
