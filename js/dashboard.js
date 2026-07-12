// ============ ДАШБОРД ВЛАДЕЛЬЦА ============
let dashPeriod = 'month'; // today | week | month

function dashDateRange() {
  const now = new Date();
  let from;
  if(dashPeriod==='today') from = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  else if(dashPeriod==='week') { from = new Date(now); from.setDate(now.getDate()-6); }
  else from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString().slice(0,10), to: now.toISOString().slice(0,10) };
}

async function loadDashboard() {
  // Раздел заморожен — показываем заглушку. Рабочая версия сохранена в loadDashboardFull().
  const sw = document.getElementById('dash-period-switcher');
  if(sw) sw.innerHTML = '';
  const content = document.getElementById('dashboard-content');
  if(content) content.innerHTML = `
    <div class="card" style="text-align:center;padding:36px 20px">
      <div style="font-size:48px;margin-bottom:12px">🚧</div>
      <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Дашборд в разработке</div>
      <div style="font-size:14px;color:var(--text-muted);line-height:1.5">Раздел скоро заработает.<br>Сводная аналитика по обоим филиалам появится здесь.</div>
    </div>`;
  const sub = document.getElementById('dash-subtitle');
  if(sub) sub.textContent = 'В разработке';
}

async function loadDashboardFull() {
  const sw = document.getElementById('dash-period-switcher');
  const periods = [{id:'today',label:'Сегодня'},{id:'week',label:'Неделя'},{id:'month',label:'Месяц'}];
  sw.innerHTML = periods.map(p=>`<button onclick="setDashPeriod('${p.id}')" style="flex:1;padding:9px;border-radius:10px;border:none;font-size:13px;font-weight:600;cursor:pointer;background:${p.id===dashPeriod?'#A6803F':'var(--surface-2)'};color:${p.id===dashPeriod?'#fff':'var(--text-primary)'}">${p.label}</button>`).join('');

  const content = document.getElementById('dashboard-content');
  content.innerHTML = '<div class="loading">Собираю данные по сети...</div>';
  const { from, to } = dashDateRange();
  const canFin = canSeeFinance();

  try {
    const blocks = [];
    // По каждому филиалу собираем данные
    for(const fil of FILIALS) {
      const fid = fil.id;
      // Финансы
      let income=0, expense=0;
      if(canFin) {
        const { data: fins } = await sb.from('finances').select('amount,type').eq('filial',fid).gte('date',from).lte('date',to);
        (fins||[]).forEach(f=>{ if(f.type==='income') income+=Number(f.amount); else expense+=Number(f.amount); });
      }
      // Задачи
      const { data: tasks } = await sb.from('tasks').select('status').eq('filial',fid).gte('due_date',from).lte('due_date',to);
      const tasksTotal = (tasks||[]).length;
      const tasksDone = (tasks||[]).filter(t=>t.status==='done').length;
      // Явка и опоздания
      const { data: att } = await sb.from('attendance').select('is_late,penalty').eq('filial',fid).gte('date',from).lte('date',to);
      const shifts = (att||[]).length;
      const lates = (att||[]).filter(a=>a.is_late).length;
      const penalties = (att||[]).reduce((s,a)=>s+(Number(a.penalty)||0),0);
      // Брони
      const { data: books } = await sb.from('bookings').select('id').eq('filial',fid).gte('date',from).lte('date',to);
      // Отзывы
      const { data: revs } = await sb.from('reviews').select('sentiment').eq('filial',fid).gte('created_at',from+'T00:00:00');
      const revPos = (revs||[]).filter(r=>r.sentiment==='positive').length;
      const revNeg = (revs||[]).filter(r=>r.sentiment==='negative').length;

      blocks.push({ name: fil.name, income, expense, profit:income-expense, tasksTotal, tasksDone, shifts, lates, penalties, books:(books||[]).length, revPos, revNeg });
    }

    const money = n => formatNum(Math.round(n));
    const periodLabel = dashPeriod==='today'?'сегодня':dashPeriod==='week'?'за неделю':'за месяц';
    document.getElementById('dash-subtitle').textContent = 'Сводка по сети · ' + periodLabel;

    // Итоги по сети
    const totIncome = blocks.reduce((s,b)=>s+b.income,0);
    const totProfit = blocks.reduce((s,b)=>s+b.profit,0);
    const totLates = blocks.reduce((s,b)=>s+b.lates,0);
    const totTasks = blocks.reduce((s,b)=>s+b.tasksTotal,0);
    const totDone = blocks.reduce((s,b)=>s+b.tasksDone,0);

    let html = '';
    // Верхняя сводка по всей сети
    if(canFin) {
      html += `<div class="card" style="background:linear-gradient(135deg,#1a2e1a,#2d4a2d);border:none;color:#e9f0e9;margin-bottom:12px">
        <div style="font-size:11px;opacity:0.7;margin-bottom:8px;text-transform:uppercase">Вся сеть · ${periodLabel}</div>
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div><div style="font-size:22px;font-weight:700">${money(totIncome)}</div><div style="font-size:11px;opacity:0.7">выручка, сум</div></div>
          <div><div style="font-size:22px;font-weight:700;color:${totProfit>=0?'#a3e07a':'#ff9b9b'}">${money(totProfit)}</div><div style="font-size:11px;opacity:0.7">прибыль, сум</div></div>
          <div><div style="font-size:22px;font-weight:700">${totDone}/${totTasks}</div><div style="font-size:11px;opacity:0.7">задачи</div></div>
          <div><div style="font-size:22px;font-weight:700;color:${totLates>0?'#ff9b9b':'#a3e07a'}">${totLates}</div><div style="font-size:11px;opacity:0.7">опозданий</div></div>
        </div>
      </div>`;
    }

    // По каждому филиалу
    html += blocks.map(b=>`
      <div class="card">
        <div style="font-size:15px;font-weight:700;color:var(--gold-dark);margin-bottom:10px">📍 ${b.name}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${canFin?`<div><div style="font-size:12px;color:var(--text-muted)">Выручка</div><div style="font-size:17px;font-weight:700;color:var(--text-primary)">${money(b.income)}</div></div>
          <div><div style="font-size:12px;color:var(--text-muted)">Прибыль</div><div style="font-size:17px;font-weight:700;color:${b.profit>=0?'#3B6D11':'#A32D2D'}">${money(b.profit)}</div></div>`:''}
          <div><div style="font-size:12px;color:var(--text-muted)">Задачи</div><div style="font-size:17px;font-weight:700;color:var(--text-primary)">${b.tasksDone}/${b.tasksTotal}</div></div>
          <div><div style="font-size:12px;color:var(--text-muted)">Смены</div><div style="font-size:17px;font-weight:700;color:var(--text-primary)">${b.shifts}</div></div>
          <div><div style="font-size:12px;color:var(--text-muted)">Опоздания</div><div style="font-size:17px;font-weight:700;color:${b.lates>0?'#A32D2D':'#3B6D11'}">${b.lates}${b.penalties>0&&canFin?` · −${money(b.penalties)}`:''}</div></div>
          <div><div style="font-size:12px;color:var(--text-muted)">Брони</div><div style="font-size:17px;font-weight:700;color:var(--text-primary)">${b.books}</div></div>
          <div><div style="font-size:12px;color:var(--text-muted)">Отзывы</div><div style="font-size:17px;font-weight:700;color:var(--text-primary)">👍${b.revPos} 👎${b.revNeg}</div></div>
        </div>
      </div>`).join('');

    content.innerHTML = html;
  } catch(e) { content.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка загрузки: '+e.message+'</div></div></div>'; }
}

function setDashPeriod(p) { dashPeriod = p; loadDashboard(); }

