// ============ СПРАВОЧНИК (DIRECTORY) ============
let dirCategory = 'supplier';
const DIR_CATS = [
  { id:'supplier', label:'📦 Поставщики' },
  { id:'contact', label:'📞 Контакты' },
  { id:'access', label:'🔑 Доступы' }
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
  tabs.innerHTML = cats.map(c=>`<button onclick="switchDirCat('${c.id}')" style="flex:0 0 auto;padding:8px 14px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;background:${c.id===dirCategory?'#A6803F':'var(--surface-2)'};color:${c.id===dirCategory?'#fff':'var(--text-primary)'}">${c.label}</button>`).join('');
  renderDirectoryList();
}

function switchDirCat(cat) { dirCategory = cat; loadDirectory(); }

async function renderDirectoryList() {
  const content = document.getElementById('directory-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const { data: entries } = await sb.from('directory_entries').select('*').eq('category', dirCategory).order('title');
    if(!entries || entries.length===0) {
      content.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">📇</div><div class="empty-text">Пусто'+(dirCanEdit()?'.<br>Нажми «+ Добавить».':'')+'</div></div></div>';
      return;
    }
    const isAccess = dirCategory === 'access';
    content.innerHTML = entries.map(e=>{
      const f1label = dirCategory==='access' ? 'Логин' : 'Телефон';
      const f2label = dirCategory==='access' ? 'Пароль' : (dirCategory==='supplier'?'Поставляет':'');
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
          <div style="flex:1">
            <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(e.title)}</div>
            ${e.field1?`<div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${f1label}: <span style="color:var(--text-primary)">${escapeHtml(e.field1)}</span>${dirCategory!=='access'&&e.field1?` · <a href="tel:${escapeHtml(e.field1)}" style="color:var(--gold-dark)">позвонить</a>`:''}</div>`:''}
            ${e.field2?`<div style="font-size:13px;color:var(--text-secondary);margin-top:2px">${f2label}: <span style="color:var(--text-primary)">${escapeHtml(e.field2)}</span></div>`:''}
            ${e.note?`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escapeHtml(e.note)}</div>`:''}
          </div>
          ${dirCanEdit()?`<button onclick="openDirectoryModal(${e.id})" style="background:#f0e6d2;color:#8a6a2f;border:none;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">✏️</button>`:''}
        </div>
      </div>`;
    }).join('');
  } catch(e) { content.innerHTML='<div class="card"><div class="empty"><div class="empty-text">Ошибка. Возможно, справочник ещё не настроен в Supabase.</div></div></div>'; }
}

function updateDirFields() {
  const cat = document.getElementById('dir-category').value;
  const titleL = document.getElementById('dir-title-label');
  const f1L = document.getElementById('dir-field1-label');
  const f2L = document.getElementById('dir-field2-label');
  const f2group = document.getElementById('dir-field2').closest('.form-group');
  if(cat==='supplier') { titleL.textContent='Название'; f1L.textContent='Телефон'; f2L.textContent='Что поставляет'; f2group.style.display=''; }
  else if(cat==='contact') { titleL.textContent='Имя / организация'; f1L.textContent='Телефон'; f2L.textContent='Кто это (роль)'; f2group.style.display=''; }
  else if(cat==='access') { titleL.textContent='Сервис (iiko, Wi-Fi…)'; f1L.textContent='Логин'; f2L.textContent='Пароль'; f2group.style.display=''; }
}

function openDirectoryModal(id) {
  if(!dirCanEdit()) return;
  document.getElementById('dir-id').value = id || '';
  const delBtn = document.getElementById('dir-delete-btn');
  if(id) {
    document.getElementById('dir-modal-title').textContent = 'Редактировать';
    delBtn.style.display = 'block';
    sb.from('directory_entries').select('*').eq('id', id).single().then(({data})=>{
      document.getElementById('dir-category').value = data.category;
      updateDirFields();
      document.getElementById('dir-title').value = data.title||'';
      document.getElementById('dir-field1').value = data.field1||'';
      document.getElementById('dir-field2').value = data.field2||'';
      document.getElementById('dir-note').value = data.note||'';
    });
  } else {
    document.getElementById('dir-modal-title').textContent = 'Новая запись';
    document.getElementById('dir-category').value = dirCategory;
    updateDirFields();
    ['dir-title','dir-field1','dir-field2','dir-note'].forEach(f=>document.getElementById(f).value='');
    delBtn.style.display = 'none';
  }
  openModal('modal-directory');
}

async function saveDirectory() {
  if(!dirCanEdit()) return showToast('Нет прав');
  const id = document.getElementById('dir-id').value;
  const category = document.getElementById('dir-category').value;
  const title = document.getElementById('dir-title').value.trim();
  const field1 = document.getElementById('dir-field1').value.trim();
  const field2 = document.getElementById('dir-field2').value.trim();
  const note = document.getElementById('dir-note').value.trim();
  if(!title) return showToast('Введите название');
  try {
    if(id) {
      await sb.from('directory_entries').update({category,title,field1,field2,note}).eq('id',id);
    } else {
      await sb.from('directory_entries').insert({category,title,field1,field2,note});
    }
    closeModal('modal-directory');
    showToast('✅ Сохранено');
    dirCategory = category;
    loadDirectory();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function deleteDirectory() {
  if(!dirCanEdit()) return;
  const id = document.getElementById('dir-id').value;
  if(!id) return;
  if(!confirm('Удалить запись?')) return;
  try {
    await sb.from('directory_entries').delete().eq('id', id);
    closeModal('modal-directory');
    showToast('✅ Удалено');
    loadDirectory();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

