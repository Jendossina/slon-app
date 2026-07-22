// ============ ЛЕНТА (FEED: объявления + опросы) ============
let feedTab = 'ann';

function switchFeedTab(tab) {
  feedTab = tab;
  const a = document.getElementById('feed-tab-ann');
  const p = document.getElementById('feed-tab-polls');
  if(a&&p){
    a.style.background = tab==='ann' ? 'var(--gold-dark)' : 'var(--surface-2)';
    a.style.color = tab==='ann' ? '#fff' : 'var(--text-primary)';
    p.style.background = tab==='polls' ? 'var(--gold-dark)' : 'var(--surface-2)';
    p.style.color = tab==='polls' ? '#fff' : 'var(--text-primary)';
  }
  loadFeed();
}

async function loadFeed() {
  const addBtn = document.getElementById('feed-add-btn');
  const content = document.getElementById('feed-content');
  document.getElementById('feed-subtitle').textContent = feedTab==='ann' ? 'Новости и важное' : 'Мнение команды';

  // Кнопка добавления — своя для каждой вкладки
  if(addBtn) {
    if(canEditData()) {
      addBtn.style.display = 'block';
      addBtn.textContent = feedTab==='ann' ? '+ Объявление' : '+ Опрос';
      addBtn.onclick = feedTab==='ann' ? openAnnouncementModal : openPollModal;
    } else {
      addBtn.style.display = 'none';
    }
  }

  content.innerHTML = '<div class="loading">Загрузка...</div>';
  // Рендерим в скрытый контейнер, затем переносим в видимый
  if(feedTab==='ann') {
    await loadAnnouncements();
    content.innerHTML = document.getElementById('announcements-content').innerHTML;
  } else {
    await loadPolls();
    content.innerHTML = document.getElementById('polls-content').innerHTML;
  }
}

// ============ ОПРОСЫ (POLLS) ============
function openPollModal() {
  if(!canEditData()) return;
  document.getElementById('poll-question').value = '';
  document.getElementById('poll-filial').value = '';
  document.getElementById('poll-anonymous').checked = true;
  // Два пустых варианта по умолчанию
  document.getElementById('poll-options-list').innerHTML = '';
  addPollOption(); addPollOption();
  openModal('modal-poll');
}

function addPollOption() {
  const list = document.getElementById('poll-options-list');
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
  div.innerHTML = `<input class="form-input poll-option-input" placeholder="Вариант" style="margin:0;flex:1">
    <button onclick="this.parentElement.remove()" style="background:#FCEBEB;color:#A32D2D;border:none;border-radius:8px;width:36px;height:36px;cursor:pointer;flex:0 0 auto">✕</button>`;
  list.appendChild(div);
}

async function savePoll() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const question = document.getElementById('poll-question').value.trim();
  const options = Array.from(document.querySelectorAll('.poll-option-input')).map(i=>i.value.trim()).filter(Boolean);
  const filial = document.getElementById('poll-filial').value || null;
  const isAnon = document.getElementById('poll-anonymous').checked;
  if(!question) return showToast('Введите вопрос');
  if(options.length < 2) return showToast('Нужно минимум 2 варианта');
  try {
    await sb.from('polls').insert({
      question, options, is_anonymous: isAnon, filial,
      created_by: currentUser.id, created_by_name: currentProfile?.name || currentUser?.email
    });
    closeModal('modal-poll');
    showToast('✅ Опрос опубликован');
    loadPolls();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function loadPolls() {
  const addBtn = document.getElementById('polls-add-btn');
  if(addBtn) addBtn.style.display = canEditData() ? 'block' : 'none';
  const content = document.getElementById('polls-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const { data: polls } = await sb.from('polls').select('*')
      .or(`filial.eq.${currentFilial},filial.is.null`)
      .order('created_at',{ascending:false});
    if(!polls || polls.length===0) {
      content.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">📊</div><div class="empty-text">Опросов пока нет</div></div></div>';
      syncFeedView('polls');
      return;
    }
    // Голоса текущего пользователя и все голоса
    const pollIds = polls.map(p=>p.id);
    const { data: votes } = await sb.from('poll_votes').select('*').in('poll_id', pollIds);
    const html = [];
    for(const p of polls) {
      html.push(await pollCard(p, votes||[]));
    }
    content.innerHTML = html.join('');
    syncFeedView('polls');
  } catch(e) { content.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка. Возможно, опросы ещё не настроены в Supabase.</div></div></div>'; syncFeedView('polls'); }
}

async function pollCard(p, allVotes) {
  const votes = allVotes.filter(v=>v.poll_id===p.id);
  const myVote = votes.find(v=>v.user_id===currentUser.id);
  const total = votes.length;
  const opts = Array.isArray(p.options) ? p.options : [];
  const counts = opts.map((_,i)=>votes.filter(v=>v.option_index===i).length);
  const voted = !!myVote;
  const showResults = voted || p.is_closed || !canEditData()===false; // проголосовавшие и создатели видят результаты

  let optionsHtml = opts.map((opt,i)=>{
    const cnt = counts[i];
    const pct = total>0 ? Math.round(cnt/total*100) : 0;
    const isMine = myVote && myVote.option_index===i;
    if(voted || p.is_closed) {
      // Показать результат — полоска
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:3px">
          <span style="color:var(--text-primary)">${isMine?'✓ ':''}${escapeHtml(opt)}</span>
          <span style="color:var(--text-muted);font-weight:600">${pct}% (${cnt})</span>
        </div>
        <div style="background:var(--surface-2);border-radius:6px;height:8px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${isMine?'var(--gold-dark)':'var(--gold)'};border-radius:6px"></div>
        </div>
      </div>`;
    } else {
      // Кнопка голосования
      return `<button onclick="votePoll(${p.id},${i})" style="display:block;width:100%;text-align:left;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;font-size:14px;color:var(--text-primary);cursor:pointer">${escapeHtml(opt)}</button>`;
    }
  }).join('');

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:10px">
      <div style="font-size:16px;font-weight:700;color:var(--text-primary)">${escapeHtml(p.question)}</div>
      ${canEditData()?`<button onclick="deletePoll(${p.id})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px">🗑</button>`:''}
    </div>
    ${optionsHtml}
    <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${total} голос${total%10===1&&total%100!==11?'':total%10>=2&&total%10<=4&&(total%100<10||total%100>=20)?'а':'ов'} · ${p.is_anonymous?'🔒 анонимный':'открытый'}${voted?' · вы проголосовали':''}</div>
  </div>`;
}

async function votePoll(pollId, optionIndex) {
  if(isBoss()) return showToast('Режим наблюдателя — голосовать нельзя');
  try {
    await sb.from('poll_votes').insert({
      poll_id: pollId, option_index: optionIndex,
      user_id: currentUser.id, user_name: currentProfile?.name || currentUser?.email
    });
    showToast('✅ Голос учтён');
    loadPolls();
  } catch(e) {
    if(String(e.message).includes('duplicate')) showToast('Вы уже голосовали');
    else showToast('Ошибка: '+e.message);
  }
}

async function deletePoll(id) {
  if(!canEditData()) return;
  if(!await confirmDialog('Удалить опрос вместе с голосами?')) return;
  try {
    await sb.from('polls').delete().eq('id', id);
    showToast('✅ Удалено');
    loadPolls();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

// ============ ОБЪЯВЛЕНИЯ (ANNOUNCEMENTS) ============
function openAnnouncementModal() {
  if(!canEditData()) return;
  ['ann-title','ann-text'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('ann-filial').value = '';
  document.getElementById('ann-important').checked = false;
  openModal('modal-announcement');
}

async function saveAnnouncement() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const title = document.getElementById('ann-title').value.trim();
  const text = document.getElementById('ann-text').value.trim();
  const filial = document.getElementById('ann-filial').value || null;
  const important = document.getElementById('ann-important').checked;
  if(!title) return showToast('Введите заголовок');
  try {
    await sb.from('announcements').insert({
      title, text, is_important: important, filial,
      created_by: currentUser.id, created_by_name: currentProfile?.name || currentUser?.email
    });
    closeModal('modal-announcement');
    showToast('✅ Объявление опубликовано');
    // Уведомляем руководство о важном объявлении
    if(important) {
      const scope = filial ? getFilialName(filial) : 'Все филиалы';
      await notifyAdmin(`📢 <b>Важное объявление</b> · ${scope}\n\n🔴 ${tgEscape(title)}${text?'\n\n'+tgEscape(text):''}\n\nОпубликовал: ${tgEscape(currentProfile?.name||'')}`);
    }
    loadAnnouncements();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function loadAnnouncements() {
  const addBtn = document.getElementById('ann-add-btn');
  if(addBtn) addBtn.style.display = canEditData() ? 'block' : 'none';
  const content = document.getElementById('announcements-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    // объявления для текущего филиала ИЛИ общие (filial null)
    const { data: anns } = await sb.from('announcements').select('*')
      .or(`filial.eq.${currentFilial},filial.is.null`)
      .order('is_important',{ascending:false}).order('created_at',{ascending:false});
    if(!anns || anns.length===0) {
      content.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">📢</div><div class="empty-text">Объявлений пока нет</div></div></div>';
      syncFeedView('ann');
      return;
    }
    content.innerHTML = anns.map(a=>annCard(a)).join('');
    syncFeedView('ann');
  } catch(e) { content.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка. Возможно, объявления ещё не настроены в Supabase.</div></div></div>'; syncFeedView('ann'); }
}

// Переносит контент скрытого контейнера в видимую ленту, если она открыта на нужной вкладке
function syncFeedView(which) {
  const feedScreen = document.getElementById('screen-feed');
  if(!feedScreen || !feedScreen.classList.contains('active')) return;
  if(feedTab !== which) return;
  const src = document.getElementById(which==='ann'?'announcements-content':'polls-content');
  const dst = document.getElementById('feed-content');
  if(src && dst) dst.innerHTML = src.innerHTML;
}

function annCard(a) {
  const imp = a.is_important;
  const scope = a.filial ? getFilialName(a.filial) : 'Все филиалы';
  return `<div class="card" style="${imp?'border-left:3px solid #A32D2D;':''}">
    <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
      <div style="font-size:16px;font-weight:700;color:var(--text-primary)">${imp?'🔴 ':''}${escapeHtml(a.title)}</div>
      ${canEditData()?`<button onclick="deleteAnnouncement(${a.id})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px">🗑</button>`:''}
    </div>
    ${a.text?`<div style="font-size:14px;color:var(--text-primary);line-height:1.6;margin-top:6px;white-space:pre-wrap">${escapeHtml(a.text)}</div>`:''}
    <div style="font-size:12px;color:var(--text-muted);margin-top:8px">${new Date(a.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})} · ${escapeHtml(a.created_by_name||'')} · 📍 ${scope}</div>
  </div>`;
}

async function deleteAnnouncement(id) {
  if(!canEditData()) return;
  if(!await confirmDialog('Удалить объявление?')) return;
  try {
    await sb.from('announcements').delete().eq('id', id);
    showToast('✅ Удалено');
    loadAnnouncements();
    if(typeof loadHome==='function' && document.getElementById('screen-home')?.classList.contains('active')) loadHome();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

// Важные объявления на главном экране
async function loadHomeAnnouncements() {
  const el = document.getElementById('home-announcements');
  if(!el) return;
  el.innerHTML = '';
  try {
    const { data: anns } = await sb.from('announcements').select('*')
      .eq('is_important', true)
      .or(`filial.eq.${currentFilial},filial.is.null`)
      .order('created_at',{ascending:false}).limit(3);
    if(!anns || anns.length===0) return;
    el.innerHTML = anns.map(a=>`
      <div class="card" style="background:linear-gradient(135deg,#3a1f1f,#5a2d2d);border:none;color:#f5e9e9;margin-bottom:12px;cursor:pointer" onclick="feedTab='ann';showScreen('feed',null)">
        <div style="font-size:11px;opacity:0.7;margin-bottom:4px">${t('home.important')}</div>
        <div style="font-size:16px;font-weight:700">${escapeHtml(a.title)}</div>
        ${a.text?`<div style="font-size:13px;opacity:0.9;margin-top:4px;line-height:1.5">${escapeHtml(a.text.slice(0,120))}${a.text.length>120?'…':''}</div>`:''}
      </div>`).join('');
  } catch(e) { /* тихо */ }
}

