let hrShowAll = false;
let hrSearchQuery = '';
let _hrSearchTimer = null;
function hrSearch(v) {
  hrSearchQuery = v;
  clearTimeout(_hrSearchTimer);
  _hrSearchTimer = setTimeout(loadHR, 250);
}
async function loadHR() {
  try {
    const role = currentProfile?.role;
    const canSeeSalary = canSeeSalaryRole();
    const { data: allEmps } = await sb.from('employees_view').select('*').order('name');
    let emps = hrShowAll ? (allEmps||[]) : (allEmps||[]).filter(e => (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));
    // Фильтр по поиску (имя, должность, телефон)
    const q = (hrSearchQuery||'').trim().toLowerCase();
    if(q) {
      emps = emps.filter(e =>
        (e.name||'').toLowerCase().includes(q) ||
        (e.role||'').toLowerCase().includes(q) ||
        (e.department||'').toLowerCase().includes(q) ||
        (e.phone||'').toLowerCase().includes(q)
      );
    }
    document.getElementById('hr-count').textContent = q
      ? `Найдено: ${emps.length}`
      : (hrShowAll
        ? `${(allEmps||[]).length} человек в штате (все филиалы)`
        : `${emps.length} на филиале «${getFilialName(currentFilial)}» · всего ${(allEmps||[]).length}`);
    const list = document.getElementById('hr-list');
    const payrollBtnEl = document.getElementById('hr-payroll-btn');
    if(payrollBtnEl) payrollBtnEl.innerHTML = (canSeeSalary && !q)
      ? `<button onclick="openDailyPayroll()" style="width:100%;background:linear-gradient(135deg,#22331d,#3b5a2d);color:#eaf3de;border:none;border-radius:12px;padding:14px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px">💵 Ведомость на сегодня · ${getFilialName(currentFilial)}</button>
         <button onclick="openPayroll()" style="width:100%;background:linear-gradient(135deg,#2d2416,#4a3a1f);color:#f0e9db;border:none;border-radius:12px;padding:14px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px">💰 Зарплата за месяц · ${getFilialName(currentFilial)}</button>`
      : '';
    const toggleBtn = q ? '' : `<div style="padding:0 4px 10px"><button onclick="hrShowAll=!hrShowAll;loadHR()" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${hrShowAll?'📍 Показать только этот филиал':'👥 Показать всех сотрудников'}</button></div>`;
    if(!emps||emps.length===0) { list.innerHTML=toggleBtn+'<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">'+(q?'Никто не найден':'Нет сотрудников для этого филиала')+'</div></div>'; return; }

    // Группировка по отделам
    const DEPT_ORDER = ['Менеджеры','Официанты','Бармены','Кальянные мастера','Повара','Техперсонал'];
    const DEPT_ICONS = {'Менеджеры':'📋','Официанты':'🍽️','Бармены':'🍹','Кальянные мастера':'💨','Повара':'👨‍🍳','Техперсонал':'🔧'};
    const groups = {};
    emps.forEach(e=>{ const d = e.department || 'Без отдела'; (groups[d]=groups[d]||[]).push(e); });
    const orderedDepts = [...DEPT_ORDER.filter(d=>groups[d]), ...Object.keys(groups).filter(d=>!DEPT_ORDER.includes(d))];

    const empCard = e => `
      <div class="list-item">
        <div class="avatar ${getColor(e.name)}">${escapeHtml(getInitials(e.name))}</div>
        <div class="item-info"><div class="item-name">${escapeHtml(e.name)}</div><div class="item-sub">${escapeHtml(e.role||'')} · ${escapeHtml(e.phone||'')}</div><div class="item-sub">${(e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).map(getFilialName).join(', ')}</div>${canSeeSalary&&e.salary?`<div class="item-sub">${formatNum(e.salary)} сум</div>`:''}</div>
        ${canSeeSalary?`<span class="badge ${e.status==='Активен'?'badge-green':e.status==='Уволен'?'badge-red':'badge-amber'}">${escapeHtml(e.status||'Активен')}</span>`:''}
      </div>`;

    list.innerHTML = toggleBtn + orderedDepts.map(dept=>`
      <div style="margin:14px 4px 6px;font-size:13px;font-weight:700;color:var(--gold-dark);text-transform:uppercase;letter-spacing:0.5px">${DEPT_ICONS[dept]||'👥'} ${dept} · ${groups[dept].length}</div>
      ${groups[dept].map(empCard).join('')}
    `).join('');
  } catch(e) { document.getElementById('hr-list').innerHTML='<div class="loading">Ошибка</div>'; }
}

// Зарплатная ведомость за текущий месяц (admin/manager)
async function openPayroll() {
  if(!canSeeSalaryRole()) return;
  openModal('modal-payroll');
  const body = document.getElementById('payroll-body');
  body.innerHTML = '<div class="loading">Считаю...</div>';
  try {
    const now = new Date();
    const firstStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const lastStr = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10);
    document.getElementById('payroll-title').textContent = `💰 Ведомость · ${now.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})} · ${getFilialName(currentFilial)}`;

    // Сотрудники этого филиала
    const { data: allEmps } = await sb.from('employees_view').select('*').order('name');
    const emps = (allEmps||[]).filter(e => (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));

    // Явка за месяц по этому филиалу
    const { data: att } = await sb.from('attendance').select('*').eq('filial', currentFilial).gte('date', firstStr).lte('date', lastStr);
    const byEmp = {};
    (att||[]).forEach(a=>{
      const k = a.employee_id;
      if(!byEmp[k]) byEmp[k] = { shifts:0, penalty:0 };
      if(a.check_in_time) byEmp[k].shifts++;
      byEmp[k].penalty += Number(a.penalty)||0;
    });

    let grandTotal = 0;
    const rows = emps.map(e=>{
      const rate = Number(e.salary)||0;
      const d = byEmp[e.id] || { shifts:0, penalty:0 };
      const earned = d.shifts * rate;
      const total = earned - d.penalty;
      grandTotal += total;
      return { name:e.name, rate, shifts:d.shifts, earned, penalty:d.penalty, total };
    }).filter(r=>r.shifts>0 || r.rate>0);

    if(rows.length===0) { body.innerHTML = '<div class="empty"><div class="empty-text">Нет данных за месяц</div></div>'; return; }

    body.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Смены × ставка − штрафы за опоздания. Данные по филиалу «${getFilialName(currentFilial)}».</div>
      ${rows.map(r=>`
        <div class="list-item">
          <div class="item-info">
            <div class="item-name">${escapeHtml(r.name)}</div>
            <div class="item-sub">${r.shifts} смен × ${formatNum(r.rate)} = ${formatNum(r.earned)}${r.penalty>0?` · <span style="color:#A13C3C">штраф −${formatNum(r.penalty)}</span>`:''}</div>
          </div>
          <div style="font-weight:700;color:var(--text-primary);white-space:nowrap">${formatNum(r.total)}</div>
        </div>`).join('')}
      <div class="list-item" style="border-top:2px solid var(--border);margin-top:6px">
        <div class="item-info"><div class="item-name">ИТОГО фонд оплаты</div></div>
        <div style="font-weight:700;font-size:16px;color:var(--gold-dark);white-space:nowrap">${formatNum(grandTotal)}</div>
      </div>`;
  } catch(e) { body.innerHTML = '<div class="empty"><div class="empty-text">Ошибка: '+e.message+'</div></div>'; }
}

// ===== ДНЕВНАЯ ВЕДОМОСТЬ (кто в смене сегодня + к выплате) =====
async function openDailyPayroll() {
  if(!canSeeSalaryRole()) return;
  openModal('modal-daily-payroll');
  const body = document.getElementById('daily-payroll-body');
  body.innerHTML = '<div class="loading">Считаю...</div>';
  try {
    const t = today();
    document.getElementById('daily-payroll-title').textContent =
      `💵 Ведомость на сегодня · ${new Date(t).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})} · ${getFilialName(currentFilial)}`;

    const [schedR, empR, attR, premR] = await Promise.all([
      sb.from('schedules').select('employee_id,employee_name,shift_start,shift_end,is_day_off').eq('filial',currentFilial).eq('date',t),
      sb.from('employees_view').select('id,name,salary,filials,role,department'),
      sb.from('attendance').select('employee_id,check_in_time,is_late,late_minutes,penalty').eq('filial',currentFilial).eq('date',t),
      sb.from('premiums').select('*').eq('filial',currentFilial).eq('date',t)
    ]);
    const sched = (schedR.data||[]).filter(s=>!s.is_day_off);
    const empById = {}; (empR.data||[]).forEach(e=>{ empById[e.id]=e; });
    const attById = {}; (attR.data||[]).forEach(a=>{ attById[a.employee_id]=a; });
    const premByEmp = {}; (premR.data||[]).forEach(p=>{ (premByEmp[p.employee_id]=premByEmp[p.employee_id]||[]).push(p); });

    if(sched.length===0) { body.innerHTML = '<div class="empty"><div class="empty-icon">📅</div><div class="empty-text">На сегодня в смене никого нет</div></div>'; return; }

    const canGive = canEditData(); // менеджер/управляющий дают премии; владелец — только смотрит
    // «Один в графике» — сколько барменов в смене сегодня (для бонуса +100 000)
    const bartenderCount = sched.filter(s => empById[s.employee_id]?.department === 'Бармены').length;
    let grand = 0;
    let html = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Оплата по смене − штрафы + премии. По графику на сегодня, филиал «${getFilialName(currentFilial)}».</div>`;
    sched.forEach(s => {
      const emp = empById[s.employee_id];
      const isAlone = emp?.department === 'Бармены' && bartenderCount === 1;
      const pay = computeShiftPay(emp?.role, emp?.salary, s.shift_start, isAlone);
      const rate = pay.amount;
      const a = attById[s.employee_id];
      const penalty = Number(a?.penalty)||0;
      const prems = premByEmp[s.employee_id]||[];
      const premSum = prems.reduce((x,p)=>x+Number(p.amount||0),0);
      const total = rate - penalty + premSum;
      grand += total;
      let status;
      if(!a || !a.check_in_time) status = '<span style="color:#A13C3C">не отметился</span>';
      else if(a.is_late) status = `пришёл <b>${a.check_in_time}</b> · <span style="color:#A13C3C">опоздал ${a.late_minutes||''}м</span>`;
      else status = `пришёл <b>${a.check_in_time}</b> · <span style="color:#3B6D11">вовремя</span>`;
      html += `<div class="list-item" style="flex-wrap:wrap;align-items:flex-start">
        <div class="item-info" style="flex:1 1 100%">
          <div class="item-name">${escapeHtml(s.employee_name||emp?.name||'—')}</div>
          <div class="item-sub">🕐 ${s.shift_start||''}–${s.shift_end||''} · ${status}</div>
          <div class="item-sub">Ставка ${formatNum(rate)}${pay.note?` <span style="color:var(--gold-dark)">· ${pay.note}</span>`:''}${penalty>0?` · <span style="color:#A13C3C">штраф −${formatNum(penalty)}</span>`:''}${premSum>0?` · <span style="color:#3B6D11">премия +${formatNum(premSum)}</span>`:''}</div>
          ${prems.map(p=>`<div class="item-sub" style="color:var(--text-muted)">+${formatNum(p.amount)} — ${escapeHtml(p.note||'премия')} · ${escapeHtml(p.created_by_name||'')}${canGive?` <span onclick="deletePremium(${p.id})" style="color:#A32D2D;cursor:pointer;font-weight:700">✕</span>`:''}</div>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;width:100%;justify-content:space-between">
          ${canGive?`<button onclick="openAddPremium(${s.employee_id},'${escJsAttr(s.employee_name||emp?.name||'')}')" style="background:#EAF3DE;color:#3B6D11;border:none;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:600;cursor:pointer">+ Премия</button>`:'<span></span>'}
          <div style="font-weight:700;color:var(--text-primary);white-space:nowrap">К выплате: ${formatNum(total)}</div>
        </div>
      </div>`;
    });
    html += `<div class="list-item" style="border-top:2px solid var(--border);margin-top:6px">
      <div class="item-info"><div class="item-name">ИТОГО к выплате за сегодня</div></div>
      <div style="font-weight:700;font-size:16px;color:var(--gold-dark);white-space:nowrap">${formatNum(grand)}</div>
    </div>`;
    body.innerHTML = html;
  } catch(e) { body.innerHTML = '<div class="empty"><div class="empty-text">Ошибка: '+e.message+'</div></div>'; }
}

let premiumForEmp = null, premiumForName = '';
function openAddPremium(empId, empName) {
  if(!canEditData()) return showToast('Премии может давать менеджер или управляющий');
  premiumForEmp = empId; premiumForName = empName;
  document.getElementById('premium-emp-name').textContent = empName;
  document.getElementById('premium-amount').value = '';
  document.getElementById('premium-note').value = '';
  openModal('modal-add-premium');
}
async function savePremium() {
  if(!canEditData()) return showToast('Недоступно');
  const amount = parseFloat(document.getElementById('premium-amount').value);
  if(isNaN(amount) || amount<=0) return showToast('Введите сумму премии');
  const note = document.getElementById('premium-note').value.trim();
  try {
    const { error } = await sb.from('premiums').insert({
      employee_id: premiumForEmp, employee_name: premiumForName, date: today(),
      amount, note: note||null, filial: currentFilial,
      created_by: currentUser.id, created_by_name: currentProfile?.name||currentUser?.email
    });
    if(error) return showToast('Ошибка: '+error.message);
    closeModal('modal-add-premium');
    showToast('✅ Премия добавлена');
    openDailyPayroll();
  } catch(e){ showToast('Ошибка: '+e.message); }
}
async function deletePremium(id) {
  if(!canEditData()) return;
  if(!await confirmDialog('Убрать эту премию?')) return;
  try {
    const { error } = await sb.from('premiums').delete().eq('id', id);
    if(error) return showToast('Ошибка: '+error.message);
    openDailyPayroll();
  } catch(e){ showToast('Ошибка: '+e.message); }
}

async function addEmployee() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const name = document.getElementById('emp-name').value.trim();
  const loginVal = document.getElementById('emp-email').value.trim();
  const email = loginVal.includes('@') ? loginVal : loginVal + '@slon.uz';
  const password = document.getElementById('emp-password').value.trim();
  if(!name) return showToast('Введите имя');
  if(!email||!password) return showToast('Введите email и пароль');
  if(password.length<6) return showToast('Пароль минимум 6 символов');
  try {
    const empFilials = Array.from(document.querySelectorAll('.emp-filial-checkbox:checked')).map(c=>c.value);
    const { data: emp, error: empError } = await sb.from('employees').insert({ name, role: document.getElementById('emp-role').value, department: document.getElementById('emp-department').value, phone: document.getElementById('emp-phone').value, salary: document.getElementById('emp-salary').value||null, status:'Активен', filials: empFilials.length?empFilials:['istikbol','chekhov'] }).select().single();
    if(empError || !emp) { showToast('Ошибка создания карточки: '+(empError?.message||'неизвестная ошибка')); return; }
    // sbAuthOnly — изолированный клиент, чтобы signUp не подменил сессию админа в sb
    const { data: authData, error: authError } = await sbAuthOnly.auth.signUp({ email, password });
    if(authError) {
      // Логин не создался — откатываем карточку сотрудника, чтобы не оставалась "сиротой" без аккаунта
      await sb.from('employees').delete().eq('id', emp.id);
      showToast('Ошибка: '+authError.message);
      return;
    }
    if(authData.user) {
      const systemRole = document.getElementById('emp-system-role').value;
      const { error: profileError } = await sb.from('profiles').insert({ user_id: authData.user.id, name, role: systemRole, employee_id: emp.id });
      if(profileError) {
        await sb.from('employees').delete().eq('id', emp.id);
        showToast('Ошибка создания профиля: '+profileError.message+'. Карточка отменена. Логин мог остаться в системе входа — проверьте Supabase → Authentication → Users.');
        return;
      }
    }
    if(typeof invalidateScheduleEmps === 'function') invalidateScheduleEmps();
    closeModal('modal-add-employee');
    ['emp-name','emp-phone','emp-salary','emp-email','emp-password'].forEach(id=>document.getElementById(id).value='');
    document.querySelectorAll('.emp-filial-checkbox').forEach(c=>c.checked=true);
    showToast('✅ Сотрудник добавлен');
    loadHR();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

