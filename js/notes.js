// ============ ЛИЧНЫЙ ЗАДАЧНИК (MY NOTES) ============
let myNotesFilter = 'active';

function updateMyNoteFields() {
  const kind = document.getElementById('mynote-kind').value;
  const dueGroup = document.getElementById('mynote-due-group');
  const prioGroup = document.getElementById('mynote-priority-group');
  const label = document.getElementById('mynote-text-label');
  if(kind==='note') { dueGroup.style.display='none'; label.textContent=t('note.textNote'); }
  else { dueGroup.style.display=''; label.textContent=t('note.textTask'); }
  prioGroup.style.display=''; // приоритет для обоих
}

function openMyNoteModal(id) {
  document.getElementById('mynote-id').value = id || '';
  const delBtn = document.getElementById('mynote-delete-btn');
  if(id) {
    document.getElementById('mynote-modal-title').textContent = t('note.edit');
    delBtn.style.display = 'block';
    sb.from('my_notes').select('*').eq('id', id).single().then(({data})=>{
      document.getElementById('mynote-kind').value = data.kind;
      document.getElementById('mynote-text').value = data.text;
      document.getElementById('mynote-due').value = data.due_date || '';
      document.getElementById('mynote-priority').value = data.priority || 'normal';
      updateMyNoteFields();
    });
  } else {
    document.getElementById('mynote-modal-title').textContent = t('note.new');
    document.getElementById('mynote-kind').value = 'task';
    document.getElementById('mynote-text').value = '';
    document.getElementById('mynote-due').value = '';
    document.getElementById('mynote-priority').value = 'normal';
    delBtn.style.display = 'none';
    updateMyNoteFields();
  }
  openModal('modal-mynote');
}

async function saveMyNote() {
  const id = document.getElementById('mynote-id').value;
  const kind = document.getElementById('mynote-kind').value;
  const text = document.getElementById('mynote-text').value.trim();
  const due = document.getElementById('mynote-due').value || null;
  const priority = document.getElementById('mynote-priority').value;
  if(!text) return showToast(t('note.enterText'));
  try {
    if(id) {
      await sb.from('my_notes').update({kind, text, due_date: kind==='note'?null:due, priority}).eq('id', id);
    } else {
      await sb.from('my_notes').insert({user_id: currentUser.id, kind, text, due_date: kind==='note'?null:due, priority});
    }
    closeModal('modal-mynote');
    showToast(t('sch.saved'));
    loadMyNotes();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function deleteMyNote() {
  const id = document.getElementById('mynote-id').value;
  if(!id) return;
  if(!await confirmDialog(t('note.delConfirm'))) return;
  try {
    await sb.from('my_notes').delete().eq('id', id);
    closeModal('modal-mynote');
    showToast(t('sch.deleted'));
    loadMyNotes();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function toggleMyNote(id, done) {
  try {
    await sb.from('my_notes').update({is_done: !done}).eq('id', id);
    loadMyNotes();
  } catch(e) { showToast(t('common.error')+e.message); }
}

function setMyNotesFilter(f) { myNotesFilter = f; loadMyNotes(); }

async function loadMyNotes() {
  const filters = [
    { id:'active', label:t('note.filterActive') },
    { id:'today', label:t('note.filterToday') },
    { id:'notes', label:t('note.filterNotes') },
    { id:'done', label:t('note.filterDone') },
    { id:'all', label:t('note.filterAll') }
  ];
  document.getElementById('mynotes-filters').innerHTML = filters.map(f=>`<button onclick="setMyNotesFilter('${f.id}')" style="flex:0 0 auto;padding:7px 13px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;background:${f.id===myNotesFilter?'var(--gold-dark)':'var(--surface-2)'};color:${f.id===myNotesFilter?'#fff':'var(--text-primary)'}">${f.label}</button>`).join('');

  const content = document.getElementById('mynotes-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    // RLS сам ограничит выборку только моими записями, но для надёжности фильтруем по user_id
    let query = sb.from('my_notes').select('*').eq('user_id', currentUser.id);
    const { data: all } = await query;
    let notes = all || [];
    const todayStr = ymdLocal();

    // Фильтрация
    if(myNotesFilter==='active') notes = notes.filter(n=>!n.is_done);
    else if(myNotesFilter==='done') notes = notes.filter(n=>n.is_done);
    else if(myNotesFilter==='notes') notes = notes.filter(n=>n.kind==='note');
    else if(myNotesFilter==='today') notes = notes.filter(n=>!n.is_done && n.due_date===todayStr);

    if(notes.length===0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">📝</div><div class="empty-text">${t('note.empty')}</div></div></div>`;
      return;
    }

    // Сортировка: невыполненные важные сверху, затем по сроку, заметки в конце
    notes.sort((a,b)=>{
      if(a.is_done !== b.is_done) return a.is_done?1:-1;
      if((a.priority==='important') !== (b.priority==='important')) return a.priority==='important'?-1:1;
      if(a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if(a.due_date) return -1;
      if(b.due_date) return 1;
      return new Date(b.created_at)-new Date(a.created_at);
    });

    content.innerHTML = notes.map(n=>{
      const isNote = n.kind==='note';
      const imp = n.priority==='important';
      const overdue = n.due_date && !n.is_done && n.due_date < todayStr;
      const dueLabel = n.due_date ? fmtLocale(new Date(n.due_date), {day:'numeric',month:'short'}) : '';
      return `<div class="card" style="${imp?'border-left:3px solid #A32D2D;':''}${n.is_done?'opacity:0.55;':''}display:flex;align-items:start;gap:10px">
        ${!isNote?`<div onclick="toggleMyNote(${n.id},${n.is_done})" style="width:24px;height:24px;border-radius:6px;border:2px solid ${n.is_done?'#3B6D11':'var(--border)'};background:${n.is_done?'#3B6D11':'transparent'};color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;font-size:14px;margin-top:1px">${n.is_done?'✓':''}</div>`:'<div style="font-size:18px;flex:0 0 auto">📝</div>'}
        <div style="flex:1;cursor:pointer" onclick="openMyNoteModal(${n.id})">
          <div style="font-size:15px;color:var(--text-primary);${n.is_done?'text-decoration:line-through':''};white-space:pre-wrap;line-height:1.4">${imp?'🔴 ':''}${escapeHtml(n.text)}</div>
          ${n.due_date?`<div style="font-size:12px;color:${overdue?'#A32D2D':'var(--text-muted)'};margin-top:4px">${overdue?t('note.overdue'):'📅 '}${dueLabel}</div>`:''}
        </div>
      </div>`;
    }).join('');
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('note.errNotSetup')}</div></div></div>`; }
}

