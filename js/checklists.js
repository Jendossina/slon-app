// CHECKLISTS
let currentChecklistType = null;
let currentChecklistLog = null;
let currentChecklistDept = null;

const CHECKLIST_DEPTS = ['Официанты','Бармены','Кальянные мастера','Повара'];
const CHECKLIST_DEPT_ICONS = {'Официанты':'🍽️','Бармены':'🍹','Кальянные мастера':'💨','Повара':'👨‍🍳'};

// Инициализация экрана чек-листов: определяем отдел и строим вкладки
async function initChecklistScreen() {
  document.getElementById('checklist-date').textContent = new Date().toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});
  const role = currentRole();
  const canSeeAll = (role === 'admin' || role === 'manager' || role === 'boss');

  // Отдел по умолчанию — свой у сотрудника
  let myDept = null;
  if(currentProfile?.employee_id) {
    const { data: emp } = await sb.from('employees').select('department').eq('id', currentProfile.employee_id).single();
    myDept = emp?.department || null;
  }
  if(!currentChecklistDept) currentChecklistDept = (canSeeAll ? (myDept || 'Официанты') : (myDept || 'Официанты'));

  // Переключатель отделов — только для руководства
  const deptSwitcher = document.getElementById('checklist-dept-switcher');
  if(canSeeAll) {
    deptSwitcher.style.display = 'flex';
    deptSwitcher.innerHTML = CHECKLIST_DEPTS.map(d=>`<button onclick="switchChecklistDept('${d}')" style="background:${d===currentChecklistDept?'var(--gold)':'transparent'};color:${d===currentChecklistDept?'#1a1611':'#8a8a99'};border:none;padding:10px 8px;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer;border-bottom:2px solid ${d===currentChecklistDept?'var(--gold)':'transparent'}">${CHECKLIST_DEPT_ICONS[d]||''} ${d}</button>`).join('');
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
    tabsEl.innerHTML = templates.map(t=>`<button onclick="switchChecklistTab('${escJsAttr(t.type)}')" class="ctab" style="background:${t.type===currentChecklistType?'#A6803F':'rgba(255,255,255,0.15)'};color:#fff;border:none;border-radius:20px;padding:6px 16px;font-size:13px;white-space:nowrap;cursor:pointer">${escapeHtml(t.name)}</button>`).join('');
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
  const content = document.getElementById('checklist-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  document.getElementById('checklist-date').textContent = new Date().toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});

  try {
    // Get template
    const { data: templates } = await sb.from('checklist_templates').select('*').eq('type', type).eq('department', currentChecklistDept).eq('is_active', true);
    if(!templates || templates.length===0) { content.innerHTML='<div class="empty"><div class="empty-icon">☑️</div><div class="empty-text">Чек-лист не найден</div></div>'; return; }
    const template = templates[0];
    const items = template.items;

    // Get today log
    const todayStr = today();
    const { data: logs } = await sb.from('checklist_logs')
      .select('*')
      .eq('template_id', template.id)
      .eq('date', todayStr)
      .eq('user_id', currentUser.id)
      .eq('filial', currentFilial);
    
    currentChecklistLog = logs && logs.length > 0 ? logs[0] : null;
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
        <span style="font-size:13px;color:#999">${doneCount} из ${totalCount} выполнено</span>
        <span style="font-size:18px;font-weight:700;color:${pct===100?'#3B6D11':'#A6803F'}">${pct}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      ${pct===100?'<div style="text-align:center;margin-top:10px;font-size:13px;color:#3B6D11;font-weight:500">✅ Чек-лист выполнен!</div>':''}
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
        html += `<div class="task-row" onclick="toggleChecklistItem(${item.id}, ${template.id}, '${todayStr}')">
          <div class="check ${isDone?'done':''}"></div>
          <div class="task-body">
            <div class="task-text" style="${isDone?'text-decoration:line-through;color:#999':''}">${escapeHtml(item.text)}</div>
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

async function toggleChecklistItem(itemId, templateId, date) {
  try {
    let donItems = currentChecklistLog?.items_done || [];
    const idx = donItems.indexOf(itemId);
    if(idx > -1) donItems.splice(idx, 1);
    else donItems.push(itemId);

    // Get total items count
    const { data: template } = await sb.from('checklist_templates').select('items').eq('id', templateId).single();
    const totalCount = template?.items?.length || 0;
    const completed = donItems.length === totalCount;

    if(currentChecklistLog) {
      await sb.from('checklist_logs').update({items_done: donItems, completed}).eq('id', currentChecklistLog.id);
      currentChecklistLog.items_done = donItems;
      currentChecklistLog.completed = completed;
    } else {
      const { data: newLog } = await sb.from('checklist_logs').insert({
        template_id: templateId,
        date,
        user_id: currentUser.id,
        user_name: currentProfile?.name || currentUser?.email,
        items_done: donItems,
        completed,
        filial: currentFilial
      }).select().single();
      currentChecklistLog = newLog;
    }

    // Notify admin if completed
    if(completed) {
      const typeLabels = {open:'Открытие смены', second:'2-й официант', close:'Закрытие смены'};
      await notifyAdmin(`☑️ <b>Чек-лист выполнен!</b>\n\n📋 ${typeLabels[currentChecklistType]||''}\n👤 ${currentProfile?.name||''}\n📅 ${date}\n\nОткрой приложение: https://slon-app.vercel.app`);
    }

    await loadChecklist(currentChecklistType);
  } catch(e) { console.error(e); showToast('Ошибка сохранения: '+e.message); }
}

// Set today as default date
document.addEventListener('DOMContentLoaded',()=>{
  const schDate = document.getElementById('sch-date');
  if(schDate) schDate.value = today();
});

