// ============ СПРАВОЧНИК (DIRECTORY) ============
let dirCategory = 'supplier';
const DIR_CATS = [
  { id:'supplier', label:t('dir.suppliers') },
  { id:'contact', label:t('dir.contacts') },
  { id:'access', label:t('dir.access') },
  { id:'equipment', label:t('dir.equipment') }
];
// Доступы (пароли) видят только управляющий и владелец
function dirVisibleCats() {
  if(isAdmin() || isBoss()) return DIR_CATS;
  return DIR_CATS.filter(c=>c.id!=='access');
}
function dirCanEdit() { return canEditData(); } // менеджер и управляющий; boss — нет

function loadDirectory() {
  const cats = dirVisibleCats();
  if(!cats.find(c=>c.id===dirCategory)) dirCategory = cats[0].id;
  const addBtn = document.getElementById('dir-add-btn');
  if(addBtn) addBtn.style.display = dirCanEdit() ? 'block' : 'none';
  const tabs = document.getElementById('dir-tabs');
  tabs.innerHTML = cats.map(c=>`<button onclick="switchDirCat('${c.id}')" style="flex:0 0 auto;padding:8px 14px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;background:${c.id===dirCategory?'var(--gold-dark)':'var(--surface-2)'};color:${c.id===dirCategory?'#fff':'var(--text-primary)'}">${c.label}</button>`).join('');
  renderDirectoryList();
}

function switchDirCat(cat) { dirCategory = cat; loadDirectory(); }

// Оборудование у каждого филиала своё (filial), остальные категории общие
let dirEntries = [];
let dirPhotoUrl = null;   // фото записи, открытой в окне редактирования

function dirThumb(e) {
  if(e.photo_url) return `<img src="${escapeHtml(e.photo_url)}" loading="lazy" decoding="async" alt="" onclick="dirViewPhoto(${e.id})"
    style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex:0 0 auto;cursor:zoom-in;background:var(--surface-2)">`;
  return `<div style="width:56px;height:56px;border-radius:8px;flex:0 0 auto;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:26px">🛠️</div>`;
}

function dirViewPhoto(id) {
  const e = dirEntries.find(x=>x.id===id);
  if(!e || !e.photo_url) return;
  document.getElementById('view-report-content').innerHTML =
    `<div style="text-align:center"><img src="${escapeHtml(e.photo_url)}" alt="" style="max-width:100%;border-radius:12px">
     <div style="margin-top:8px;font-weight:600;color:var(--text-primary)">${escapeHtml(e.title)}</div></div>`;
  openModal('modal-view-report');
}

async function renderDirectoryList() {
  const content = document.getElementById('directory-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    let qb = sb.from('directory_entries').select('*').eq('category', dirCategory);
    if(dirCategory === 'equipment') qb = qb.or(`filial.eq.${currentFilial},filial.is.null`).order('field2').order('title');
    else qb = qb.order('title');
    const { data: entries } = await qb;
    dirEntries = entries || [];
    if(!entries || entries.length===0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">📇</div><div class="empty-text">${t('dir.empty')}${dirCanEdit()?t('dir.addHint'):''}</div></div></div>`;
      return;
    }
    if(dirCategory === 'equipment') { content.innerHTML = renderDirEquipment(entries); return; }
    content.innerHTML = entries.map(e=>{
      const f1label = dirCategory==='access' ? t('dir.login') : t('dir.phone');
      const f2label = dirCategory==='access' ? t('dir.password') : (dirCategory==='supplier'?t('dir.supplies'):'');
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
          <div style="flex:1">
            <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(e.title)}</div>
            ${e.field1?`<div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${f1label}: <span style="color:var(--text-primary)">${escapeHtml(e.field1)}</span>${dirCategory!=='access'&&e.field1?` · <a href="tel:${escapeHtml(e.field1)}" style="color:var(--gold-dark)">${t('dir.call')}</a>`:''}</div>`:''}
            ${e.field2?`<div style="font-size:13px;color:var(--text-secondary);margin-top:2px">${f2label}: <span style="color:var(--text-primary)">${escapeHtml(e.field2)}</span></div>`:''}
            ${e.note?`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escapeHtml(e.note)}</div>`:''}
          </div>
          ${dirCanEdit()?`<button onclick="openDirectoryModal(${e.id})" style="background:#f0e6d2;color:#8a6a2f;border:none;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">✏️</button>`:''}
        </div>
      </div>`;
    }).join('');
  } catch(e) { content.innerHTML=`<div class="card"><div class="empty"><div class="empty-text">${t('dir.errNotSetup')}</div></div></div>`; }
}

// Оборудование — по зонам (field2), с фото и количеством
function renderDirEquipment(entries) {
  const groups = {};
  entries.forEach(e=>{ const z = e.field2 || ''; (groups[z] = groups[z] || []).push(e); });
  return Object.keys(groups).map(z=>`<div class="section-label" style="margin:14px 4px 6px">${escapeHtml(z || t('dish.catOther'))} · ${groups[z].length}</div>` +
    groups[z].map(e=>`<div class="card" style="display:flex;align-items:center;gap:10px">
      ${dirThumb(e)}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(e.title)}</div>
        ${e.field1?`<div style="font-size:13px;color:var(--text-muted)">${escapeHtml(e.field1)}</div>`:''}
        ${e.note?`<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${escapeHtml(e.note)}</div>`:''}
      </div>
      ${dirCanEdit()?`<button onclick="openDirectoryModal(${e.id})" style="background:#f0e6d2;color:#8a6a2f;border:none;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;flex:0 0 auto">✏️</button>`:''}
    </div>`).join('')).join('');
}

function renderDirPhotoField() {
  const box = document.getElementById('dir-photo-preview');
  if(!box) return;
  box.innerHTML = dirPhotoUrl ? `<img src="${escapeHtml(dirPhotoUrl)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:10px">` : '';
}

function pickDirPhoto() {
  const inp = document.getElementById('dir-photo-input');
  inp.value = '';
  inp.click();
}

// Фото сразу ужимается до 400 px (десятки килобайт) и кладётся в dishware/ —
// эту папку уборка старых медиа не трогает, в отличие от корня бакета.
async function onDirPhotoPicked(input) {
  const file = input.files && input.files[0];
  if(!file) return;
  showToast(t('dish.uploading'));
  try {
    const small = await compressImage(file, 400, 0.6);
    const path = `dishware/dir-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('task-reports').upload(path, small, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if(error) return showToast(t('common.uploadErr') + error.message);
    dirPhotoUrl = sb.storage.from('task-reports').getPublicUrl(path).data.publicUrl;
    renderDirPhotoField();
  } catch(e) { showToast(t('common.error') + e.message); }
}

function updateDirFields() {
  const cat = document.getElementById('dir-category').value;
  const titleL = document.getElementById('dir-title-label');
  const f1L = document.getElementById('dir-field1-label');
  const f2L = document.getElementById('dir-field2-label');
  const f2group = document.getElementById('dir-field2').closest('.form-group');
  if(cat==='supplier') { titleL.textContent=t('dir.name'); f1L.textContent=t('dir.phone'); f2L.textContent=t('dir.whatSupplies'); f2group.style.display=''; }
  else if(cat==='contact') { titleL.textContent=t('dir.nameOrg'); f1L.textContent=t('dir.phone'); f2L.textContent=t('dir.whoIs'); f2group.style.display=''; }
  else if(cat==='access') { titleL.textContent=t('dir.service'); f1L.textContent=t('dir.login'); f2L.textContent=t('dir.password'); f2group.style.display=''; }
  else if(cat==='equipment') { titleL.textContent=t('dir.name'); f1L.textContent=t('dir.qty'); f2L.textContent=t('dir.where'); f2group.style.display=''; }
  const ph = document.getElementById('dir-photo-group');
  if(ph) ph.style.display = cat==='equipment' ? '' : 'none';
}

function openDirectoryModal(id) {
  if(!dirCanEdit()) return;
  document.getElementById('dir-id').value = id || '';
  const delBtn = document.getElementById('dir-delete-btn');
  if(id) {
    document.getElementById('dir-modal-title').textContent = t('note.edit');
    delBtn.style.display = 'block';
    sb.from('directory_entries').select('*').eq('id', id).single().then(({data})=>{
      document.getElementById('dir-category').value = data.category;
      updateDirFields();
      document.getElementById('dir-title').value = data.title||'';
      document.getElementById('dir-field1').value = data.field1||'';
      document.getElementById('dir-field2').value = data.field2||'';
      document.getElementById('dir-note').value = data.note||'';
      dirPhotoUrl = data.photo_url || null;
      renderDirPhotoField();
    });
  } else {
    document.getElementById('dir-modal-title').textContent = t('note.new');
    document.getElementById('dir-category').value = dirCategory;
    updateDirFields();
    ['dir-title','dir-field1','dir-field2','dir-note'].forEach(f=>document.getElementById(f).value='');
    dirPhotoUrl = null;
    renderDirPhotoField();
    delBtn.style.display = 'none';
  }
  openModal('modal-directory');
}

async function saveDirectory() {
  if(!dirCanEdit()) return showToast(t('dir.noRights'));
  const id = document.getElementById('dir-id').value;
  const category = document.getElementById('dir-category').value;
  const title = document.getElementById('dir-title').value.trim();
  const field1 = document.getElementById('dir-field1').value.trim();
  const field2 = document.getElementById('dir-field2').value.trim();
  const note = document.getElementById('dir-note').value.trim();
  if(!title) return showToast(t('inv.enterName'));
  try {
    const row = { category, title, field1, field2, note };
    if(category === 'equipment') row.photo_url = dirPhotoUrl;
    let res;
    if(id) res = await sb.from('directory_entries').update(row).eq('id',id);
    else {
      if(category === 'equipment') row.filial = currentFilial;   // новое оборудование — филиала, где его завели
      res = await sb.from('directory_entries').insert(row);
    }
    if(res.error) return showToast(t('common.error') + res.error.message);
    closeModal('modal-directory');
    showToast(t('sch.saved'));
    dirCategory = category;
    loadDirectory();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function deleteDirectory() {
  if(!dirCanEdit()) return;
  const id = document.getElementById('dir-id').value;
  if(!id) return;
  if(!await confirmDialog(t('note.delConfirm'))) return;
  try {
    await sb.from('directory_entries').delete().eq('id', id);
    closeModal('modal-directory');
    showToast(t('sch.deleted'));
    loadDirectory();
  } catch(e) { showToast(t('common.error')+e.message); }
}

