// Уровень должности внутри своего отдела — используется, чтобы старшие по должности
// сотрудники видели задачи тех, кто на их уровне или ниже (но не других отделов).
// Чем выше число — тем выше должность. Уровень 1 — линейный персонал без подчинённых
// (Бармен, Официант, Повар, Кальянный мастер, Охранник, Уборщик): видят только свои
// задачи, друг друга не видят. Управляющий/BOSS обычно заводятся с системной ролью
// admin/boss и видят вообще всё по филиалу — сюда попадают на случай, если их завели
// с ролью "Сотрудник".
const JOB_TITLE_LEVEL = {
  'Официант': 1, 'Администратор': 2,
  'Бармен': 1, 'Старший бармен': 2, 'Бар менеджер': 3, 'Шеф бармен': 4,
  'Кальянный мастер': 1, 'Старший кальянный мастер': 2, 'Шеф кальянной станции': 3,
  'Повар': 1, 'Су-шеф': 2, 'Шеф повар': 3,
  'Менеджер': 50, 'Управляющий': 100, 'BOSS': 100,
  'Охранник': 1, 'Уборщик': 1
};

// Список user_id, чьи задачи видит текущий сотрудник: свои + (если он выше линейного
// уровня) тех, кто на его уровне должности или ниже, в том же отделе. Линейный
// персонал (уровень 1) друг друга не видит — только свои задачи. Для manager/admin/boss
// не используется — они и так видят все задачи филиала.
async function getVisibleAssigneeIds() {
  const myIds = [currentUser.id];
  if(!currentProfile?.employee_id) return myIds;
  try {
    const { data: me } = await sb.from('employees').select('department,role').eq('id', currentProfile.employee_id).single();
    const myLevel = JOB_TITLE_LEVEL[me?.role] || 0;
    if(myLevel <= 1 || !me?.department) return myIds; // линейный персонал — только свои
    const { data: deptEmps } = await sb.from('employees').select('id,role').eq('department', me.department);
    const visibleEmpIds = (deptEmps||[]).filter(e => (JOB_TITLE_LEVEL[e.role]||0) <= myLevel && e.id !== currentProfile.employee_id).map(e=>e.id);
    if(visibleEmpIds.length===0) return myIds;
    const { data: subProfiles } = await sb.from('profiles').select('user_id').in('employee_id', visibleEmpIds);
    return [...myIds, ...(subProfiles||[]).map(p=>p.user_id).filter(Boolean)];
  } catch(e) { console.error('getVisibleAssigneeIds', e); return myIds; }
}

// Непрочитанные комментарии по задачам: taskId -> true, если есть чужие сообщения
// новее того, что пользователь уже видел (отметка «просмотрено» хранится локально).
let taskUnreadMap = {};
function _tcSeenKey(taskId) { return 'slon-tcseen-' + (currentUser?.id || '') + '-' + taskId; }
async function computeTaskUnread(taskIds) {
  taskUnreadMap = {};
  const ids = (taskIds || []).filter(Boolean);
  if(ids.length === 0 || !currentUser) return taskUnreadMap;
  try {
    const { data: comments } = await sb.from('task_comments').select('task_id,created_at,user_id').in('task_id', ids);
    const latestOther = {};
    (comments || []).forEach(c => {
      if(c.user_id === currentUser.id) return; // свои сообщения не считаем непрочитанными
      if(!latestOther[c.task_id] || c.created_at > latestOther[c.task_id]) latestOther[c.task_id] = c.created_at;
    });
    ids.forEach(tid => {
      const latest = latestOther[tid];
      if(!latest) { taskUnreadMap[tid] = false; return; }
      const seen = localStorage.getItem(_tcSeenKey(tid));
      taskUnreadMap[tid] = !seen || new Date(latest) > new Date(seen);
    });
  } catch(e) { /* тихо: значок непрочитанного не критичен */ }
  return taskUnreadMap;
}

// Отметить обсуждение задачи просмотренным до времени latestCreatedAt
function markTaskCommentsSeen(taskId, latestCreatedAt) {
  if(!currentUser || !taskId || !latestCreatedAt) return;
  localStorage.setItem(_tcSeenKey(taskId), latestCreatedAt);
  taskUnreadMap[taskId] = false;
  const dot = document.getElementById('taskunread-' + taskId);
  if(dot) dot.style.display = 'none';
}

function taskHTML(t) {
  const isMyTask = t.assigned_to_id === currentUser?.id;
  const isDone = t.status === 'done';

  let reportSection = '';
  if(t.report_url) {
    const isVideo = t.report_type === 'video';
    reportSection = `
      <button class="report-btn done-report" onclick="viewReport('${escJsAttr(t.report_url)}','${escJsAttr(t.report_type||'image')}')">
        ${isVideo ? '🎥' : '📸'} Смотреть отчёт
      </button>`;
  } else if(isMyTask && !isDone) {
    reportSection = `<button class="report-btn" onclick="openReportModal(${t.id})">📎 Прикрепить отчёт</button>`;
  } else if(isDone && !t.report_url && !isMyTask) {
    reportSection = `<span style="font-size:11px;color:var(--text-muted)">Без фотоотчёта</span>`;
  }

  return `<div class="task-row">
    <div class="check ${isDone?'done':''}" onclick="toggleTask(${t.id},'${escJsAttr(t.status)}',${isMyTask})"></div>
    <div class="task-body">
      <div class="task-text" style="${isDone?'text-decoration:line-through;color:var(--text-muted)':''}">${escapeHtml(t.title)}</div>
      ${t.description?`<div style="font-size:12px;color:#666;margin-top:2px">${escapeHtml(t.description)}</div>`:''}
      <div class="task-meta">👤 ${escapeHtml(t.assigned_to_name||'—')} ${t.due_date?'· до '+fmtDateShort(t.due_date):''} · 📍 ${getFilialName(t.filial||'istikbol')}${isMyTask?' <span style="background:#f0e6d2;color:#8a6a2f;border-radius:4px;padding:1px 5px;font-size:10px">Моя</span>':''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        ${reportSection}
        <button class="report-btn" onclick="event.stopPropagation();openTaskComments(${t.id},'${escJsAttr(t.title||'')}')">💬 Обсудить<span id="taskunread-${t.id}" style="display:${taskUnreadMap[t.id]?'inline-block':'none'};width:8px;height:8px;border-radius:50%;background:#A32D2D;margin-left:5px;vertical-align:middle"></span></button>
      </div>
    </div>
  </div>`;
}

let tasksSelectedDay = new Date().toISOString().slice(0,10); // по умолчанию сегодня; null = "Все дни"

function renderTasksDaySwitcher() {
  const el = document.getElementById('tasks-day-switcher');
  if(!el) return;
  const now = new Date();
  const days = [];
  // Вчера, сегодня, +5 дней вперёд
  for(let i=-1; i<=5; i++) {
    const d = new Date(now); d.setDate(now.getDate()+i);
    const ds = d.toISOString().slice(0,10);
    let label;
    if(i===0) label = 'Сегодня';
    else if(i===1) label = 'Завтра';
    else if(i===-1) label = 'Вчера';
    else label = d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
    days.push({ ds, label });
  }
  const chip = (active, onclick, label) =>
    `<button onclick="${onclick}" style="flex:0 0 auto;padding:7px 13px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;background:${active?'var(--gold-dark)':'var(--surface-2)'};color:${active?'#fff':'var(--text-primary)'}">${label}</button>`;
  let html = chip(tasksSelectedDay===null, "selectTaskDay(null)", 'Все');
  html += days.map(d=>chip(tasksSelectedDay===d.ds, `selectTaskDay('${d.ds}')`, d.label)).join('');
  el.innerHTML = html;
}

function selectTaskDay(ds) {
  tasksSelectedDay = ds;
  renderTasksDaySwitcher();
  loadTasks();
}

let tasksSelectedEmp = ''; // '' = все сотрудники

// Фильтр по сотруднику (только для руководителей; сотрудник видит лишь свои задачи)
let _tasksEmpCache = null;
async function renderTasksEmpFilter(role) {
  const wrap = document.getElementById('tasks-emp-filter-wrap');
  if(!wrap) return;
  if(role==='employee') { wrap.innerHTML=''; return; }
  // загружаем сотрудников филиала (кэш на текущий филиал)
  if(!_tasksEmpCache || _tasksEmpCache.filial !== currentFilial) {
    const { data: allEmps } = await sb.from('employees').select('id,name,department,filials,status').order('name');
    const emps = (allEmps||[]).filter(e => (e.status!=='Уволен') && (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));
    _tasksEmpCache = { filial: currentFilial, emps };
  }
  const emps = _tasksEmpCache.emps;

  // Группируем по цехам (optgroup); имена внутри — по алфавиту (emps уже отсортированы)
  const DEPT_ORDER = ['Менеджеры','Официанты','Бармены','Кальянные мастера','Повара','Техперсонал'];
  const groups = {};
  emps.forEach(e=>{ const d = e.department || 'Без отдела'; (groups[d]=groups[d]||[]).push(e); });
  const ordered = [...DEPT_ORDER.filter(d=>groups[d]), ...Object.keys(groups).filter(d=>!DEPT_ORDER.includes(d))];
  const icon = d => (typeof DEPT_ICONS !== 'undefined' ? (DEPT_ICONS[d]||'👥') : '👥');
  const optForEmp = e => `<option value="${escapeHtml(e.name)}" ${tasksSelectedEmp===e.name?'selected':''}>${escapeHtml(e.name)}</option>`;

  wrap.innerHTML = `<select onchange="selectTaskEmp(this.value)" aria-label="Фильтр по сотруднику" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:14px">
    <option value="">👥 Все сотрудники</option>
    ${ordered.map(dept=>`<optgroup label="${icon(dept)} ${escapeHtml(dept)}">${groups[dept].map(optForEmp).join('')}</optgroup>`).join('')}
  </select>`;
}

function selectTaskEmp(val) {
  tasksSelectedEmp = val;
  loadTasks();
}

async function loadTasks() {
  try {
    renderTasksDaySwitcher();
    const role = currentProfile?.role;
    await renderTasksEmpFilter(role);
    let query = sb.from('tasks').select('*').order('due_date');
    if(role==='employee') query = query.in('assigned_to_id', await getVisibleAssigneeIds());
    else query = query.eq('filial', currentFilial);
    if(tasksSelectedDay) query = query.eq('due_date', tasksSelectedDay);
    if(tasksSelectedEmp) query = query.eq('assigned_to_name', tasksSelectedEmp);
    const { data: tasks } = await query;
    const done = (tasks||[]).filter(t=>t.status==='done').length;
    const dayLabel = tasksSelectedDay ? new Date(tasksSelectedDay).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}) : 'все дни';
    document.getElementById('tasks-count').textContent = `${dayLabel}: ${done} из ${(tasks||[]).length} выполнено`;
    const list = document.getElementById('tasks-list');
    if(!tasks||tasks.length===0) { list.innerHTML='<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">На этот день задач нет</div></div>'; return; }
    await computeTaskUnread(tasks.map(t=>t.id));
    list.innerHTML = tasks.map(t=>{
      try { return taskHTML(t); }
      catch(err) { console.error('Ошибка отрисовки задачи', t?.id, t?.title, err); return ''; }
    }).join('');
  } catch(e) { console.error('loadTasks error:', e); document.getElementById('tasks-list').innerHTML='<div class="loading">Ошибка: '+(e?.message||e)+'</div>'; }
}

async function toggleTask(id, status, isMyTask) {
  if(isBoss()) return showToast('Режим наблюдателя — редактирование недоступно');
  if(currentProfile?.role === 'employee' && !isMyTask) return showToast('Можно отмечать только свои задачи — это чужая задача видна для контроля');
  const newStatus = status==='done'?'pending':'done';
  await sb.from('tasks').update({status:newStatus}).eq('id',id);
  loadTasks(); loadHome();
}

async function loadTaskEmployees() {
  const el = document.getElementById('task-filial-display');
  if(el) el.textContent = '📍 Задача для филиала: ' + getFilialName(currentFilial);
  const { data: allEmps } = await sb.from('employees').select('id,name,department,filials').order('name');
  const emps = (allEmps||[]).filter(e => (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));
  const list = document.getElementById('task-assigned-list');
  if(!emps || emps.length===0) { list.innerHTML='<div style="padding:10px;color:var(--text-muted);font-size:13px">Нет сотрудников для филиала «' + getFilialName(currentFilial) + '»</div>'; return; }

  // Группируем по подразделениям (имена внутри — по алфавиту, emps уже отсортированы)
  const DEPT_ORDER = ['Менеджеры','Официанты','Бармены','Кальянные мастера','Повара','Техперсонал'];
  const groups = {};
  emps.forEach(e=>{ const d = e.department || 'Без отдела'; (groups[d]=groups[d]||[]).push(e); });
  const ordered = [...DEPT_ORDER.filter(d=>groups[d]), ...Object.keys(groups).filter(d=>!DEPT_ORDER.includes(d))];
  const icon = d => (typeof DEPT_ICONS !== 'undefined' ? (DEPT_ICONS[d]||'👥') : '👥');
  const empRow = e => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" class="task-emp-checkbox" value="${e.id}" data-name="${escapeHtml(e.name)}" style="width:18px;height:18px">
      <span style="font-size:14px;color:var(--text-primary)">${escapeHtml(e.name)}</span>
    </label>`;
  list.innerHTML = ordered.map(dept=>`
    <div style="display:flex;align-items:center;gap:6px;margin:12px 2px 4px;font-size:12px;font-weight:700;color:var(--gold-dark);text-transform:uppercase;letter-spacing:0.4px">${icon(dept)} ${escapeHtml(dept)} · ${groups[dept].length}</div>
    ${groups[dept].map(empRow).join('')}`).join('');
}

async function addTask() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const title = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-description').value.trim();
  if(!title) return showToast('Введите задачу');

  const checked = Array.from(document.querySelectorAll('.task-emp-checkbox:checked'));
  if(checked.length===0) return showToast('Выберите хотя бы одного сотрудника');

  const dueDate = document.getElementById('task-due').value || today();
  let successCount = 0;

  try {
    for(const cb of checked) {
      const empId = cb.value;
      const empName = cb.getAttribute('data-name');
      const { data: profile } = await sb.from('profiles').select('user_id').eq('employee_id', empId).single();

      await sb.from('tasks').insert({
        title, description, assigned_to_name: empName,
        assigned_to_id: profile?.user_id||null,
        due_date: dueDate, status:'pending', created_by: currentUser.id,
        filial: currentFilial
      });

      await logActivity('add_task', title + ' → ' + empName);

      if(profile?.user_id) {
        await notifyEmployee(profile.user_id, `🐘 <b>Новая задача от управляющего</b>\n\n📋 ${title}${description?'\n📝 '+description:''}\n📅 Срок: ${dueDate}\n\nОткрой приложение: https://slon-app.vercel.app`, 'task_new');
      }
      successCount++;
    }

    closeModal('modal-add-task');
    ['task-title','task-description','task-due'].forEach(id=>document.getElementById(id).value='');
    document.querySelectorAll('.task-emp-checkbox').forEach(cb=>cb.checked=false);
    showToast(`✅ Задача назначена ${successCount} сотрудник${successCount>1?'ам':'у'}`);
    tasksSelectedDay = dueDate; // показать день, на который создали задачу
    loadTasks();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

// REPORT
function openReportModal(taskId) {
  document.getElementById('report-task-id').value = taskId;
  document.getElementById('report-preview').innerHTML = '';
  document.getElementById('report-file').value = '';
  reportFile = null;
  openModal('modal-report');
}

function previewReport(input) {
  reportFile = input.files[0];
  if(!reportFile) return;
  const preview = document.getElementById('report-preview');
  const url = URL.createObjectURL(reportFile);
  if(reportFile.type.startsWith('video')) {
    preview.innerHTML = `<video src="${url}" controls style="max-width:100%;border-radius:10px;max-height:200px"></video>`;
  } else {
    preview.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:10px;max-height:200px;object-fit:cover">`;
  }
}

async function uploadReport() {
  const taskId = document.getElementById('report-task-id').value;
  if(!reportFile) return markDoneNoReport();
  const bar = document.getElementById('uploading-bar');
  bar.style.display = 'block';
  try {
    const fileToUpload = await compressImage(reportFile);
    const ext = (fileToUpload.type.startsWith('image') ? 'jpg' : reportFile.name.split('.').pop());
    const path = `task-${taskId}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('task-reports').upload(path, fileToUpload);
    if(upErr) { showToast('Ошибка загрузки: '+upErr.message); bar.style.display='none'; return; }
    const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
    const isVideo = reportFile.type.startsWith('video');
    await sb.from('tasks').update({ status:'done', report_url: urlData.publicUrl, report_type: isVideo?'video':'image' }).eq('id', taskId);
    // Get task info and notify admin
    const { data: task } = await sb.from('tasks').select('title,assigned_to_name').eq('id', taskId).single();
    await logActivity('task_done', task?.title + ' (с фото)');
    await notifyAdmin(`✅ <b>Задача выполнена!</b>\n\n📋 ${task?.title||''}\n👤 Сотрудник: ${task?.assigned_to_name||''}\n${isVideo?'🎥 Прикреплено видео':'📸 Прикреплено фото'}\n\nОткрой приложение: https://slon-app.vercel.app`);
    bar.style.display = 'none';
    closeModal('modal-report');
    showToast('✅ Отчёт отправлен!');
    loadTasks(); loadHome();
  } catch(e) { bar.style.display='none'; showToast('Ошибка: '+e.message); }
}

async function markDoneNoReport() {
  const taskId = document.getElementById('report-task-id').value;
  await sb.from('tasks').update({status:'done'}).eq('id',taskId);
  const { data: task } = await sb.from('tasks').select('title,assigned_to_name').eq('id', taskId).single();
  await notifyAdmin(`✅ <b>Задача выполнена!</b>\n\n📋 ${task?.title||''}\n👤 Сотрудник: ${task?.assigned_to_name||''}\n📝 Без фотоотчёта\n\nОткрой приложение: https://slon-app.vercel.app`);
  closeModal('modal-report');
  showToast('✅ Задача выполнена');
  loadTasks(); loadHome();
}

function viewReport(url, type) {
  const content = document.getElementById('view-report-content');
  if(type==='video') {
    content.innerHTML = `<video src="${url}" controls style="width:100%;border-radius:12px"></video>`;
  } else {
    content.innerHTML = `<img src="${url}" style="width:100%;border-radius:12px">`;
  }
  openModal('modal-view-report');
}

// TASK COMMENTS
let currentCommentsTaskId = null;
function chatBubbleHTML(c, isMine, showPinBtn) {
  const time = new Date(c.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  let mediaHTML = '';
  if(c.media_url) {
    if(c.media_type === 'video') {
      mediaHTML = `<video src="${escapeHtml(c.media_url)}" controls style="max-width:100%;border-radius:10px;margin-bottom:${c.text?'6px':'0'};display:block"></video>`;
    } else {
      mediaHTML = `<img src="${escapeHtml(c.media_url)}" style="max-width:100%;border-radius:10px;margin-bottom:${c.text?'6px':'0'};display:block;cursor:pointer" onclick="viewReport('${escJsAttr(c.media_url)}','image')">`;
    }
  }
  const pinBtn = showPinBtn ? `<button onclick="event.stopPropagation();toggleChatPin(${c.id},${c.is_pinned})" style="background:none;border:none;cursor:pointer;font-size:11px;opacity:0.6;margin-left:6px">${c.is_pinned?'📌':'📍'}</button>` : '';
  return `<div style="align-self:${isMine?'flex-end':'flex-start'};max-width:80%">
    ${c.is_pinned?'<div style="font-size:10px;color:var(--gold-dark);font-weight:600;margin-bottom:2px">📌 Закреплено</div>':''}
    <div style="background:${isMine?'var(--gold-dark)':'var(--surface-2)'};color:${isMine?'#fff':'var(--text-primary)'};border-radius:14px;padding:${c.media_url?'8px':'10px 14px'};font-size:14px;${isMine?'border-bottom-right-radius:4px':'border-bottom-left-radius:4px'}">
      ${!isMine?`<div style="font-size:11px;font-weight:600;opacity:0.7;margin-bottom:3px">${escapeHtml(c.user_name||'')}</div>`:''}
      ${mediaHTML}
      ${escapeHtml(c.text||'')}
    </div>
    <div style="font-size:10px;color:var(--text-muted);margin-top:2px;text-align:${isMine?'right':'left'}">${time}${pinBtn}</div>
  </div>`;
}

async function openTaskComments(taskId, taskTitle) {
  currentCommentsTaskId = taskId;
  document.getElementById('task-comments-title').textContent = '💬 ' + taskTitle;
  await loadTaskComments();
  openModal('modal-task-comments');
  startCommentsPolling();
}

let commentsPollInterval = null;
function startCommentsPolling() {
  stopCommentsPolling();
  commentsPollInterval = setInterval(() => {
    if(document.getElementById('modal-task-comments').classList.contains('open')) {
      loadTaskComments(true);
    } else {
      stopCommentsPolling();
    }
  }, 3000);
}
function stopCommentsPolling() {
  if(commentsPollInterval) { clearInterval(commentsPollInterval); commentsPollInterval = null; }
}

let lastCommentsCount = 0;
async function loadTaskComments(isPoll) {
  const list = document.getElementById('task-comments-list');
  if(!isPoll) list.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const { data: comments } = await sb.from('task_comments').select('*').eq('task_id', currentCommentsTaskId).order('created_at');
    if(!comments || comments.length===0) {
      if(!isPoll || lastCommentsCount!==0) list.innerHTML = '<div class="empty"><div class="empty-icon">💬</div><div class="empty-text">Пока нет сообщений.<br>Начни обсуждение первым!</div></div>';
      lastCommentsCount = 0;
      return;
    }
    // Отмечаем обсуждение просмотренным (по времени последнего сообщения) — гасит значок
    markTaskCommentsSeen(currentCommentsTaskId, comments[comments.length-1].created_at);
    if(isPoll && comments.length === lastCommentsCount) return; // no change, skip re-render
    lastCommentsCount = comments.length;
    const wasAtBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    list.innerHTML = comments.map(c => chatBubbleHTML(c, c.user_id === currentUser?.id)).join('');
    if(!isPoll || wasAtBottom) list.scrollTop = list.scrollHeight;
  } catch(e) { console.error(e); if(!isPoll) list.innerHTML = '<div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div>'; }
}

async function sendTaskComment() {
  const input = document.getElementById('task-comment-input');
  const text = input.value.trim();
  if(!text || !currentCommentsTaskId) return;
  try {
    await sb.from('task_comments').insert({
      task_id: currentCommentsTaskId, user_id: currentUser.id,
      user_name: currentProfile?.name || currentUser?.email, text
    });
    input.value = '';
    await loadTaskComments();

    // Уведомляем всех участников задачи и обсуждения: назначенный + создатель +
    // все, кто уже писал в этом обсуждении (кроме самого автора сообщения).
    const [{ data: task }, { data: commenters }] = await Promise.all([
      sb.from('tasks').select('assigned_to_id,created_by,title').eq('id', currentCommentsTaskId).single(),
      sb.from('task_comments').select('user_id').eq('task_id', currentCommentsTaskId)
    ]);
    if(task) {
      const notifyIds = new Set();
      if(task.assigned_to_id) notifyIds.add(task.assigned_to_id);
      if(task.created_by) notifyIds.add(task.created_by);
      (commenters||[]).forEach(c => { if(c.user_id) notifyIds.add(c.user_id); });
      notifyIds.delete(currentUser.id); // не уведомляем самого себя
      for(const uid of notifyIds) {
        await notifyEmployee(uid, `💬 <b>Новый комментарий к задаче</b>\n\n📋 ${task.title}\n👤 ${currentProfile?.name||''}: ${text}\n\nОткрой приложение: https://slon-app.vercel.app`, 'task_comment');
      }
      if(notifyIds.size===0 && currentProfile?.role !== 'admin') {
        await notifyAdmin(`💬 <b>Новый комментарий к задаче</b>\n\n📋 ${task.title}\n👤 ${currentProfile?.name||''}: ${text}`);
      }
    }
  } catch(e) { showToast('Ошибка: '+e.message); }
}

