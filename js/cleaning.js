// ============ ГЕНЕРАЛЬНАЯ УБОРКА ============
// По субботам в Чехове и по воскресеньям в Истикболе заведение убирают целиком.
// Менеджер запускает уборку, отмечая, кто сегодня участвует; работы раздаются
// по цехам (бар — барменам, кухня — поварам, зал — официантам), каждый видит
// свои пункты и закрывает их сам.
//
// Сделано по образцу инвентаризации посуды: одна открытая уборка на филиал,
// запускает руководство, дальше работают все.

// День уборки: Чехов — суббота, Истикбол — воскресенье. Кнопку показываем не
// только в этот день (уборку могут перенести), но в свой день подсвечиваем.
const CLEANING_DAYS = { chekhov: 6, istikbol: 0 };   // как getDay(): 0 = вс, 6 = сб
function cleaningIsTodayDay() {
  return new Date(businessToday()).getDay() === CLEANING_DAYS[currentFilial];
}
function cleaningCanManage() { return canEditData(); }

let cleaningRow = null;      // текущая открытая уборка
let cleaningItems = [];
let cleaningPeople = [];     // кто в смене сегодня — для запуска и переназначения
let cleaningPhotoItemId = null;
let cleaningAssignItemId = null;
let cleaningMediaFiles = [];

async function loadCleaning() {
  const content = document.getElementById('cleaning-content');
  if(!content) return;
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  const sub = document.getElementById('cleaning-subtitle');
  if(sub) sub.textContent = getFilialName(currentFilial);
  try {
    const { data: open } = await sb.from('cleanings').select('*')
      .eq('filial', currentFilial).eq('status', 'open').maybeSingle();
    cleaningRow = open || null;

    if(!cleaningRow) { cleaningItems = []; return renderCleaningIdle(); }
    const { data: items } = await sb.from('cleaning_items').select('*')
      .eq('cleaning_id', cleaningRow.id).order('sort');
    cleaningItems = items || [];
    renderCleaningActive();
  } catch(e) {
    content.innerHTML = `<div class="empty"><div class="empty-text">${t('common.error')}${escapeHtml(e.message)}</div></div>`;
  }
}

// ===== Уборка не запущена =====
function renderCleaningIdle() {
  const content = document.getElementById('cleaning-content');
  const isDay = cleaningIsTodayDay();
  content.innerHTML = `<div class="card">
    <div class="card-title">🧹 ${t('cln.title')}</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
      ${isDay ? t('cln.todayIsDay', { f: escapeHtml(getFilialName(currentFilial)) }) : t('cln.notStarted')}
    </div>
    ${cleaningCanManage() ? `
      <button class="btn ${isDay ? 'btn-primary' : 'btn-secondary'}" onclick="openCleaningStart()">${t('cln.startBtn')}</button>
      <button class="btn btn-secondary" style="margin-top:8px" onclick="openCleaningTasks()">${t('cln.tasksBtn')}</button>` : ''}
  </div><div id="cleaning-history"></div>`;
  renderCleaningHistory();
}

async function renderCleaningHistory() {
  const el = document.getElementById('cleaning-history');
  if(!el) return;
  try {
    const { data: past } = await sb.from('cleanings').select('*')
      .eq('filial', currentFilial).neq('status', 'open')
      .order('started_at', { ascending: false }).limit(8);
    if(!past || !past.length) return;
    const { data: items } = await sb.from('cleaning_items')
      .select('cleaning_id,done').in('cleaning_id', past.map(c => c.id));
    const stat = {};
    (items || []).forEach(i => {
      const s = stat[i.cleaning_id] = stat[i.cleaning_id] || { done: 0, total: 0 };
      s.total++; if(i.done) s.done++;
    });
    el.innerHTML = `<div class="section-label">${t('cln.history')}</div><div class="card">` +
      past.map(c => {
        const s = stat[c.id] || { done: 0, total: 0 };
        const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
        const tone = c.status === 'cancelled' ? 'var(--text-muted)' : (pct === 100 ? '#3B6D11' : 'var(--gold-dark)');
        return `<div class="list-item" onclick="openCleaningPast(${c.id})" style="cursor:pointer">
          <div class="item-info">
            <div class="item-name">${fmtLocale(new Date(c.date), { weekday:'short', day:'numeric', month:'long' })}</div>
            <div class="item-sub">${c.status === 'cancelled' ? t('cln.cancelled') : t('cln.doneOf', { done:s.done, total:s.total })}</div>
          </div>
          <span style="font-size:15px;font-weight:700;color:${tone}">${c.status === 'cancelled' ? '—' : pct + '%'}</span>
        </div>`;
      }).join('') + `</div>`;
  } catch(e) { console.error('cleaning history', e); }
}

async function openCleaningPast(id) {
  const content = document.getElementById('view-report-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  openModal('modal-view-report');
  const { data: items } = await sb.from('cleaning_items').select('*').eq('cleaning_id', id).order('sort');
  content.innerHTML = (items || []).map(i => `
    <div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span>${i.done ? '✅' : '⬜'}</span>
      <div style="flex:1">
        <div style="font-size:13px;color:var(--text-primary)">${escapeHtml(i.task_text)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(i.employee_name || t('cln.nobody'))}</div>
      </div>
    </div>`).join('') || `<div class="empty"><div class="empty-text">${t('cln.noTasks')}</div></div>`;
}

// ===== Идёт уборка =====
function renderCleaningActive() {
  const content = document.getElementById('cleaning-content');
  const total = cleaningItems.length;
  const done = cleaningItems.filter(i => i.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const myEmp = currentProfile?.employee_id || null;

  // Группируем по людям: человеку важно видеть свой кусок целиком, а не искать
  // свои строки в общем списке. Нераспределённые — первыми, они требуют решения.
  const groups = {};
  cleaningItems.forEach(i => {
    const key = i.employee_id || 0;
    (groups[key] = groups[key] || { name: i.employee_name || t('cln.nobody'), id: i.employee_id, items: [] }).items.push(i);
  });
  const order = Object.keys(groups).sort((a, b) => {
    if(a === '0') return -1;
    if(b === '0') return 1;
    if(String(a) === String(myEmp)) return -1;
    if(String(b) === String(myEmp)) return 1;
    return groups[a].name.localeCompare(groups[b].name);
  });

  content.innerHTML = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:13px;color:var(--text-muted)">${t('cln.doneOf', { done, total })}</span>
      <span style="font-size:18px;font-weight:700;color:${pct === 100 ? '#3B6D11' : 'var(--gold-dark)'}">${pct}%</span>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:8px">${t('cln.startedBy', { who: escapeHtml(cleaningRow.started_by_name || '—') })}</div>
    ${cleaningCanManage() ? `<div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary" style="flex:1" onclick="finishCleaning()">${t('cln.finishBtn')}</button>
      <button class="btn btn-secondary" style="flex:1" onclick="cancelCleaning()">${t('cln.cancelBtn')}</button>
    </div>` : ''}
  </div>` + order.map(key => {
    const g = groups[key];
    const mine = String(g.id || 0) === String(myEmp);
    return `<div class="section-label">${mine ? '👤 ' + t('cln.mine') : escapeHtml(g.name)}</div>
      <div class="card" style="padding:6px 14px">${g.items.map(i => cleaningItemRow(i, mine)).join('')}</div>`;
  }).join('');
}

function cleaningItemRow(i, mine) {
  // Отметить может тот, кому досталось, и руководство — то же правило в политике
  const canTick = mine || cleaningCanManage();
  const media = Array.isArray(i.media) ? i.media : [];
  return `<div class="task-row" ${canTick ? `onclick="toggleCleaningItem(${i.id})"` : ''} style="${canTick ? '' : 'opacity:.7'}">
    <div class="check ${i.done ? 'done' : ''}"></div>
    <div class="task-body">
      <div class="task-text" style="${i.done ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${escapeHtml(i.task_text)}</div>
      ${i.done && i.done_by_name ? `<div style="font-size:11px;color:var(--text-muted)">✓ ${escapeHtml(i.done_by_name)}</div>` : ''}
      ${media.length ? `<button class="report-btn done-report" onclick="event.stopPropagation();viewCleaningMedia(${i.id})">📸 ${t('cl.watch', { n: media.length })}</button>` : ''}
      ${canTick ? `<button class="report-btn" onclick="event.stopPropagation();openCleaningPhoto(${i.id})">📎 ${media.length ? t('cl.morePhoto') : t('cl.attachPhoto')}</button>` : ''}
      ${cleaningCanManage() ? `<button class="report-btn" onclick="event.stopPropagation();openCleaningAssign(${i.id})">👤 ${t('cln.assign')}</button>` : ''}
    </div>
  </div>`;
}

async function toggleCleaningItem(id) {
  const item = cleaningItems.find(x => x.id === id);
  if(!item) return;
  const next = !item.done;
  item.done = next;                       // рисуем сразу, не дожидаясь базы
  renderCleaningActive();
  const { error } = await sb.from('cleaning_items').update({ done: next }).eq('id', id);
  if(error) { item.done = !next; renderCleaningActive(); return showToast(t('common.error') + error.message); }
  loadCleaning();
}

// ===== Запуск =====
// Участники берутся из графика на сегодня: человек не в смене убирать не может.
async function openCleaningStart() {
  if(!cleaningCanManage()) return showToast(t('common.observerMode'));
  openModal('modal-cleaning-start');
  const body = document.getElementById('cleaning-start-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const day = businessToday();
    const [{ data: sched }, { data: emps }, { data: tasks }] = await Promise.all([
      sb.from('schedules').select('employee_id').eq('filial', currentFilial).eq('date', day).eq('is_day_off', false),
      sb.from('employees').select('id,name,department').neq('status', 'Уволен').order('name'),
      sb.from('cleaning_tasks').select('id,department').eq('filial', currentFilial).eq('is_active', true),
    ]);
    const onShift = new Set((sched || []).map(s => s.employee_id));
    cleaningPeople = (emps || []).filter(e => onShift.has(e.id) && e.department);

    if(!tasks || !tasks.length) {
      body.innerHTML = `<div class="empty"><div class="empty-text">${t('cln.noTasksYet')}</div></div>
        <button class="btn btn-primary" style="margin-top:12px" onclick="closeModal('modal-cleaning-start');openCleaningTasks()">${t('cln.tasksBtn')}</button>`;
      return;
    }
    if(!cleaningPeople.length) {
      body.innerHTML = `<div class="empty"><div class="empty-text">${t('cln.nobodyOnShift')}</div></div>`;
      return;
    }

    // Цеха, у которых есть работы, но некому их делать — предупреждаем заранее,
    // чтобы менеджер не обнаружил «НЕКОМУ» уже после запуска.
    const needDepts = [...new Set((tasks || []).map(x => x.department).filter(Boolean))];
    const haveDepts = new Set(cleaningPeople.map(e => e.department));
    const missing = needDepts.filter(d => !haveDepts.has(d));

    body.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${t('cln.pickPeople')}</div>` +
      cleaningPeople.map(e => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <input type="checkbox" class="cleaning-person" value="${e.id}" checked style="width:18px;height:18px;flex:0 0 auto">
          <span style="flex:1">
            <span style="font-size:14px;color:var(--text-primary)">${escapeHtml(e.name)}</span>
            <span style="font-size:11px;color:var(--text-muted);display:block">${escapeHtml(e.department)}</span>
          </span>
        </label>`).join('') +
      (missing.length ? `<div class="note" style="margin-top:12px;font-size:12px">${t('cln.missingDepts', { d: escapeHtml(missing.join(', ')) })}</div>` : '') +
      `<button class="btn btn-primary" style="margin-top:14px" onclick="startCleaning()">${t('cln.startNow')}</button>`;
  } catch(e) { body.innerHTML = `<div class="empty"><div class="empty-text">${t('common.error')}${escapeHtml(e.message)}</div></div>`; }
}

async function startCleaning() {
  const ids = Array.from(document.querySelectorAll('.cleaning-person:checked')).map(c => Number(c.value));
  if(!ids.length) return showToast(t('cln.pickAtLeastOne'));
  try {
    const { error } = await sb.rpc('cleaning_start', { p_filial: currentFilial, p_employee_ids: ids });
    if(error) return showToast(t('common.error') + error.message);
    closeModal('modal-cleaning-start');
    showToast(t('cln.started'));
    notifyCleaningPeople(ids);
    loadCleaning();
  } catch(e) { showToast(t('common.error') + e.message); }
}

// Участникам — «началась уборка, посмотри свои работы»
async function notifyCleaningPeople(ids) {
  try {
    const { data: profs } = await sb.from('profiles').select('user_id,telegram_id,notify_prefs').in('employee_id', ids);
    const msg = `🧹 <b>${tgEscape(t('cln.tgStarted'))}</b>\n\n📍 ${tgEscape(getFilialName(currentFilial))}\n👤 ${tgEscape(currentProfile?.name || '')}\n\n${tgEscape(t('cln.tgBody'))}`;
    for(const p of (profs || [])) {
      if(p.user_id !== currentUser?.id && p.telegram_id && _wantsNotif(p.notify_prefs, 'cleaning')) {
        await sendTelegram(p.telegram_id, msg);
      }
    }
  } catch(e) { console.error('notify cleaning', e); }
}

async function finishCleaning() {
  if(!cleaningCanManage() || !cleaningRow) return;
  const left = cleaningItems.filter(i => !i.done).length;
  const ok = await confirmDialog(left ? t('cln.finishWithLeft', { n: left }) : t('cln.finishConfirm'),
    { title: t('cln.finishBtn'), okText: t('cln.finishOk'), danger: left > 0 });
  if(!ok) return;
  const { error } = await sb.from('cleanings').update({
    status: 'done', closed_at: new Date().toISOString(),
    closed_by: currentUser.id, closed_by_name: currentProfile?.name || currentUser?.email,
  }).eq('id', cleaningRow.id);
  if(error) return showToast(t('common.error') + error.message);
  showToast(t('cln.finished'));
  loadCleaning();
}

async function cancelCleaning() {
  if(!cleaningCanManage() || !cleaningRow) return;
  if(!await confirmDialog(t('cln.cancelConfirm'), { title: t('cln.cancelBtn'), okText: t('cln.cancelOk') })) return;
  const { error } = await sb.from('cleanings').update({
    status: 'cancelled', closed_at: new Date().toISOString(),
    closed_by: currentUser.id, closed_by_name: currentProfile?.name || currentUser?.email,
  }).eq('id', cleaningRow.id);
  if(error) return showToast(t('common.error') + error.message);
  showToast(t('cln.cancelled'));
  loadCleaning();
}

// ===== Переназначение =====
// Нужно для пунктов, доставшихся «некому», и когда человек ушёл раньше.
async function openCleaningAssign(itemId) {
  if(!cleaningCanManage()) return;
  cleaningAssignItemId = itemId;
  const item = cleaningItems.find(x => x.id === itemId);
  openModal('modal-cleaning-assign');
  const body = document.getElementById('cleaning-assign-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;

  // Кандидаты — все участники этой уборки, а не только цех пункта: если цеха
  // нет в смене, работу всё равно надо кому-то отдать.
  const people = {};
  cleaningItems.forEach(i => { if(i.employee_id) people[i.employee_id] = i.employee_name; });
  body.innerHTML = `<div style="font-size:13px;color:var(--text-primary);margin-bottom:10px">${escapeHtml(item?.task_text || '')}</div>` +
    Object.entries(people).map(([id, name]) => `
      <button onclick="assignCleaningItem(${id})" style="width:100%;text-align:left;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:11px 14px;font-size:14px;margin-bottom:6px;cursor:pointer">
        ${escapeHtml(name)}${String(item?.employee_id) === String(id) ? ' ✓' : ''}
      </button>`).join('') +
    `<button onclick="assignCleaningItem(null)" style="width:100%;text-align:left;background:none;border:none;color:var(--gold-dark);font-size:13px;padding:8px 4px;cursor:pointer">${t('cln.unassign')}</button>`;
}

async function assignCleaningItem(employeeId) {
  const item = cleaningItems.find(x => x.id === cleaningAssignItemId);
  if(!item) return;
  const name = employeeId ? (cleaningItems.find(x => String(x.employee_id) === String(employeeId))?.employee_name || null) : null;
  const { error } = await sb.from('cleaning_items')
    .update({ employee_id: employeeId, employee_name: name }).eq('id', item.id);
  if(error) return showToast(t('common.error') + error.message);
  closeModal('modal-cleaning-assign');
  loadCleaning();
}

// ===== Фото к пункту (по желанию) =====
function openCleaningPhoto(itemId) {
  cleaningPhotoItemId = itemId;
  cleaningMediaFiles = [];
  document.getElementById('cleaning-media-preview').innerHTML = '';
  document.getElementById('cleaning-media-file').value = '';
  document.getElementById('cleaning-media-camera').value = '';
  openModal('modal-cleaning-media');
}

function previewCleaningMedia(input) {
  cleaningMediaFiles = cleaningMediaFiles.concat(Array.from(input.files || []));
  input.value = '';
  const preview = document.getElementById('cleaning-media-preview');
  if(!cleaningMediaFiles.length) { preview.innerHTML = ''; return; }
  preview.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px">` + cleaningMediaFiles.map(f =>
    `<img src="${URL.createObjectURL(f)}" style="width:90px;height:90px;border-radius:10px;object-fit:cover">`).join('') +
    `</div><div style="font-size:12px;color:var(--text-muted);margin-top:8px">${t('cl.photoChosen', { n: cleaningMediaFiles.length })}</div>`;
}

async function uploadCleaningMedia() {
  if(!cleaningMediaFiles.length) return showToast(t('cl.selectFile'));
  const bar = document.getElementById('cleaning-media-bar');
  bar.style.display = 'block';
  try {
    // Сжимаем по очереди, отправляем разом — как в чек-листах: узкое место сеть
    const prepared = [];
    for(let i = 0; i < cleaningMediaFiles.length; i++) {
      bar.textContent = t('cl.preparing', { i: i + 1, n: cleaningMediaFiles.length });
      const f = await compressImage(cleaningMediaFiles[i], 1024, 0.62);
      prepared.push({ file: f, path: `cleaning-${cleaningPhotoItemId}-${Date.now()}-${i}.jpg` });
    }
    bar.textContent = t('cl.uploadingN', { n: prepared.length });
    const results = await Promise.all(prepared.map(async p => {
      const { error } = await sb.storage.from('task-reports')
        .upload(p.path, p.file, { contentType: 'image/jpeg', cacheControl: '31536000' });
      return { path: p.path, error };
    }));
    const bad = results.find(r => r.error);
    if(bad) { bar.style.display = 'none'; return showToast(t('common.uploadErr') + bad.error.message); }

    const item = cleaningItems.find(x => x.id === cleaningPhotoItemId);
    const media = (Array.isArray(item?.media) ? item.media : []).concat(
      results.map(r => ({ url: sb.storage.from('task-reports').getPublicUrl(r.path).data.publicUrl, type: 'image' })));
    const { error } = await sb.from('cleaning_items').update({ media }).eq('id', cleaningPhotoItemId);
    bar.style.display = 'none';
    if(error) return showToast(t('common.error') + error.message);
    closeModal('modal-cleaning-media');
    showToast(t('cl.photoAttached'));
    loadCleaning();
  } catch(e) { bar.style.display = 'none'; showToast(t('common.error') + e.message); }
}

function viewCleaningMedia(itemId) {
  const item = cleaningItems.find(x => x.id === itemId);
  const media = Array.isArray(item?.media) ? item.media : [];
  document.getElementById('view-report-content').innerHTML =
    `<div style="display:flex;flex-direction:column;gap:12px">` + media.map(m =>
      `<img src="${escapeHtml(m.url)}" loading="lazy" decoding="async" style="width:100%;border-radius:12px" onclick="viewReport('${escJsAttr(m.url)}','image')">`).join('') + `</div>`;
  openModal('modal-view-report');
}

// ===== Список работ (свой у каждого филиала) =====
async function openCleaningTasks() {
  if(!cleaningCanManage()) return showToast(t('common.observerMode'));
  openModal('modal-cleaning-tasks');
  renderCleaningTasks();
}

async function renderCleaningTasks() {
  const body = document.getElementById('cleaning-tasks-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  const { data } = await sb.from('cleaning_tasks').select('*')
    .eq('filial', currentFilial).eq('is_active', true).order('sort');
  const tasks = data || [];
  document.getElementById('cleaning-tasks-filial').textContent = '📍 ' + getFilialName(currentFilial);
  body.innerHTML = (tasks.length
    ? tasks.map(x => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <div style="font-size:14px;color:var(--text-primary)">${escapeHtml(x.text)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(x.department || t('cln.anyDept'))}</div>
        </div>
        <button onclick="deleteCleaningTask(${x.id})" style="background:none;border:none;color:#A13C3C;font-size:16px;cursor:pointer;padding:4px 8px">✕</button>
      </div>`).join('')
    : `<div class="empty"><div class="empty-text">${t('cln.noTasksYet')}</div></div>`)
    + `<div style="display:flex;gap:8px;margin-top:14px">
        <input class="form-input" id="cleaning-task-text" placeholder="${t('cln.taskPh')}" style="flex:2">
        <select class="form-select" id="cleaning-task-dept" style="flex:1">
          <option value="">${t('cln.anyDept')}</option>
          ${DEPARTMENTS.map(d => `<option>${d}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" style="margin-top:10px" onclick="addCleaningTask()">${t('cln.addTask')}</button>`;
}

async function addCleaningTask() {
  const text = document.getElementById('cleaning-task-text').value.trim();
  if(!text) return showToast(t('cln.enterTask'));
  const dept = document.getElementById('cleaning-task-dept').value || null;
  const { error } = await sb.from('cleaning_tasks').insert({
    filial: currentFilial, text, department: dept,
    sort: Math.floor(Date.now() / 1000) % 100000,
  });
  if(error) return showToast(t('common.error') + error.message);
  renderCleaningTasks();
}

async function deleteCleaningTask(id) {
  if(!await confirmDialog(t('cln.deleteTaskConfirm'), { title: t('cln.tasksBtn'), okText: t('common.delete') })) return;
  // Не удаляем строку, а гасим: в прошлых уборках на неё ссылаются отчёты
  const { error } = await sb.from('cleaning_tasks').update({ is_active: false }).eq('id', id);
  if(error) return showToast(t('common.error') + error.message);
  renderCleaningTasks();
}
