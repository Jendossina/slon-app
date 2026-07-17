// CHECKLISTS
let currentChecklistType = null;
let currentChecklistLog = null;
let currentChecklistDept = null;
let currentChecklistTemplate = null; // текущий шаблон — чтобы не запрашивать его на каждую галочку
let clSaveTimer = null;              // таймер отложенного сохранения (даёт отметить пачку галочек)
let clSaving = false;               // идёт ли сейчас запись (чтобы не было гонки/дублей)
let clNotified = false;             // отправляли ли уже уведомление о выполнении

const CHECKLIST_DEPTS = ['Официанты','Бармены','Кальянные мастера','Повара'];
const CHECKLIST_DEPT_ICONS = {'Официанты':'🍽️','Бармены':'🍹','Кальянные мастера':'💨','Повара':'👨‍🍳'};

// Инициализация экрана чек-листов: определяем отдел и строим вкладки
async function initChecklistScreen() {
  document.getElementById('checklist-date').textContent = new Date().toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});
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
    deptSwitcher.innerHTML = CHECKLIST_DEPTS.map(d=>`<button onclick="switchChecklistDept('${d}')" style="background:${d===currentChecklistDept?'var(--gold-dark)':'rgba(255,255,255,0.15)'};color:#fff;border:none;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer">${CHECKLIST_DEPT_ICONS[d]||''} ${d}</button>`).join('');
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
      content.innerHTML = '<div class="empty"><div class="empty-icon">☑️</div><div class="empty-text">Для отдела «'+currentChecklistDept+'» чек-листов пока нет</div></div>';
      return;
    }
    // Если текущий тип не входит в список — берём первый
    if(!currentChecklistType || !templates.find(t=>t.type===currentChecklistType)) {
      currentChecklistType = templates[0].type;
    }
    tabsEl.innerHTML = templates.map(t=>`<button onclick="switchChecklistTab('${escJsAttr(t.type)}')" class="ctab" style="background:${t.type===currentChecklistType?'var(--gold-dark)':'rgba(255,255,255,0.15)'};color:#fff;border:none;border-radius:20px;padding:6px 16px;font-size:13px;white-space:nowrap;cursor:pointer">${escapeHtml(t.name)}</button>`).join('');
    await loadChecklist(currentChecklistType);
  } catch(e) {
    content.innerHTML = '<div class="empty"><div class="empty-text">Ошибка загрузки чек-листов</div></div>';
  }
}

async function switchChecklistTab(type, btn) {
  currentChecklistType = type;
  await buildChecklistTabs();
}

async function loadChecklist(type) {
  await flushChecklistSave(); // досохраняем отметки предыдущего чек-листа перед перерисовкой
  const content = document.getElementById('checklist-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  document.getElementById('checklist-date').textContent = new Date().toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});

  try {
    // Get template
    const { data: templates } = await sb.from('checklist_templates').select('*').eq('type', type).eq('department', currentChecklistDept).eq('is_active', true);
    if(!templates || templates.length===0) { content.innerHTML='<div class="empty"><div class="empty-icon">☑️</div><div class="empty-text">Чек-лист не найден</div></div>'; return; }
    const template = templates[0];
    const items = template.items;
    currentChecklistTemplate = template; // запоминаем, чтобы toggle не лез в базу за total

    // Get today log
    const todayStr = today();
    const { data: logs } = await sb.from('checklist_logs')
      .select('*')
      .eq('template_id', template.id)
      .eq('date', todayStr)
      .eq('user_id', currentUser.id)
      .eq('filial', currentFilial);
    
    currentChecklistLog = logs && logs.length > 0 ? logs[0] : null;
    clNotified = !!currentChecklistLog?.completed; // не слать повторное уведомление, если уже выполнен
    const donItems = currentChecklistLog?.items_done || [];
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
        <span style="font-size:13px;color:var(--text-muted)" id="cl-progress-count">${doneCount} из ${totalCount} выполнено</span>
        <span style="font-size:18px;font-weight:700;color:${pct===100?'#3B6D11':'var(--gold-dark)'}" id="cl-progress-pct">${pct}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="cl-progress-fill" style="width:${pct}%"></div></div>
      <div id="cl-progress-banner" style="text-align:center;margin-top:10px;font-size:13px;color:#3B6D11;font-weight:500;display:${pct===100?'block':'none'}">✅ Чек-лист выполнен!</div>
    </div>`;

    // Sections
    Object.entries(sections).forEach(([section, sItems]) => {
      html += `<div class="section-label">${section}</div><div class="card" style="padding:10px 14px">`;
      sItems.forEach(item => {
        const isDone = donItems.includes(item.id);
        const media = itemsMedia[item.id];
        let mediaSection = '';
        if(media) {
          const isVideo = media.type === 'video';
          mediaSection = `<button class="report-btn done-report" onclick="event.stopPropagation();viewReport('${escJsAttr(media.url)}','${escJsAttr(media.type)}')">${isVideo?'🎥':'📸'} Смотреть</button>`;
        } else {
          mediaSection = `<button class="report-btn" onclick="event.stopPropagation();openChecklistMediaModal(${item.id},${template.id})">📎 Прикрепить фото</button>`;
        }
        html += `<div class="task-row" id="cl-row-${item.id}" onclick="toggleChecklistItem(${item.id}, ${template.id}, '${todayStr}')">
          <div class="check ${isDone?'done':''}"></div>
          <div class="task-body">
            <div class="task-text" style="${isDone?'text-decoration:line-through;color:var(--text-muted)':''}">${escapeHtml(item.text)}</div>
            ${mediaSection}
          </div>
        </div>`;
      });
      html += '</div>';
    });

    content.innerHTML = html;
  } catch(e) { console.error(e); content.innerHTML='<div class="loading">Ошибка загрузки</div>'; }
}

// CHECKLIST MEDIA ATTACHMENTS
let clMediaFile = null;

function openChecklistMediaModal(itemId, templateId) {
  document.getElementById('cl-media-item-id').value = itemId;
  document.getElementById('cl-media-template-id').value = templateId;
  document.getElementById('cl-media-preview').innerHTML = '';
  document.getElementById('cl-media-file').value = '';
  clMediaFile = null;
  openModal('modal-checklist-media');
}

function previewChecklistMedia(input) {
  clMediaFile = input.files[0];
  if(!clMediaFile) return;
  const preview = document.getElementById('cl-media-preview');
  const url = URL.createObjectURL(clMediaFile);
  if(clMediaFile.type.startsWith('video')) {
    preview.innerHTML = `<video src="${url}" controls style="max-width:100%;border-radius:10px;max-height:200px"></video>`;
  } else {
    preview.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:10px;max-height:200px;object-fit:cover">`;
  }
}

async function uploadChecklistMedia() {
  const itemId = document.getElementById('cl-media-item-id').value;
  const templateId = document.getElementById('cl-media-template-id').value;
  if(!clMediaFile) return showToast('Выберите файл');

  const bar = document.getElementById('cl-media-uploading-bar');
  bar.style.display = 'block';

  try {
    const fileToUpload = await compressImage(clMediaFile);
    const ext = (fileToUpload.type.startsWith('image') ? 'jpg' : clMediaFile.name.split('.').pop());
    const path = `checklist-${templateId}-${itemId}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('task-reports').upload(path, fileToUpload);
    if(upErr) { showToast('Ошибка загрузки: '+upErr.message); bar.style.display='none'; return; }
    const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
    const isVideo = clMediaFile.type.startsWith('video');

    // Save to items_media in checklist_logs
    let itemsMedia = currentChecklistLog?.items_media || {};
    itemsMedia[itemId] = { url: urlData.publicUrl, type: isVideo?'video':'image' };

    if(currentChecklistLog) {
      await sb.from('checklist_logs').update({items_media: itemsMedia}).eq('id', currentChecklistLog.id);
      currentChecklistLog.items_media = itemsMedia;
    } else {
      const dateStr = today();
      const { data: newLog } = await sb.from('checklist_logs').insert({
        template_id: templateId, date: dateStr, user_id: currentUser.id,
        user_name: currentProfile?.name || currentUser?.email,
        items_done: [], items_media: itemsMedia, filial: currentFilial
      }).select().single();
      currentChecklistLog = newLog;
    }

    bar.style.display = 'none';
    closeModal('modal-checklist-media');
    showToast('✅ Фото прикреплено');
    loadChecklist(currentChecklistType);
  } catch(e) { bar.style.display='none'; showToast('Ошибка: '+e.message); }
}

// Клик по пункту: мгновенно обновляем интерфейс, а запись в базу — в фоне (с задержкой),
// чтобы можно было отметить сразу несколько пунктов без перезагрузки экрана.
function toggleChecklistItem(itemId, templateId, date) {
  if(isBoss()) return showToast('Режим наблюдателя — отметки недоступны');
  const donItems = currentChecklistLog?.items_done ? currentChecklistLog.items_done.slice() : [];
  const idx = donItems.indexOf(itemId);
  const nowDone = idx === -1;
  if(nowDone) donItems.push(itemId); else donItems.splice(idx, 1);

  // локальное состояние
  if(!currentChecklistLog) currentChecklistLog = { items_done: donItems, items_media: {} };
  else currentChecklistLog.items_done = donItems;

  // мгновенно перерисовываем только эту строку и прогресс — без полной перезагрузки
  const row = document.getElementById('cl-row-' + itemId);
  if(row) {
    const check = row.querySelector('.check');
    const text = row.querySelector('.task-text');
    if(check) check.classList.toggle('done', nowDone);
    if(text) text.style.cssText = nowDone ? 'text-decoration:line-through;color:var(--text-muted)' : '';
  }
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
  if(c) c.textContent = `${doneCount} из ${total} выполнено`;
  if(p) { p.textContent = pct + '%'; p.style.color = pct === 100 ? '#3B6D11' : 'var(--gold-dark)'; }
  if(f) f.style.width = pct + '%';
  if(banner) banner.style.display = pct === 100 ? 'block' : 'none';
}

function scheduleChecklistSave(templateId, date) {
  if(clSaveTimer) clearTimeout(clSaveTimer);
  clSaveTimer = setTimeout(() => saveChecklistNow(templateId, date), 500);
}

// Немедленно сохранить отложенные отметки (вызывается при уходе/смене чек-листа)
async function flushChecklistSave() {
  if(clSaveTimer) { clearTimeout(clSaveTimer); clSaveTimer = null; await saveChecklistNow(); }
}

async function saveChecklistNow(templateId, date) {
  // параметры нужны только для первой вставки; при повторных берём из currentChecklistLog
  templateId = templateId || currentChecklistTemplate?.id;
  date = date || today();
  if(!currentChecklistLog || !currentChecklistTemplate) return;
  if(clSaving) { scheduleChecklistSave(templateId, date); return; } // идёт запись — повторим позже
  clSaving = true;
  try {
    const donItems = currentChecklistLog.items_done || [];
    const total = currentChecklistTemplate?.items?.length || 0;
    const completed = total > 0 && donItems.length === total;
    if(currentChecklistLog.id) {
      await sb.from('checklist_logs').update({ items_done: donItems, completed }).eq('id', currentChecklistLog.id);
      currentChecklistLog.completed = completed;
    } else {
      const { data: newLog, error } = await sb.from('checklist_logs').insert({
        template_id: templateId, date, user_id: currentUser.id,
        user_name: currentProfile?.name || currentUser?.email,
        items_done: donItems, completed, filial: currentFilial
      }).select('id').single();
      if(error) throw error;
      if(newLog) currentChecklistLog.id = newLog.id; // тот же объект, просто получил id
    }
    if(completed && !clNotified) {
      clNotified = true;
      const typeLabels = { open:'Открытие смены', second:'2-й официант', close:'Закрытие смены' };
      notifyAdmin(`☑️ <b>Чек-лист выполнен!</b>\n\n📋 ${typeLabels[currentChecklistType]||''}\n👤 ${currentProfile?.name||''}\n📅 ${date}\n\nОткрой приложение: https://slon-app.vercel.app`);
    }
    if(!completed) clNotified = false;
    if(typeof loadHome === 'function') { /* прогресс на главной обновится при следующем заходе */ }
  } catch(e) {
    console.error(e);
    showToast('Ошибка сохранения: ' + e.message);
  } finally {
    clSaving = false;
  }
}

// Set today as default date
document.addEventListener('DOMContentLoaded',()=>{
  const schDate = document.getElementById('sch-date');
  if(schDate) schDate.value = today();
});

// Досохраняем отложенные отметки чек-листа при сворачивании/закрытии вкладки
document.addEventListener('visibilitychange', () => { if(document.hidden) flushChecklistSave(); });
window.addEventListener('pagehide', () => { flushChecklistSave(); });

