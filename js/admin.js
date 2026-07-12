// ADMIN TABS
let currentAdminTab = 'employees';
function switchAdminTab(tab, btn) {
  currentAdminTab = tab;
  ['employees','tasks','analytics','activity','checklists','storage'].forEach(t=>{
    const el = document.getElementById('admin-tab-'+t);
    const b = document.getElementById('atab-'+t);
    if(el) el.style.display = t===tab ? 'block' : 'none';
    if(b) { b.style.background = t===tab ? '#A6803F' : 'rgba(255,255,255,0.15)'; }
  });
  if(tab==='employees') loadAdminEmployees();
  if(tab==='tasks') loadAdminTasks();
  if(tab==='analytics') loadAnalytics();
  if(tab==='activity') loadActivityLog();
  if(tab==='checklists') loadAdminChecklists();
  if(tab==='storage') loadStorageStats();
}

// Статистика хранилища: сколько файлов лежит в бакете
async function loadStorageStats() {
  const el = document.getElementById('storage-stats');
  if(!el) return;
  el.textContent = 'Считаю...';
  try {
    const { data: files, error } = await sb.storage.from('task-reports').list('', { limit: 10000 });
    if(error) { el.textContent = 'Не удалось получить данные хранилища'; return; }
    const count = (files||[]).filter(f=>f.name && f.name!=='.emptyFolderPlaceholder').length;
    el.innerHTML = `Сейчас в хранилище: <b>${count}</b> файлов`;
  } catch(e) { el.textContent = 'Ошибка чтения хранилища'; }
}

// Очистка медиа старше N дней: удаляет файлы из хранилища и ссылки из записей
async function cleanupMedia(days) {
  if(!canEditData()) return showToast('Режим наблюдателя — действие недоступно');
  if(!confirm(`Удалить все фото и видео старше ${days} дней?\n\nСами записи (задачи, чек-листы, сообщения) останутся — удалятся только прикреплённые картинки и видео. Отменить будет нельзя.`)) return;
  showToast('⏳ Чищу старые медиа...');
  try {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const { data: files, error } = await sb.storage.from('task-reports').list('', { limit: 10000 });
    if(error) { showToast('Ошибка доступа к хранилищу'); return; }
    const toDelete = (files||[]).filter(f=>{
      if(!f.name || f.name==='.emptyFolderPlaceholder') return false;
      const created = f.created_at ? new Date(f.created_at) : null;
      return created && created < cutoff;
    }).map(f=>f.name);

    if(toDelete.length===0) { showToast('Нет файлов старше '+days+' дней'); return; }

    // Удаляем пачками по 100
    let deleted = 0;
    for(let i=0;i<toDelete.length;i+=100) {
      const batch = toDelete.slice(i, i+100);
      const { error: delErr } = await sb.storage.from('task-reports').remove(batch);
      if(!delErr) deleted += batch.length;
    }
    await logActivity('cleanup_media', `Удалено ${deleted} файлов старше ${days} дней`);
    showToast(`✅ Удалено ${deleted} файлов`);
    loadStorageStats();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function loadAdminChecklists() {
  try {
    const dateFilter = document.getElementById('admin-checklist-date-filter').value;
    let query = sb.from('checklist_logs').select('*').eq('filial', currentFilial).order('date',{ascending:false}).order('created_at',{ascending:false});
    if(dateFilter) query = query.eq('date', dateFilter);
    const { data: logs } = await query;

    const list = document.getElementById('admin-checklists-list');
    if(!logs || logs.length===0) { list.innerHTML='<div class="card"><div class="empty"><div class="empty-icon">☑️</div><div class="empty-text">Чек-листов пока нет</div></div></div>'; return; }

    // Populate date filter options
    const dateSel = document.getElementById('admin-checklist-date-filter');
    const uniqueDates = [...new Set(logs.map(l=>l.date))].sort().reverse();
    const currentVal = dateSel.value;
    dateSel.innerHTML = '<option value="">Все даты</option>' + uniqueDates.map(d=>`<option value="${d}" ${d===currentVal?'selected':''}>${new Date(d).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</option>`).join('');

    // Get template names
    const templateIds = [...new Set(logs.map(l=>l.template_id))];
    const { data: templates } = await sb.from('checklist_templates').select('id,name,items').in('id', templateIds);
    const templateMap = {};
    (templates||[]).forEach(t => templateMap[t.id] = t);

    list.innerHTML = logs.map(log => {
      const template = templateMap[log.template_id];
      const totalItems = template?.items?.length || 0;
      const doneCount = (log.items_done||[]).length;
      const pct = totalItems ? Math.round(doneCount/totalItems*100) : 0;
      const mediaCount = Object.keys(log.items_media||{}).length;

      return `<div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text-primary)">${escapeHtml(template?.name||'Чек-лист')}</div>
            <div style="font-size:12px;color:#999;margin-top:2px">👤 ${escapeHtml(log.user_name||'')} · ${new Date(log.date).toLocaleDateString('ru-RU')}</div>
          </div>
          <span class="badge ${pct===100?'badge-green':'badge-amber'}">${pct}%</span>
        </div>
        <div class="progress-track" style="margin-top:8px"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div style="font-size:12px;color:#999;margin-top:6px">${doneCount} из ${totalItems} пунктов · ${mediaCount} фото/видео прикреплено</div>
        ${mediaCount>0?`<button onclick='viewChecklistMedia(${JSON.stringify(log.items_media).replace(/'/g,"&#39;")}, ${JSON.stringify(template?.items||[]).replace(/'/g,"&#39;")})' style="margin-top:8px;background:#f0e6d2;color:#8a6a2f;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:500;cursor:pointer;width:100%">📸 Смотреть все фото (${mediaCount})</button>`:''}
      </div>`;
    }).join('');
  } catch(e) { console.error(e); document.getElementById('admin-checklists-list').innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div></div>'; }
}

function viewChecklistMedia(itemsMedia, items) {
  const content = document.getElementById('view-report-content');
  const itemMap = {};
  items.forEach(i => itemMap[i.id] = i.text);
  let html = '<div style="display:flex;flex-direction:column;gap:16px">';
  Object.entries(itemsMedia).forEach(([itemId, media]) => {
    const isVideo = media.type === 'video';
    html += `<div>
      <div style="font-size:13px;color:#666;margin-bottom:6px">${escapeHtml(itemMap[itemId]||'')}</div>
      ${isVideo ? `<video src="${escapeHtml(media.url)}" controls style="width:100%;border-radius:12px"></video>` : `<img src="${escapeHtml(media.url)}" style="width:100%;border-radius:12px">`}
    </div>`;
  });
  html += '</div>';
  content.innerHTML = html;
  openModal('modal-view-report');
}

async function loadAdmin() {
  loadAdminEmployees();
}

async function loadAdminEmployees() {
  try {
    const { data: emps } = await sb.from('employees').select('*').order('name');
    const { data: profiles } = await sb.from('profiles').select('employee_id,role');
    const profileMap = {};
    (profiles||[]).forEach(p=>{ if(p.employee_id) profileMap[p.employee_id]=p.role; });
    const empList = document.getElementById('admin-employees-list');
    if(!emps||emps.length===0) { empList.innerHTML='<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">Сотрудников нет</div></div>'; return; }
    empList.innerHTML = emps.map(e=>`
      <div class="list-item">
        <div class="avatar ${getColor(e.name)}">${escapeHtml(getInitials(e.name))}</div>
        <div class="item-info">
          <div class="item-name">${escapeHtml(e.name)}</div>
          <div class="item-sub">${escapeHtml(e.role||'')} · <span class="badge ${e.status==='Активен'?'badge-green':e.status==='Уволен'?'badge-red':'badge-amber'}" style="font-size:10px">${escapeHtml(e.status||'Активен')}</span></div>
          <div class="item-sub">${e.salary?formatNum(e.salary)+' сум':''}</div>
        </div>
        ${!isBoss()?`<button onclick="openEditEmployee(${e.id})" style="background:#f0e6d2;color:#8a6a2f;border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer">✏️</button>`:''}
      </div>`).join('');
  } catch(e) { console.error(e); document.getElementById('admin-employees-list').innerHTML = '<div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div>'; }
}

async function openEditEmployee(id) {
  const { data: emp } = await sb.from('employees').select('*').eq('id',id).single();
  const { data: profile } = await sb.from('profiles').select('role,user_id').eq('employee_id',id).single();
  if(!emp) return;
  document.getElementById('edit-emp-id').value = id;
  document.getElementById('edit-emp-name').value = emp.name||'';
  document.getElementById('edit-emp-phone').value = emp.phone||'';
  document.getElementById('edit-emp-salary').value = emp.salary||'';
  document.getElementById('edit-emp-password').value = '';
  // Set selects
  const roleEl = document.getElementById('edit-emp-role');
  for(let o of roleEl.options) if(o.value===emp.role) { o.selected=true; break; }
  const deptEl = document.getElementById('edit-emp-department');
  for(let o of deptEl.options) if(o.value===(emp.department||'')) { o.selected=true; break; }
  const statusEl = document.getElementById('edit-emp-status');
  for(let o of statusEl.options) if(o.value===(emp.status||'Активен')) { o.selected=true; break; }
  const sysRoleEl = document.getElementById('edit-emp-system-role');
  const sysRole = profile?.role||'employee';
  for(let o of sysRoleEl.options) if(o.value===sysRole) { o.selected=true; break; }
  const empFilials = emp.filials && emp.filials.length ? emp.filials : ['istikbol','chekhov'];
  document.querySelectorAll('.edit-emp-filial-checkbox').forEach(c=>{ c.checked = empFilials.includes(c.value); });
  openModal('modal-edit-employee');
}

async function saveEmployee() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const id = document.getElementById('edit-emp-id').value;
  const name = document.getElementById('edit-emp-name').value.trim();
  const role = document.getElementById('edit-emp-role').value;
  const department = document.getElementById('edit-emp-department').value;
  const phone = document.getElementById('edit-emp-phone').value;
  const salary = document.getElementById('edit-emp-salary').value;
  const status = document.getElementById('edit-emp-status').value;
  const sysRole = document.getElementById('edit-emp-system-role').value;
  const empFilials = Array.from(document.querySelectorAll('.edit-emp-filial-checkbox:checked')).map(c=>c.value);
  try {
    await sb.from('employees').update({name,role,department,phone,salary:salary||null,status,filials:empFilials.length?empFilials:['istikbol','chekhov']}).eq('id',id);
    await sb.from('profiles').update({role:sysRole,name}).eq('employee_id',id);
    await logActivity('edit_employee', name + ' → ' + role + ', ' + status);
    closeModal('modal-edit-employee');
    showToast('✅ Сохранено');
    loadAdminEmployees();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function changePassword() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const pass = document.getElementById('edit-emp-password').value.trim();
  if(!pass || pass.length<6) return showToast('Пароль минимум 6 символов');
  const id = document.getElementById('edit-emp-id').value;
  const { data: profile } = await sb.from('profiles').select('user_id').eq('employee_id',id).single();
  if(!profile?.user_id) return showToast('Аккаунт не найден');
  showToast('⏳ Меняем пароль...');
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if(!accessToken) return showToast('Сессия истекла, войдите заново');
    const res = await fetch('https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/admin-reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify({ targetUserId: profile.user_id, newPassword: pass })
    });
    const result = await res.json();
    if(!res.ok || result.error) {
      showToast('Ошибка: ' + (result.error || 'не удалось сменить пароль'));
      return;
    }
    document.getElementById('edit-emp-password').value = '';
    await logActivity('change_password', document.getElementById('edit-emp-name').value);
    showToast('✅ Пароль изменён');
  } catch(e) {
    showToast('Ошибка: ' + e.message);
  }
}

async function deleteEmployee(id, name) {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  if(!confirm('Удалить сотрудника ' + name + '?')) return;
  await sb.from('profiles').delete().eq('employee_id', id);
  await sb.from('employees').delete().eq('id', id);
  await logActivity('delete_employee', name);
  showToast('✅ Сотрудник удалён');
  loadAdminEmployees();
}

// Удаление из карточки редактирования (берёт id/имя из открытой модалки)
async function deleteEmployeeFromCard() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const id = document.getElementById('edit-emp-id').value;
  const name = document.getElementById('edit-emp-name').value || 'сотрудника';
  if(!id) return;
  if(!confirm('Удалить '+name+'? Это действие необратимо — сотрудник и его аккаунт будут удалены полностью, логин освободится.\n\nЕсли человек просто уволился, лучше поставить статус «Уволен» вместо удаления.')) return;
  showToast('⏳ Удаляю...');
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if(!accessToken) return showToast('Сессия истекла, войдите заново');
    const res = await fetch('https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/admin-delete-user', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_KEY, 'Authorization':'Bearer '+accessToken },
      body: JSON.stringify({ employeeId: parseInt(id) })
    });
    const result = await res.json();
    if(!res.ok || result.error) {
      // Фолбэк: если функция не задеплоена — хотя бы удалим карточку и профиль
      await sb.from('profiles').delete().eq('employee_id', id);
      await sb.from('employees').delete().eq('id', id);
      showToast('Сотрудник удалён, но логин мог не освободиться. ' + (result.error||''));
    } else {
      showToast(result.authDeleted ? '✅ Сотрудник и аккаунт удалены (логин свободен)' : '✅ Сотрудник удалён');
    }
    await logActivity('delete_employee', name);
    closeModal('modal-edit-employee');
    if(typeof loadAdminEmployees === 'function' && document.getElementById('screen-admin')?.classList.contains('active')) loadAdminEmployees();
    if(typeof loadHR === 'function' && document.getElementById('screen-hr')?.classList.contains('active')) loadHR();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

// TASKS ADMIN
let taskFilters = {};
async function loadAdminTasks(filters={}) {
  try {
    let query = sb.from('tasks').select('*').eq('filial', currentFilial).order('created_at',{ascending:false});
    if(filters.employee) query = query.eq('assigned_to_name', filters.employee);
    if(filters.status) query = query.eq('status', filters.status);
    if(filters.dateFrom) query = query.gte('due_date', filters.dateFrom);
    if(filters.dateTo) query = query.lte('due_date', filters.dateTo);
    const { data: tasks } = await query;
    const taskList = document.getElementById('admin-tasks-list');
    if(!tasks||tasks.length===0) { taskList.innerHTML='<div class="card"><div class="empty"><div class="empty-icon">✅</div><div class="empty-text">Задач нет</div></div></div>'; return; }
    taskList.innerHTML = '<div class="card">'+tasks.map(t=>`
      <div class="list-item">
        <div class="item-info">
          <div class="item-name" style="${t.status==='done'?'text-decoration:line-through;color:#999':''}">${escapeHtml(t.title)}</div>
          <div class="item-sub">👤 ${escapeHtml(t.assigned_to_name||'—')} · ${t.due_date||''} · <span class="${t.status==='done'?'badge badge-green':'badge badge-amber'}">${t.status==='done'?'Выполнено':'Активна'}</span></div>
        </div>
        <button onclick="deleteTask(${t.id})" style="background:#FCEBEB;color:#A32D2D;border:none;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">✕</button>
      </div>`).join('')+'</div>';
  } catch(e) { console.error(e); }
}

async function loadFilterEmployees() {
  const { data: emps } = await sb.from('employees').select('name').order('name');
  const sel = document.getElementById('filter-employee');
  sel.innerHTML = '<option value="">Все сотрудники</option>' + (emps||[]).map(e=>`<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join('');
}

function applyTaskFilter() {
  taskFilters = {
    employee: document.getElementById('filter-employee').value,
    status: document.getElementById('filter-status').value,
    dateFrom: document.getElementById('filter-date-from').value,
    dateTo: document.getElementById('filter-date-to').value
  };
  closeModal('modal-task-filter');
  loadAdminTasks(taskFilters);
}

function clearTaskFilter() {
  taskFilters = {};
  ['filter-employee','filter-status','filter-date-from','filter-date-to'].forEach(id=>document.getElementById(id).value='');
  closeModal('modal-task-filter');
  loadAdminTasks();
}

async function deleteTask(id) {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  await sb.from('tasks').delete().eq('id', id);
  showToast('✅ Задача удалена');
  loadAdminTasks(taskFilters);
}

async function deleteCompletedTasks() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  if(!confirm('Удалить все выполненные задачи?')) return;
  await sb.from('tasks').delete().eq('status','done');
  await logActivity('delete_tasks', 'Удалены все выполненные задачи');
  showToast('✅ Выполненные задачи удалены');
  loadAdminTasks(taskFilters);
}

// ANALYTICS
async function loadAnalytics() {
  try {
    // Employee rating
    const { data: tasks } = await sb.from('tasks').select('assigned_to_name,status,due_date');
    const stats = {};
    (tasks||[]).forEach(t=>{
      if(!t.assigned_to_name) return;
      if(!stats[t.assigned_to_name]) stats[t.assigned_to_name]={total:0,done:0,late:0};
      stats[t.assigned_to_name].total++;
      if(t.status==='done') stats[t.assigned_to_name].done++;
    });
    const sorted = Object.entries(stats).sort((a,b)=>{
      const pctA = a[1].total ? a[1].done/a[1].total : 0;
      const pctB = b[1].total ? b[1].done/b[1].total : 0;
      return pctB - pctA;
    });
    const ratingEl = document.getElementById('admin-rating-list');
    if(sorted.length===0) { ratingEl.innerHTML='<div class="empty"><div class="empty-icon">📊</div><div class="empty-text">Данных пока нет</div></div>'; }
    else {
      ratingEl.innerHTML = sorted.map(([name,s],i)=>{
        const pct = s.total ? Math.round(s.done/s.total*100) : 0;
        const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
        return `<div class="list-item">
          <div class="avatar ${getColor(name)}">${medal||escapeHtml(getInitials(name))}</div>
          <div class="item-info">
            <div class="item-name">${escapeHtml(name)}</div>
            <div class="item-sub">${s.done} из ${s.total} задач выполнено</div>
            <div class="progress-track" style="margin-top:4px"><div class="progress-fill" style="width:${pct}%"></div></div>
          </div>
          <span style="font-size:16px;font-weight:700;color:${pct>=80?'#3B6D11':pct>=50?'#854F0B':'#A32D2D'}">${pct}%</span>
        </div>`;
      }).join('');
    }

    // Finance by weeks
    const { data: fins } = await sb.from('finances').select('amount,type,date').eq('filial', currentFilial).order('date');
    const weeks = {};
    (fins||[]).forEach(f=>{
      if(!f.date) return;
      const d = new Date(f.date);
      const week = 'Нед. ' + getWeekNumber(d) + ' (' + d.toLocaleDateString('ru-RU',{month:'short'}) + ')';
      if(!weeks[week]) weeks[week]={income:0,expense:0};
      if(f.type==='income') weeks[week].income+=Number(f.amount);
      else weeks[week].expense+=Number(f.amount);
    });
    const weeksEl = document.getElementById('admin-finance-weeks');
    const weekEntries = Object.entries(weeks).slice(-6);
    if(weekEntries.length===0) { weeksEl.innerHTML='<div class="empty"><div class="empty-icon">💰</div><div class="empty-text">Данных пока нет</div></div>'; }
    else {
      weeksEl.innerHTML = weekEntries.map(([week,w])=>`
        <div class="list-item">
          <div class="item-info">
            <div class="item-name">${week}</div>
            <div class="item-sub"><span style="color:#0F6E56">+${formatNum(w.income)}</span> / <span style="color:#993C1D">−${formatNum(w.expense)}</span></div>
            <div class="item-sub" style="font-weight:600;color:${w.income-w.expense>=0?'#0F6E56':'#993C1D'}">Прибыль: ${formatNum(w.income-w.expense)} сум</div>
          </div>
        </div>`).join('');
    }
  } catch(e) {
    console.error(e);
    const errHtml = '<div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div>';
    const ratingEl = document.getElementById('admin-rating-list');
    const weeksEl = document.getElementById('admin-finance-weeks');
    if(ratingEl) ratingEl.innerHTML = errHtml;
    if(weeksEl) weeksEl.innerHTML = errHtml;
  }
}

function getWeekNumber(d) {
  const onejan = new Date(d.getFullYear(),0,1);
  return Math.ceil((((d-onejan)/86400000)+onejan.getDay()+1)/7);
}

// ACTIVITY LOG
async function loadActivityLog() {
  try {
    const { data: logs } = await sb.from('activity_log').select('*').order('created_at',{ascending:false}).limit(50);
    const el = document.getElementById('admin-activity-list');
    if(!logs||logs.length===0) { el.innerHTML='<div class="empty"><div class="empty-icon">📜</div><div class="empty-text">Активности пока нет</div></div>'; return; }
    const actionLabels = {
      'add_task':'➕ Задача назначена','edit_employee':'✏️ Сотрудник изменён',
      'delete_employee':'🗑 Сотрудник удалён','delete_tasks':'🗑 Задачи очищены',
      'task_done':'✅ Задача выполнена'
    };
    el.innerHTML = logs.map(l=>`
      <div class="list-item">
        <div class="item-info">
          <div class="item-name">${escapeHtml(actionLabels[l.action]||l.action)}</div>
          <div class="item-sub">👤 ${escapeHtml(l.user_name||'—')} · ${escapeHtml(l.details||'')}</div>
          <div class="item-sub">${new Date(l.created_at).toLocaleString('ru-RU')}</div>
        </div>
      </div>`).join('');
  } catch(e) { console.error(e); document.getElementById('admin-activity-list').innerHTML = '<div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div>'; }
}

