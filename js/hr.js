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
      ? `<button onclick="openPayroll()" style="width:100%;background:linear-gradient(135deg,#2d2416,#4a3a1f);color:#f0e9db;border:none;border-radius:12px;padding:14px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px">💰 Зарплатная ведомость · ${getFilialName(currentFilial)}</button>`
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

