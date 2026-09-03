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
    const canSeeSalary = payrollVisible();   // руководство — по всем, старший цеха — по своим
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
      ? t('hr.found',{n:emps.length})
      : (hrShowAll
        ? t('hr.allStaff',{n:(allEmps||[]).length})
        : t('hr.onFilial',{n:emps.length,f:getFilialName(currentFilial),total:(allEmps||[]).length}));
    const list = document.getElementById('hr-list');
    const payrollBtnEl = document.getElementById('hr-payroll-btn');
    if(payrollBtnEl) payrollBtnEl.innerHTML = (canSeeSalary && !q)
      ? `<button onclick="openDailyPayroll()" style="width:100%;background:linear-gradient(135deg,#22331d,#3b5a2d);color:#eaf3de;border:none;border-radius:12px;padding:14px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px">${t('hr.dailyPayrollBtn',{f:getFilialName(currentFilial)})}</button>
         <button onclick="openPayroll()" style="width:100%;background:linear-gradient(135deg,#2d2416,#4a3a1f);color:#f0e9db;border:none;border-radius:12px;padding:14px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px">${t('hr.monthPayrollBtn',{f:getFilialName(currentFilial)})}</button>`
      : '';
    const toggleBtn = q ? '' : `<div style="padding:0 4px 10px"><button onclick="hrShowAll=!hrShowAll;loadHR()" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${hrShowAll?t('hr.showThisFilial'):t('hr.showAll')}</button></div>`;
    if(!emps||emps.length===0) { list.innerHTML=toggleBtn+`<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">${q?t('hr.nobodyFound'):t('hr.noEmpFilial')}</div></div>`; return; }

    // Группировка по отделам
    const DEPT_ORDER = ['Менеджеры','Официанты','Бармены','Кальянные мастера','Повара'];
    const groups = {};
    emps.forEach(e=>{ const d = e.department || 'Без отдела'; (groups[d]=groups[d]||[]).push(e); });
    const orderedDepts = [...DEPT_ORDER.filter(d=>groups[d]), ...Object.keys(groups).filter(d=>!DEPT_ORDER.includes(d))];

    // Старший цеха правит своих людей прямо отсюда: админ-панель ему не положена,
    // а карточку сотрудника открыть надо. Руководству карточка тоже открывается.
    const empCard = e => `
      <div class="list-item" ${canLeadDept(e.department) ? `onclick="openEditEmployee(${e.id})" style="cursor:pointer"` : ''}>
        <div class="avatar ${getColor(e.name)}">${escapeHtml(getInitials(e.name))}</div>
        <div class="item-info"><div class="item-name">${escapeHtml(e.name)}</div><div class="item-sub">${escapeHtml(e.role||'')} · ${escapeHtml(e.phone||'')}</div><div class="item-sub">${(e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).map(getFilialName).join(', ')}</div>${canSeeSalaryOf(e.department)&&e.salary?`<div class="item-sub">${formatNum(e.salary)} сум</div>`:''}</div>
        ${canSeeSalaryOf(e.department)?`<span class="badge ${e.status==='Активен'?'badge-green':e.status==='Уволен'?'badge-red':'badge-amber'}">${escapeHtml(e.status||'Активен')}</span>`:''}
      </div>`;

    list.innerHTML = toggleBtn + orderedDepts.map(dept=>
      deptSection(dept, groups[dept].length, groups[dept].map(empCard).join(''))
    ).join('');
  } catch(e) { document.getElementById('hr-list').innerHTML=`<div class="loading">${t('hr.loadErr')}</div>`; }
}

// Ведомости видит руководство целиком, старший цеха — только свой отдел.
// Отдельная проверка вместо canSeeSalaryRole(), чтобы не открывать ему чужие цеха.
function payrollVisible() { return canSeeSalaryRole() || isDeptLead(); }
function payrollDeptFilter(dept) { return canSeeSalaryRole() ? true : myLeadDept() === dept; }

// Зарплатная ведомость за текущий месяц (admin/manager)
async function openPayroll() {
  if(!payrollVisible()) return;
  openModal('modal-payroll');
  const body = document.getElementById('payroll-body');
  body.innerHTML = `<div class="loading">${t('hr.calculating')}</div>`;
  try {
    const now = new Date();
    const firstStr = ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastStr = ymdLocal(new Date(now.getFullYear(), now.getMonth()+1, 0));
    document.getElementById('payroll-title').textContent = t('hr.monthLedgerTitle',{month:fmtLocale(now, {month:'long',year:'numeric'}),f:getFilialName(currentFilial)});

    // Сотрудники этого филиала + график за месяц (для точного расчёта по каждой смене)
    const [{ data: allEmps }, { data: att }, { data: sched }, { data: prems }] = await Promise.all([
      sb.from('employees_view').select('*').order('name'),
      sb.from('attendance').select('employee_id,date,check_in_time,penalty').eq('filial', currentFilial).gte('date', firstStr).lte('date', lastStr),
      sb.from('schedules').select('employee_id,date,shift_start,is_day_off').eq('filial', currentFilial).gte('date', firstStr).lte('date', lastStr),
      // Правки руками (доплаты и вычеты). Их выдавали и раньше, но месячная
      // ведомость их не запрашивала вовсе: выданные деньги в расчёт месяца не
      // попадали, и итог не сходился с дневными ведомостями.
      sb.from('premiums').select('id,employee_id,amount,note,date,created_by_name').eq('filial', currentFilial).gte('date', firstStr).lte('date', lastStr).order('date'),
    ]);
    const emps = (allEmps||[]).filter(e => (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial))
                              .filter(e => payrollDeptFilter(e.department));
    const empDept = {}; (allEmps||[]).forEach(e=>{ empDept[e.id]=e.department; });

    // Отработанные дни (по явке) и штрафы за месяц
    const workedByEmp = {};
    (att||[]).forEach(a=>{
      const k = a.employee_id;
      if(!workedByEmp[k]) workedByEmp[k] = { dates:[], penalty:0 };
      if(a.check_in_time) workedByEmp[k].dates.push(a.date);
      workedByEmp[k].penalty += Number(a.penalty)||0;
    });

    // Смена по дню + сколько барменов в графике на каждый день (для бонуса «один в баре»)
    const shiftMap = {};          // empId_date -> shift_start
    const bartendersByDate = {};  // date -> кол-во барменов
    (sched||[]).forEach(s=>{
      if(s.is_day_off) return;
      shiftMap[s.employee_id+'_'+s.date] = s.shift_start;
      if(empDept[s.employee_id]==='Бармены') bartendersByDate[s.date] = (bartendersByDate[s.date]||0)+1;
    });

    // Правки руками по сотруднику за месяц
    const adjByEmp = {};
    (prems||[]).forEach(p => { (adjByEmp[p.employee_id] = adjByEmp[p.employee_id] || []).push(p); });

    // Проценты официантов за месяц (неделя относится к месяцу своего понедельника)
    const bonusByEmp = typeof loadWaiterBonusForMonth === 'function'
      ? await loadWaiterBonusForMonth(firstStr, lastStr) : {};

    let grandTotal = 0;
    const rows = emps.map(e=>{
      const salary = Number(e.salary)||0;
      const w = workedByEmp[e.id] || { dates:[], penalty:0 };
      let earned = 0;
      w.dates.forEach(date=>{
        const shiftStart = shiftMap[e.id+'_'+date];
        const isAlone = e.department==='Бармены' && bartendersByDate[date]===1;
        earned += computeShiftPay(e.role, salary, shiftStart, isAlone).amount;
      });
      const bonus = bonusByEmp[e.id] || { amount:0, weeks:0 };
      const adj = adjByEmp[e.id] || [];
      const adjSum = adj.reduce((sum,p)=>sum + (Number(p.amount)||0), 0);
      const total = earned - w.penalty + bonus.amount + adjSum;
      grandTotal += total;
      return { id:e.id, name:e.name, rate:salary, shifts:w.dates.length, earned, penalty:w.penalty, bonus, adj, adjSum, total };
    }).filter(r=>r.shifts>0 || r.rate>0 || r.adj.length>0);

    if(rows.length===0) { body.innerHTML = `<div class="empty"><div class="empty-text">${t('hr.noMonthData')}</div></div>`; return; }

    body.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${t('hr.monthLedgerHint',{f:getFilialName(currentFilial)})}</div>
      ${rows.map(r=>`
        <div class="list-item" style="flex-wrap:wrap;align-items:flex-start">
          <div class="item-info" style="flex:1 1 100%">
            <div class="item-name">${escapeHtml(r.name)}</div>
            <div class="item-sub">${t('hr.shiftsRate',{n:r.shifts,r:formatNum(r.rate),e:formatNum(r.earned)})}${r.penalty>0?` · <span style="color:#A13C3C">${t('hr.penalty',{p:formatNum(r.penalty)})}</span>`:''}${r.bonus.amount>0?` · <span style="color:#3B6D11">${t('hr.waiterPercent',{a:formatNum(r.bonus.amount),w:r.bonus.weeks})}</span>`:''}${r.adjSum?` · <span style="color:${r.adjSum>0?'#3B6D11':'#A13C3C'}">${t('hr.adjustSum',{s:signedNum(r.adjSum)})}</span>`:''}</div>
            ${r.adj.map(p=>`<div class="item-sub" style="color:var(--text-muted)">${signedNum(p.amount)} — ${escapeHtml(p.note||t('hr.premiumFallback'))} · ${escapeHtml(p.created_by_name||'')}${canEditData()?` <span onclick="deletePremium(${p.id},'month')" style="color:#A32D2D;cursor:pointer;font-weight:700">✕</span>`:''}</div>`).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px;width:100%;justify-content:space-between">
            ${canEditData()?`<button onclick="openAddPremium(${r.id},'${escJsAttr(r.name)}','month')" style="background:#EAF3DE;color:#3B6D11;border:none;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:600;cursor:pointer">${t('hr.adjustBtn')}</button>`:'<span></span>'}
            <div style="font-weight:700;color:var(--text-primary);white-space:nowrap">${formatNum(r.total)}</div>
          </div>
        </div>`).join('')}
      <div class="list-item" style="border-top:2px solid var(--border);margin-top:6px">
        <div class="item-info"><div class="item-name">${t('hr.totalFund')}</div></div>
        <div style="font-weight:700;font-size:16px;color:var(--gold-dark);white-space:nowrap">${formatNum(grandTotal)}</div>
      </div>`;
  } catch(e) { body.innerHTML = `<div class="empty"><div class="empty-text">${t('common.error')+e.message}</div></div>`; }
}

// ===== ДНЕВНАЯ ВЕДОМОСТЬ (кто в смене сегодня + к выплате) =====
async function openDailyPayroll() {
  if(!payrollVisible()) return;
  openModal('modal-daily-payroll');
  const body = document.getElementById('daily-payroll-body');
  body.innerHTML = `<div class="loading">${tr('hr.calculating')}</div>`;
  try {
    const t = businessToday(); // ведомость за кассовый день (смена 12:00–03:00)
    document.getElementById('daily-payroll-title').textContent =
      tr('hr.dailyLedgerTitle',{date:fmtLocale(new Date(t), {day:'numeric',month:'long'}),f:getFilialName(currentFilial)});

    const [schedR, empR, attR, premR] = await Promise.all([
      sb.from('schedules').select('employee_id,employee_name,shift_start,shift_end,is_day_off').eq('filial',currentFilial).eq('date',t),
      sb.from('employees_view').select('id,name,salary,filials,role,department'),
      sb.from('attendance').select('employee_id,check_in_time,is_late,late_minutes,penalty,checkin_video').eq('filial',currentFilial).eq('date',t),
      sb.from('premiums').select('*').eq('filial',currentFilial).eq('date',t)
    ]);
    const empById = {}; (empR.data||[]).forEach(e=>{ empById[e.id]=e; });
    // Старший цеха видит ведомость только своего отдела
    const sched = (schedR.data||[]).filter(s=>!s.is_day_off)
      .filter(s => payrollDeptFilter(empById[s.employee_id]?.department));
    const attById = {}; (attR.data||[]).forEach(a=>{ attById[a.employee_id]=a; });
    const premByEmp = {}; (premR.data||[]).forEach(p=>{ (premByEmp[p.employee_id]=premByEmp[p.employee_id]||[]).push(p); });

    if(sched.length===0) { body.innerHTML = `<div class="empty"><div class="empty-icon">📅</div><div class="empty-text">${tr('hr.nobodyToday')}</div></div>`; return; }

    const canGive = canEditData(); // менеджер/управляющий дают премии; владелец — только смотрит
    // «Один в графике» — сколько барменов в смене сегодня (для бонуса +100 000)
    const bartenderCount = sched.filter(s => empById[s.employee_id]?.department === 'Бармены').length;
    let grand = 0;
    let html = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${tr('hr.dailyHint',{f:getFilialName(currentFilial)})}</div>`;
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
      if(!a || !a.check_in_time) status = `<span style="color:#A13C3C">${tr('hr.notCheckedIn')}</span>`;
      else if(a.is_late) status = tr('hr.arrivedLate',{time:a.check_in_time,m:a.late_minutes||''});
      else status = tr('hr.arrivedOnTime',{time:a.check_in_time});
      // Видео прихода — здесь его смотрит управляющий и менеджер: ведомость за день
      // и есть то место, где разбирают, кто во сколько пришёл.
      if(a && a.checkin_video) {
        status += ` <button onclick="viewReport('${escJsAttr(a.checkin_video)}','video')" title="${tr('hr.checkinVideo')}" style="background:#f0e6d2;color:#8a6a2f;border:none;border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer">🎥</button>`;
      }
      html += `<div class="list-item" style="flex-wrap:wrap;align-items:flex-start">
        <div class="item-info" style="flex:1 1 100%">
          <div class="item-name">${escapeHtml(s.employee_name||emp?.name||'—')}</div>
          <div class="item-sub">🕐 ${s.shift_start||''}–${s.shift_end||''} · ${status}</div>
          <div class="item-sub">${tr('hr.rate',{r:formatNum(rate)})}${pay.note?` <span style="color:var(--gold-dark)">· ${pay.note}</span>`:''}${penalty>0?` · <span style="color:#A13C3C">${tr('hr.penalty',{p:formatNum(penalty)})}</span>`:''}${premSum?` · <span style="color:${premSum>0?'#3B6D11':'#A13C3C'}">${tr('hr.adjustSum',{s:signedNum(premSum)})}</span>`:''}</div>
          ${prems.map(p=>`<div class="item-sub" style="color:var(--text-muted)">${signedNum(p.amount)} — ${escapeHtml(p.note||tr('hr.premiumFallback'))} · ${escapeHtml(p.created_by_name||'')}${canGive?` <span onclick="deletePremium(${p.id},'day')" style="color:#A32D2D;cursor:pointer;font-weight:700">✕</span>`:''}</div>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;width:100%;justify-content:space-between">
          ${canGive?`<button onclick="openAddPremium(${s.employee_id},'${escJsAttr(s.employee_name||emp?.name||'')}','day')" style="background:#EAF3DE;color:#3B6D11;border:none;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:600;cursor:pointer">${tr('hr.adjustBtn')}</button>`:'<span></span>'}
          <div style="font-weight:700;color:var(--text-primary);white-space:nowrap">${tr('hr.toPay',{t:formatNum(total)})}</div>
        </div>
      </div>`;
    });
    html += `<div class="list-item" style="border-top:2px solid var(--border);margin-top:6px">
      <div class="item-info"><div class="item-name">${tr('hr.totalToday')}</div></div>
      <div style="font-weight:700;font-size:16px;color:var(--gold-dark);white-space:nowrap">${formatNum(grand)}</div>
    </div>`;
    body.innerHTML = html;
  } catch(e) { body.innerHTML = `<div class="empty"><div class="empty-text">${tr('common.error')+e.message}</div></div>`; }
}

// Правка зарплаты руками: доплата (плюсом) или вычет (минусом). Хранится в той
// же таблице premiums — это одна и та же сущность «рука руководства в расчёте»,
// а разводить её на две значило бы считать деньги в двух местах.
let premiumForEmp = null, premiumForName = '', premiumReturnTo = 'day';
function openAddPremium(empId, empName, from) {
  if(!canEditData()) return showToast(t('hr.premiumOnlyMgr'));
  premiumForEmp = empId; premiumForName = empName; premiumReturnTo = from || 'day';
  document.getElementById('premium-emp-name').textContent = empName;
  document.getElementById('premium-amount').value = '';
  document.getElementById('premium-note').value = '';
  openModal('modal-add-premium');
}
async function savePremium() {
  if(!canEditData()) return showToast(t('hr.unavailable'));
  const amount = parseFloat(document.getElementById('premium-amount').value);
  // Ноль — не правка, а опечатка. Минус разрешён: им оформляют вычет.
  if(isNaN(amount) || amount === 0) return showToast(t('hr.enterAdjust'));
  const note = document.getElementById('premium-note').value.trim();
  try {
    const { error } = await sb.from('premiums').insert({
      employee_id: premiumForEmp, employee_name: premiumForName, date: businessToday(),
      amount, note: note||null, filial: currentFilial,
      created_by: currentUser.id, created_by_name: currentProfile?.name||currentUser?.email
    });
    if(error) return showToast(t('common.error')+error.message);
    closeModal('modal-add-premium');
    showToast(t('hr.adjustAdded'));
    if(premiumReturnTo === 'month') openPayroll(); else openDailyPayroll();
  } catch(e){ showToast(t('common.error')+e.message); }
}
async function deletePremium(id, from) {
  if(!canEditData()) return;
  if(!await confirmDialog(t('hr.removeAdjust'))) return;
  try {
    const { error } = await sb.from('premiums').delete().eq('id', id);
    if(error) return showToast(t('common.error')+error.message);
    if(from === 'month') openPayroll(); else openDailyPayroll();
  } catch(e){ showToast(t('common.error')+e.message); }
}

// Новый человек по умолчанию принадлежит тому филиалу, в котором его заводят.
// Раньше в разметке стояли обе галочки, и каждый заведённый попадал сразу в оба
// заведения: в графике Истикбола висел весь штат Чехова и наоборот.
function setAddEmployeeFilials() {
  document.querySelectorAll('.emp-filial-checkbox').forEach(c => { c.checked = (c.value === currentFilial); });
}

function openAddEmployee() {
  setAddEmployeeFilials();
  openModal('modal-add-employee');
}

async function addEmployee() {
  // Старший цеха заводит людей только в свой отдел и только рядовыми
  const dept = document.getElementById('emp-department').value;
  if(!canEditData() && !canLeadDept(dept)) return showToast(t('common.observerMode'));
  const name = document.getElementById('emp-name').value.trim();
  const loginVal = document.getElementById('emp-email').value.trim();
  const email = loginVal.includes('@') ? loginVal : loginVal + '@slon.uz';
  const password = document.getElementById('emp-password').value.trim();
  if(!name) return showToast(t('hr.enterName'));
  if(!email||!password) return showToast(t('hr.enterEmailPass'));
  if(password.length<6) return showToast(t('pf.passMin'));
  try {
    // Пустой список молча превращать в «оба филиала» нельзя — именно так штат
    // и расползался по чужим заведениям. Лучше спросить.
    const empFilials = Array.from(document.querySelectorAll('.emp-filial-checkbox:checked')).map(c=>c.value);
    if(!empFilials.length) return showToast(t('hr.pickFilial'));
    const { data: emp, error: empError } = await sb.from('employees').insert({ name, role: document.getElementById('emp-role').value, department: document.getElementById('emp-department').value, phone: document.getElementById('emp-phone').value, salary: document.getElementById('emp-salary').value||null, status:'Активен', filials: empFilials }).select().single();
    if(empError || !emp) { showToast('Ошибка создания карточки: '+(empError?.message||'неизвестная ошибка')); return; }
    // sbAuthOnly — изолированный клиент, чтобы signUp не подменил сессию админа в sb
    const { data: authData, error: authError } = await sbAuthOnly.auth.signUp({ email, password });
    if(authError) {
      // Логин не создался — откатываем карточку сотрудника, чтобы не оставалась "сиротой" без аккаунта
      await sb.from('employees').delete().eq('id', emp.id);
      showToast(t('common.error')+authError.message);
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
    setAddEmployeeFilials();
    showToast(t('hr.empAdded'));
    loadHR();
  } catch(e) { showToast(t('common.error')+e.message); }
}

