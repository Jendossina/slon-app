// CHECKLISTS
let currentChecklistType = null;
let currentChecklistLog = null;
let currentChecklistDept = null;
let currentChecklistTemplate = null; // текущий шаблон — чтобы не запрашивать его на каждую галочку
let clSaveTimer = null;              // таймер отложенного сохранения (даёт отметить пачку галочек)
let clSaving = false;               // идёт ли сейчас запись (чтобы не было гонки/дублей)
let clNotified = false;             // отправляли ли уже уведомление о выполнении
let clBaseline = [];                // items_done на момент загрузки — для безопасного слияния с чужими правками

const CHECKLIST_DEPTS = ['Официанты','Бармены','Кальянные мастера','Повара'];
const CHECKLIST_DEPT_ICONS = {'Официанты':'🍽️','Бармены':'🍹','Кальянные мастера':'💨','Повара':'👨‍🍳'};

// Инициализация экрана чек-листов: определяем отдел и строим вкладки
async function initChecklistScreen() {
  document.getElementById('checklist-date').textContent = fmtLocale(new Date(businessToday()), {weekday:'long', day:'numeric', month:'long'});
  const canSeeAll = canEditData() || isBoss();

  // Отдел по умолчанию — свой у сотрудника
  let myDept = null;
  if(currentProfile?.employee_id) {
    const { data: emp } = await sb.from('employees').select('department').eq('id', currentProfile.employee_id).single();
    myDept = emp?.department || null;
  }
  if(!currentChecklistDept) currentChecklistDept = myDept || 'Официанты';

  // Переключатель отделов — только для руководства
  const deptSwitcher = document.getElementById('checklist-dept-switcher');
  if(canSeeAll) {
    deptSwitcher.style.display = 'flex';
    deptSwitcher.innerHTML = CHECKLIST_DEPTS.map(d=>`<button onclick="switchChecklistDept('${d}')" class="chip${d===currentChecklistDept?' on':''}">${CHECKLIST_DEPT_ICONS[d]||''} ${d}</button>`).join('');
  } else {
    deptSwitcher.style.display = 'none';
    currentChecklistDept = myDept || 'Официанты';
  }

  await buildChecklistTabs();
}

function switchChecklistDept(dept) {
  currentChecklistDept = dept;
  currentChecklistType = null; // сбросим тип, выберется первый доступный
  initChecklistScreen();
}

// Строим вкладки типов чек-листов для выбранного отдела
async function buildChecklistTabs() {
  const tabsEl = document.getElementById('checklist-tabs');
  const content = document.getElementById('checklist-content');
  try {
    const { data: templates } = await sb.from('checklist_templates').select('id,name,type,department').eq('department', currentChecklistDept).eq('is_active', true).order('id');
    if(!templates || templates.length===0) {
      tabsEl.innerHTML = '';
      content.innerHTML = `<div class="empty"><div class="empty-icon">☑️</div><div class="empty-text">${t('cl.noneForDept',{dept:currentChecklistDept})}</div></div>`;
      return;
    }
    // Если текущий тип не входит в список — берём первый
    if(!currentChecklistType || !templates.find(t=>t.type===currentChecklistType)) {
      currentChecklistType = templates[0].type;
    }
    tabsEl.innerHTML = templates.map(t=>`<button onclick="switchChecklistTab('${escJsAttr(t.type)}')" class="chip${t.type===currentChecklistType?' on':''}">${escapeHtml(t.name)}</button>`).join('');
    await loadChecklist(currentChecklistType);
  } catch(e) {
    content.innerHTML = `<div class="empty"><div class="empty-text">${t('cl.loadErr')}</div></div>`;
  }
}

async function switchChecklistTab(type, btn) {
  currentChecklistType = type;
  await buildChecklistTabs();
}

async function loadChecklist(type) {
  await flushChecklistSave(); // досохраняем отметки предыдущего чек-листа перед перерисовкой
  const content = document.getElementById('checklist-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  document.getElementById('checklist-date').textContent = fmtLocale(new Date(businessToday()), {weekday:'long', day:'numeric', month:'long'});

  try {
    // Get template
    const { data: templates } = await sb.from('checklist_templates').select('*').eq('type', type).eq('department', currentChecklistDept).eq('is_active', true);
    if(!templates || templates.length===0) { content.innerHTML=`<div class="empty"><div class="empty-icon">☑️</div><div class="empty-text">${t('cl.notFound')}</div></div>`; return; }
    const template = templates[0];
    const items = template.items;
    currentChecklistTemplate = template; // запоминаем, чтобы toggle не лез в базу за total

    // Общий чек-лист на отдел/смену: берём лог по (шаблон + дата + филиал), без привязки к пользователю.
    // Если из-за старых персональных записей строк несколько — берём самую заполненную.
    // Кассовый день, а НЕ календарный: смена идёт до ~03:00, и чек-лист закрытия,
    // заполненный после полуночи, относится к дню НАЧАЛА смены. Так же считает
    // проверка просрочки в базе (business_today) — даты обязаны совпадать.
    const todayStr = businessToday();
    const { data: logs } = await sb.from('checklist_logs')
      .select('*')
      .eq('template_id', template.id)
      .eq('date', todayStr)
      .eq('filial', currentFilial)
      .order('id');

    currentChecklistLog = (logs && logs.length)
      ? logs.reduce((a,b)=> ((b.items_done?.length||0) > (a.items_done?.length||0) ? b : a), logs[0])
      : null;
    clBaseline = (currentChecklistLog?.items_done || []).slice();
    clNotified = !!currentChecklistLog?.completed; // не слать повторное уведомление, если уже выполнен
    const donItems = currentChecklistLog?.items_done || [];
    const itemsBy = currentChecklistLog?.items_by || {};
    const itemsMedia = currentChecklistLog?.items_media || {};

    // Group by section
    const sections = {};
    items.forEach(item => {
      if(!sections[item.section]) sections[item.section] = [];
      sections[item.section].push(item);
    });

    const doneCount = donItems.length;
    const totalCount = items.length;
    const pct = totalCount ? Math.round(doneCount/totalCount*100) : 0;

    let html = '';
    
    // Progress
    html += `<div class="card">
      <div class="card-title">${escapeHtml(template.name)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;color:var(--text-muted)" id="cl-progress-count">${t('cl.doneOf',{done:doneCount,total:totalCount})}</span>
        <span style="font-size:18px;font-weight:700;color:${pct===100?'#3B6D11':'var(--gold-dark)'}" id="cl-progress-pct">${pct}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="cl-progress-fill" style="width:${pct}%"></div></div>
      <div id="cl-progress-banner" style="text-align:center;margin-top:10px;font-size:13px;color:#3B6D11;font-weight:500;display:${pct===100?'block':'none'}">${t('cl.completed')}</div>
    </div>`;

    // Sections
    Object.entries(sections).forEach(([section, sItems]) => {
      html += `<div class="section-label">${section}</div><div class="card" style="padding:10px 14px">`;
      sItems.forEach(item => {
        const isDone = donItems.includes(item.id);
        const mediaArr = clMediaList(itemsMedia[item.id]);
        let mediaSection = '';
        if(mediaArr.length) {
          mediaSection = `<button class="report-btn done-report" onclick="event.stopPropagation();viewChecklistItemMedia(${item.id})">📸 ${t('cl.watch',{n:mediaArr.length})}</button>`
            + `<button class="report-btn" onclick="event.stopPropagation();openChecklistMediaModal(${item.id},${template.id})">➕ ${t('cl.morePhoto')}</button>`;
        } else {
          mediaSection = `<button class="report-btn" onclick="event.stopPropagation();openChecklistMediaModal(${item.id},${template.id})">📎 ${t('cl.attachPhoto')}</button>`;
        }
        const byName = itemsBy[item.id];
        html += `<div class="task-row" id="cl-row-${item.id}" onclick="toggleChecklistItem(${item.id}, ${template.id}, '${todayStr}')">
          <div class="check ${isDone?'done':''}"></div>
          <div class="task-body">
            <div class="task-text" style="${isDone?'text-decoration:line-through;color:var(--text-muted)':''}">${escapeHtml(item.text)}</div>
            <div class="cl-by" id="cl-by-${item.id}" style="font-size:11px;color:var(--text-muted);${isDone&&byName?'':'display:none'}">✓ ${byName?escapeHtml(byName):''}</div>
            ${mediaSection}
          </div>
        </div>`;
      });
      html += '</div>';
    });

    content.innerHTML = html;
    subscribeChecklistRealtime(template.id, todayStr); // мгновенная синхронизация (realtime)
    startChecklistPolling();                            // запасной опрос, если realtime отвалится
  } catch(e) { console.error(e); content.innerHTML=`<div class="loading">${t('cl.loadErrShort')}</div>`; }
}

// Живое обновление общего чек-листа. Основной путь — Supabase Realtime (мгновенно),
// плюс редкий опрос как запасной вариант, если realtime-канал отвалится.
let clPollInterval = null;
let clRealtimeChannel = null;

function startChecklistPolling() {
  stopChecklistPolling();
  clPollInterval = setInterval(pollChecklist, 8000); // фолбэк на случай обрыва realtime
}
function stopChecklistPolling() { if(clPollInterval) { clearInterval(clPollInterval); clPollInterval = null; } }

// Мгновенные обновления через realtime-подписку на строки этого чек-листа (по template_id),
// дальше проверяем дату/филиал на клиенте (realtime-фильтр поддерживает только одно условие).
function subscribeChecklistRealtime(templateId, dateStr) {
  unsubscribeChecklistRealtime();
  try {
    clRealtimeChannel = sb.channel('cl-' + templateId + '-' + currentFilial + '-' + dateStr)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_logs', filter: 'template_id=eq.' + templateId }, (payload) => {
        const row = payload.new;
        if(!row || row.date !== dateStr || row.filial !== currentFilial) return;
        applyRemoteChecklist(row.items_done, row.items_by, row.completed, row.id);
      })
      .subscribe();
  } catch(e) { /* realtime недоступен — работает поллинг-фолбэк */ }
}
function unsubscribeChecklistRealtime() {
  if(clRealtimeChannel) { try { sb.removeChannel(clRealtimeChannel); } catch(e) {} clRealtimeChannel = null; }
}

async function pollChecklist() {
  const active = document.getElementById('screen-checklist')?.classList.contains('active');
  if(!active) { stopChecklistPolling(); unsubscribeChecklistRealtime(); return; }
  if(clSaving || clSaveTimer) return;
  if(!currentChecklistLog?.id || !currentChecklistTemplate) return;
  const local = currentChecklistLog.items_done || [];
  const dirty = local.length !== clBaseline.length || local.some(x => !clBaseline.includes(x));
  if(dirty) return;
  try {
    const { data: srv } = await sb.from('checklist_logs').select('items_done,items_by,completed').eq('id', currentChecklistLog.id).single();
    if(srv) applyRemoteChecklist(srv.items_done, srv.items_by, srv.completed, currentChecklistLog.id);
  } catch(e) { /* тихо */ }
}

// Применить удалённое состояние (от realtime или опроса), не затирая несохранённые свои галочки
function applyRemoteChecklist(srvDone, itemsBy, completed, id) {
  if(clSaving || clSaveTimer) return;                 // идут мои правки — не трогаем
  if(!currentChecklistTemplate) return;
  const local = currentChecklistLog?.items_done || [];
  const dirty = local.length !== clBaseline.length || local.some(x => !clBaseline.includes(x));
  if(dirty) return;
  if(!currentChecklistLog) currentChecklistLog = { items_done: [], items_media: {}, items_by: {} };
  if(id) currentChecklistLog.id = id;                 // подхватываем id, если лог только что создали
  srvDone = srvDone || [];
  const changed = srvDone.length !== clBaseline.length || srvDone.some(x => !clBaseline.includes(x));
  if(!changed) return;                                // ничего нового (в т.ч. эхо своего сохранения)
  applyChecklistState(srvDone, itemsBy || {});
  currentChecklistLog.items_done = srvDone.slice();
  currentChecklistLog.items_by = itemsBy || {};
  currentChecklistLog.completed = completed;
  clBaseline = srvDone.slice();
  clNotified = !!completed;
}

// Применить состояние (галочки + кто отметил + прогресс) к уже отрисованному чек-листу
function applyChecklistState(doneItems, itemsBy) {
  const items = currentChecklistTemplate?.items || [];
  items.forEach(item => {
    const isDone = doneItems.includes(item.id);
    const row = document.getElementById('cl-row-' + item.id);
    if(row) {
      const check = row.querySelector('.check');
      const text = row.querySelector('.task-text');
      if(check) check.classList.toggle('done', isDone);
      if(text) text.style.cssText = isDone ? 'text-decoration:line-through;color:var(--text-muted)' : '';
    }
    const by = document.getElementById('cl-by-' + item.id);
    if(by) {
      const n = itemsBy[item.id];
      by.textContent = '✓ ' + (isDone && n ? n : '');
      by.style.display = (isDone && n) ? '' : 'none';
    }
  });
  updateChecklistProgress(doneItems.length);
}

// CHECKLIST MEDIA ATTACHMENTS
let clMediaFiles = [];

// Один пункт может хранить как один старый объект {url,type}, так и массив —
// приводим к массиву, чтобы остальной код работал единообразно.
function clMediaList(m) {
  if(!m) return [];
  return Array.isArray(m) ? m : [m];
}

function openChecklistMediaModal(itemId, templateId) {
  document.getElementById('cl-media-item-id').value = itemId;
  document.getElementById('cl-media-template-id').value = templateId;
  document.getElementById('cl-media-preview').innerHTML = '';
  document.getElementById('cl-media-file').value = '';
  clMediaFiles = [];
  openModal('modal-checklist-media');
}

function previewChecklistMedia(input) {
  clMediaFiles = Array.from(input.files || []);
  const preview = document.getElementById('cl-media-preview');
  if(!clMediaFiles.length) { preview.innerHTML = ''; return; }
  preview.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px">` + clMediaFiles.map(f => {
    const url = URL.createObjectURL(f);
    return f.type.startsWith('video')
      ? `<video src="${url}" style="width:90px;height:90px;border-radius:10px;object-fit:cover"></video>`
      : `<img src="${url}" style="width:90px;height:90px;border-radius:10px;object-fit:cover">`;
  }).join('') + `</div>`
    + (clMediaFiles.length>1 ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">Выбрано файлов: ${clMediaFiles.length}</div>` : '');
}

// Просмотр всех фото/видео, прикреплённых к пункту
function viewChecklistItemMedia(itemId) {
  const arr = clMediaList((currentChecklistLog?.items_media || {})[itemId]);
  const content = document.getElementById('view-report-content');
  content.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">` + arr.map(m =>
    m.type==='video'
      ? `<video src="${escapeHtml(m.url)}" controls style="width:100%;border-radius:12px"></video>`
      : `<img src="${escapeHtml(m.url)}" style="width:100%;border-radius:12px" onclick="viewReport('${escJsAttr(m.url)}','image')">`
  ).join('') + `</div>`;
  openModal('modal-view-report');
}

async function uploadChecklistMedia() {
  const itemId = document.getElementById('cl-media-item-id').value;
  const templateId = document.getElementById('cl-media-template-id').value;
  if(!clMediaFiles.length) return showToast(t('cl.selectFile'));

  const bar = document.getElementById('cl-media-uploading-bar');
  bar.style.display = 'block';

  try {
    const uploaded = [];
    for(let i=0; i<clMediaFiles.length; i++) {
      const file = clMediaFiles[i];
      const isVideo = file.type.startsWith('video');
      const fileToUpload = await compressImage(file);
      const ext = (fileToUpload.type.startsWith('image') ? 'jpg' : file.name.split('.').pop());
      const path = `checklist-${templateId}-${itemId}-${Date.now()}-${i}.${ext}`;
      const { error: upErr } = await sb.storage.from('task-reports').upload(path, fileToUpload);
      if(upErr) { showToast(t('common.uploadErr')+upErr.message); bar.style.display='none'; return; }
      const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
      uploaded.push({ url: urlData.publicUrl, type: isVideo?'video':'image' });
    }

    // Сначала дописываем отложенные галочки. Иначе они терялись: ниже идёт запись
    // строки и перезагрузка экрана, а отметки ждут своей очереди ещё полсекунды.
    await flushChecklistSave();

    // Дописываем к уже прикреплённым (не затираем старые фото)
    let itemsMedia = currentChecklistLog?.items_media || {};
    itemsMedia[itemId] = clMediaList(itemsMedia[itemId]).concat(uploaded);

    // Проверять надо именно id: при свежем чек-листе объект уже создан галочками,
    // но записи в базе ещё нет, и update уходил в никуда с id = undefined.
    if(currentChecklistLog?.id) {
      const { error: upErr } = await sb.from('checklist_logs')
        .update({ items_media: itemsMedia }).eq('id', currentChecklistLog.id);
      if(upErr) throw upErr;
      currentChecklistLog.items_media = itemsMedia;
    } else {
      const dateStr = businessToday();
      // Отметки берём локальные — раньше сюда уходил пустой список и стирал их
      const localDone = currentChecklistLog?.items_done || [];
      const localBy = currentChecklistLog?.items_by || {};
      const { data: newLog, error: insErr } = await sb.from('checklist_logs').insert({
        template_id: templateId, date: dateStr, user_id: currentUser.id,
        user_name: currentProfile?.name || currentUser?.email,
        items_done: localDone, items_by: localBy, items_media: itemsMedia, filial: currentFilial
      }).select().single();
      if(insErr) {
        if(insErr.code !== '23505') throw insErr;
        // строку уже создал коллега — дописываем фото в неё, не теряя её галочки
        const { data: ex } = await sb.from('checklist_logs').select('*')
          .eq('template_id', templateId).eq('date', dateStr).eq('filial', currentFilial).limit(1).single();
        if(!ex) throw insErr;
        const mergedMedia = Object.assign({}, ex.items_media || {}, itemsMedia);
        const { error: e2 } = await sb.from('checklist_logs')
          .update({ items_media: mergedMedia }).eq('id', ex.id);
        if(e2) throw e2;
        currentChecklistLog = Object.assign({}, ex, { items_media: mergedMedia });
      } else if(newLog) {
        currentChecklistLog = newLog;
      }
      clBaseline = (currentChecklistLog?.items_done || []).slice();
    }

    bar.style.display = 'none';
    closeModal('modal-checklist-media');
    showToast(uploaded.length>1 ? t('cl.photosAttached',{n:uploaded.length}) : t('cl.photoAttached'));
    loadChecklist(currentChecklistType);
  } catch(e) { bar.style.display='none'; showToast(t('common.error')+e.message); }
}

// Клик по пункту: мгновенно обновляем интерфейс, а запись в базу — в фоне (с задержкой),
// чтобы можно было отметить сразу несколько пунктов без перезагрузки экрана.
function toggleChecklistItem(itemId, templateId, date) {
  if(isBoss()) return showToast(t('cl.observerMarks'));
  const donItems = currentChecklistLog?.items_done ? currentChecklistLog.items_done.slice() : [];
  const idx = donItems.indexOf(itemId);
  const nowDone = idx === -1;
  if(nowDone) donItems.push(itemId); else donItems.splice(idx, 1);

  const myName = currentProfile?.name || currentUser?.email || '—';
  // локальное состояние
  if(!currentChecklistLog) currentChecklistLog = { items_done: donItems, items_media: {}, items_by: {} };
  else currentChecklistLog.items_done = donItems;
  if(!currentChecklistLog.items_by) currentChecklistLog.items_by = {};
  if(nowDone) currentChecklistLog.items_by[itemId] = myName; else delete currentChecklistLog.items_by[itemId];

  // мгновенно перерисовываем только эту строку и прогресс — без полной перезагрузки
  const row = document.getElementById('cl-row-' + itemId);
  if(row) {
    const check = row.querySelector('.check');
    const text = row.querySelector('.task-text');
    if(check) check.classList.toggle('done', nowDone);
    if(text) text.style.cssText = nowDone ? 'text-decoration:line-through;color:var(--text-muted)' : '';
  }
  const by = document.getElementById('cl-by-' + itemId);
  if(by) { by.textContent = '✓ ' + (nowDone ? myName : ''); by.style.display = nowDone ? '' : 'none'; }
  updateChecklistProgress(donItems.length);

  scheduleChecklistSave(templateId, date);
}

function updateChecklistProgress(doneCount) {
  const total = currentChecklistTemplate?.items?.length || 0;
  const pct = total ? Math.round(doneCount / total * 100) : 0;
  const c = document.getElementById('cl-progress-count');
  const p = document.getElementById('cl-progress-pct');
  const f = document.getElementById('cl-progress-fill');
  const banner = document.getElementById('cl-progress-banner');
  if(c) c.textContent = t('cl.doneOf',{done:doneCount,total});
  if(p) { p.textContent = pct + '%'; p.style.color = pct === 100 ? '#3B6D11' : 'var(--gold-dark)'; }
  if(f) f.style.width = pct + '%';
  if(banner) banner.style.display = pct === 100 ? 'block' : 'none';
}

function scheduleChecklistSave(templateId, date) {
  if(clSaveTimer) clearTimeout(clSaveTimer);
  // Таймер обязательно обнуляем при срабатывании: пока он «висит» непустым,
  // фоновая синхронизация считает, что идут правки, и не обновляет чек-лист.
  clSaveTimer = setTimeout(() => { clSaveTimer = null; saveChecklistNow(templateId, date); }, 500);
}

// Немедленно сохранить отложенные отметки (вызывается при уходе/смене чек-листа)
async function flushChecklistSave() {
  if(clSaveTimer) { clearTimeout(clSaveTimer); clSaveTimer = null; await saveChecklistNow(); }
  // Если запись уже шла, saveChecklistNow сразу вернётся, не дождавшись её. Ждём здесь,
  // иначе вызывающий (загрузка фото, смена чек-листа) продолжит поверх незаконченной записи.
  for(let i = 0; i < 40 && clSaving; i++) await new Promise(r => setTimeout(r, 50));
}

async function saveChecklistNow(templateId, date) {
  templateId = templateId || currentChecklistTemplate?.id;
  date = date || businessToday();
  if(!currentChecklistLog || !currentChecklistTemplate) return;
  if(clSaving) { scheduleChecklistSave(templateId, date); return; } // идёт запись — повторим позже
  clSaving = true;
  try {
    const total = currentChecklistTemplate?.items?.length || 0;
    const myName = currentProfile?.name || currentUser?.email || '—';
    const local = currentChecklistLog.items_done || [];
    // мои изменения относительно состояния на момент загрузки/прошлого сохранения
    const added = local.filter(x => !clBaseline.includes(x));
    const removed = clBaseline.filter(x => !local.includes(x));

    // если id ещё нет — вдруг общий лог уже создал кто-то другой; используем его
    if(!currentChecklistLog.id) {
      const { data: ex } = await sb.from('checklist_logs').select('id')
        .eq('template_id', templateId).eq('date', date).eq('filial', currentFilial).order('id').limit(1);
      if(ex && ex.length) currentChecklistLog.id = ex[0].id;
    }

    let merged, mergedBy;
    if(currentChecklistLog.id) {
      // сливаем свои правки со свежим состоянием строки (чтобы не затереть чужие галочки)
      const { data: srv } = await sb.from('checklist_logs').select('items_done,items_by').eq('id', currentChecklistLog.id).single();
      merged = (srv?.items_done || local).slice();
      added.forEach(x => { if(!merged.includes(x)) merged.push(x); });
      merged = merged.filter(x => !removed.includes(x));
      mergedBy = Object.assign({}, srv?.items_by || {});
      added.forEach(x => { mergedBy[x] = myName; });
      removed.forEach(x => { delete mergedBy[x]; });
      const completed = total > 0 && merged.length === total;
      // .select() обязателен: без него не видно ни ошибки, ни того, что строка не нашлась.
      // Раньше обе ситуации проходили молча — галочки «сохранялись» и слетали при перезагрузке.
      const { data: upd, error: updErr } = await sb.from('checklist_logs')
        .update({ items_done: merged, items_by: mergedBy, completed, user_name: myName })
        .eq('id', currentChecklistLog.id).select('id');
      if(updErr) throw updErr;
      if(!upd || upd.length === 0) {
        // Строки с таким id больше нет (удалили, сменили филиал, протухла сессия) —
        // не теряем отметки: сбрасываем id и заходим ещё раз через обычный путь,
        // который сам решит, создать запись или подхватить чужую.
        console.warn('checklist update matched no row, id=', currentChecklistLog.id);
        currentChecklistLog.id = null;
        scheduleChecklistSave(templateId, date);
        return;
      }
      currentChecklistLog.completed = completed;
      _handleChecklistDone(completed, date);
    } else {
      merged = local.slice();
      mergedBy = {}; merged.forEach(x => { mergedBy[x] = myName; });
      const completed = total > 0 && merged.length === total;
      const { data: newLog, error } = await sb.from('checklist_logs').insert({
        template_id: templateId, date, user_id: currentUser.id, user_name: myName,
        items_done: merged, items_by: mergedBy, completed, filial: currentFilial
      }).select('id').single();
      if(error) {
        // 23505 — строку на этот чек-лист/день уже создал коллега (уникальный индекс).
        // Не ругаемся, а подхватываем её и досохраняем свои отметки следующим проходом.
        if(error.code === '23505') {
          const { data: ex } = await sb.from('checklist_logs').select('id')
            .eq('template_id', templateId).eq('date', date).eq('filial', currentFilial).limit(1);
          if(ex && ex.length) {
            currentChecklistLog.id = ex[0].id;
            scheduleChecklistSave(templateId, date);
            return;
          }
        }
        throw error;
      }
      if(newLog) currentChecklistLog.id = newLog.id;
      _handleChecklistDone(completed, date);
    }
    // Пока шла запись, человек мог отметить ещё пункты. Раньше их тут просто
    // затирало результатом, собранным ДО начала записи: галочки на экране
    // оставались, а в памяти исчезали — и следующий тап откатывал шкалу назад.
    const nowLocal = currentChecklistLog.items_done || [];
    const addedMeanwhile   = nowLocal.filter(x => !local.includes(x));
    const removedMeanwhile = local.filter(x => !nowLocal.includes(x));

    let finalDone = merged.slice();
    addedMeanwhile.forEach(x => { if(!finalDone.includes(x)) finalDone.push(x); });
    finalDone = finalDone.filter(x => !removedMeanwhile.includes(x));

    const finalBy = Object.assign({}, mergedBy);
    addedMeanwhile.forEach(x => { finalBy[x] = (currentChecklistLog.items_by || {})[x] || myName; });
    removedMeanwhile.forEach(x => { delete finalBy[x]; });

    currentChecklistLog.items_done = finalDone;
    currentChecklistLog.items_by = finalBy;
    // База — это то, что реально лежит в базе. Отметки, сделанные во время записи,
    // остаются «несохранёнными» и уйдут следующим проходом.
    clBaseline = merged.slice();
    if(addedMeanwhile.length || removedMeanwhile.length) scheduleChecklistSave(templateId, date);
  } catch(e) {
    console.error(e);
    showToast(t('cl.saveErr') + e.message);
  } finally {
    clSaving = false;
  }
}

// Уведомление о выполнении общего чек-листа (один раз на смену)
function _handleChecklistDone(completed, date) {
  if(completed && !clNotified) {
    clNotified = true;
    // Название берём из шаблона: прежний короткий список знал только зал,
    // и бар/кухня/кальянная уходили в уведомление с пустым названием.
    const clName = currentChecklistTemplate?.name || currentChecklistType || '';
    // Кто отмечал и сколько пунктов — раньше имён в уведомлении не было вовсе
    const counts = {};
    Object.values(currentChecklistLog?.items_by || {}).forEach(n => { if(n) counts[n] = (counts[n] || 0) + 1; });
    const who = Object.entries(counts).sort((a,b)=>b[1]-a[1])
      .map(([n,c]) => `${tgEscape(n)} — ${c}`).join('\n');
    const msg = `☑️ <b>Чек-лист выполнен</b>\n\n📋 ${tgEscape(clName)} · ${tgEscape(currentChecklistDept||'')}\n📅 ${date}\n\n👤 <b>Кто отмечал:</b>\n${who || '—'}`;
    // Старшие по цеху + все управляющие (и владелец) — вверх по иерархии
    if(typeof notifyDeptSeniors === 'function' && currentChecklistDept) notifyDeptSeniors(currentChecklistDept, 1, msg, 'checklist_done');
    if(typeof notifyAdminsAll === 'function') notifyAdminsAll(msg + `\n\nОткрой приложение: https://slon-app.vercel.app`, 'checklist_done');
    else notifyAdmin(msg);
  }
  if(!completed) clNotified = false;
}

// Set today as default date
document.addEventListener('DOMContentLoaded',()=>{
  const schDate = document.getElementById('sch-date');
  if(schDate) schDate.value = today();
});

// Досохраняем отложенные отметки чек-листа при сворачивании/закрытии вкладки
// и отключаем живую синхронизацию, чтобы не держать канал/опрос впустую.
document.addEventListener('visibilitychange', () => {
  if(document.hidden) { flushChecklistSave(); stopChecklistPolling(); unsubscribeChecklistRealtime(); }
});
window.addEventListener('pagehide', () => { flushChecklistSave(); stopChecklistPolling(); unsubscribeChecklistRealtime(); });


// ===== СРОКИ СДАЧИ ЧЕК-ЛИСТОВ (руководство) =====
// Просрочку на час ловит база (pg_cron → checklist_check_overdue), здесь только настройка.

let cldTemplates = [];

async function openChecklistDeadlines() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  openModal('modal-checklist-deadlines');
  const list = document.getElementById('cld-list');
  list.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data, error } = await sb.from('checklist_templates')
      .select('id,name,department,due_time,owner_shift_start').eq('is_active', true).order('department').order('name');
    if(error) throw error;
    cldTemplates = data || [];
    const byDept = {};
    cldTemplates.forEach(x => { (byDept[x.department || '—'] = byDept[x.department || '—'] || []).push(x); });
    list.innerHTML = Object.keys(byDept).map(dept => `
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:6px">${DEPT_ICONS[dept]||'👥'} ${escapeHtml(dept)}</div>
        ${byDept[dept].map(x => `
          <div style="background:var(--surface-2);border-radius:10px;padding:10px;margin-bottom:8px">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px">${escapeHtml(x.name)}</div>
            <div style="display:flex;gap:8px">
              <label style="flex:1">
                <span style="font-size:11px;color:var(--text-muted)">${t('cld.due')}</span>
                <input class="form-input cld-due" data-id="${x.id}" type="time" value="${(x.due_time||'').slice(0,5)}" style="margin:2px 0 0">
              </label>
              <label style="flex:1">
                <span style="font-size:11px;color:var(--text-muted)">${t('cld.owner')}</span>
                <input class="form-input cld-owner" data-id="${x.id}" type="time" value="${(x.owner_shift_start||'').slice(0,5)}" style="margin:2px 0 0">
              </label>
            </div>
          </div>`).join('')}
      </div>`).join('');
    loadChecklistMisses();
  } catch(e) {
    list.innerHTML = `<div class="empty"><div class="empty-text">${t('cld.loadErr')}</div></div>`;
  }
}

async function saveChecklistDeadlines() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const val = el => { const v = el.value.trim(); return v ? v : null; };
  const updates = Array.from(document.querySelectorAll('.cld-due')).map(due => {
    const id = Number(due.dataset.id);
    const owner = document.querySelector(`.cld-owner[data-id="${id}"]`);
    return { id, due_time: val(due), owner_shift_start: owner ? val(owner) : null };
  });
  try {
    for(const u of updates) {
      const before = cldTemplates.find(x => x.id === u.id) || {};
      const same = (before.due_time||'').slice(0,5) === (u.due_time||'')
                && (before.owner_shift_start||'').slice(0,5) === (u.owner_shift_start||'');
      if(same) continue; // не трогаем то, что не меняли
      const { error } = await sb.from('checklist_templates')
        .update({ due_time: u.due_time, owner_shift_start: u.owner_shift_start }).eq('id', u.id);
      if(error) return showToast(t('common.error')+error.message);
    }
    showToast(t('cld.saved'));
    closeModal('modal-checklist-deadlines');
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function loadChecklistMisses() {
  const el = document.getElementById('cld-misses');
  if(!el) return;
  try {
    const { data } = await sb.from('checklist_misses').select('*')
      .eq('filial', currentFilial).order('date', {ascending:false}).order('id', {ascending:false}).limit(20);
    if(!data || data.length === 0) {
      el.innerHTML = `<div style="font-size:12px;color:var(--text-muted);padding:6px 2px">${t('cld.noMisses')}</div>`;
      return;
    }
    el.innerHTML = data.map(m => `
      <div class="list-item" style="align-items:flex-start">
        <div class="item-info">
          <div class="item-name" style="font-size:13px">${escapeHtml(m.template_name||'')}</div>
          <div class="item-sub">${fmtLocale(new Date(m.date),{day:'numeric',month:'short'})} · ${t('cld.wasDue',{time:(m.due_time||'').slice(0,5)})}</div>
          <div class="item-sub">${escapeHtml(m.employee_names||'—')}${m.points_given>0?` · <span style="color:#A13C3C">${t('cld.pointsGiven',{n:m.points_given})}</span>`:''}</div>
        </div>
        <span onclick="deleteChecklistMiss(${m.id})" style="color:#A32D2D;cursor:pointer;font-weight:700">✕</span>
      </div>`).join('');
  } catch(e) { el.innerHTML = ''; }
}

// Снять ошибочное невыполнение. Штрафной балл, если он был, снимается отдельно
// на экране «Проценты» → «Баллы» — там видно, кому именно он стоит.
async function deleteChecklistMiss(id) {
  if(!canEditData()) return;
  if(!await confirmDialog(t('cld.removeMiss'))) return;
  const { error } = await sb.from('checklist_misses').delete().eq('id', id);
  if(error) return showToast(t('common.error')+error.message);
  loadChecklistMisses();
}
