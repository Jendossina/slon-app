// TEAM CHAT WITH CHANNELS
const CHAT_CHANNELS = ['Официанты','Бармены','Кальянные мастера','Повара','Менеджеры','Управляющий состав'];
let currentChatChannel = 'Официанты';
let teamChatPollInterval = null;
let lastTeamChatCount = 0;

async function initTeamChat() {
  const role = currentProfile?.role;
  let myDept = null;

  if(role !== 'admin' && currentProfile?.employee_id) {
    const { data: emp } = await sb.from('employees').select('department').eq('id', currentProfile.employee_id).single();
    myDept = emp?.department;
    // Map department to channel name (managers -> Менеджеры)
    if(myDept && CHAT_CHANNELS.includes(myDept)) currentChatChannel = myDept;
  }

  const nav = document.getElementById('teamchat-channels-nav');
  let visibleChannels;
  if(canSeeAdminPanel()) {
    visibleChannels = CHAT_CHANNELS;
  } else if(role === 'manager') {
    visibleChannels = myDept && CHAT_CHANNELS.includes(myDept) ? [myDept, 'Управляющий состав'] : ['Управляющий состав'];
    visibleChannels = [...new Set(visibleChannels)];
  } else {
    visibleChannels = myDept && CHAT_CHANNELS.includes(myDept) ? [myDept] : [];
  }

  if(visibleChannels.length === 0) {
    nav.innerHTML = '';
    document.getElementById('teamchat-channel-label').textContent = 'Нет доступных чатов';
    document.getElementById('teamchat-list').innerHTML = '<div class="empty"><div class="empty-icon">💬</div><div class="empty-text">Твой отдел не привязан к чату.<br>Обратись к управляющему.</div></div>';
    return;
  }

  if(!visibleChannels.includes(currentChatChannel)) currentChatChannel = visibleChannels[0];

  nav.innerHTML = visibleChannels.map(ch => {
    const isActive = ch === currentChatChannel;
    return `<button onclick="switchChatChannel('${ch}')" style="background:${isActive?'var(--gold)':'rgba(255,255,255,0.12)'};color:${isActive?'#1a1611':'#f0e9db'};border:none;border-radius:20px;padding:6px 14px;font-size:12px;white-space:nowrap;cursor:pointer;font-weight:${isActive?'600':'400'}">${ch}</button>`;
  }).join('');

  document.getElementById('teamchat-channel-label').textContent = currentChatChannel;
  await loadTeamChat();
  markMessagesSeen();
}

function switchChatChannel(channel) {
  currentChatChannel = channel;
  document.getElementById('teamchat-channel-label').textContent = channel;
  lastTeamChatCount = 0;
  initTeamChat();
}

function startTeamChatPolling() {
  stopTeamChatPolling();
  teamChatPollInterval = setInterval(() => {
    if(document.getElementById('screen-teamchat').classList.contains('active')) {
      loadTeamChat(true);
    } else {
      stopTeamChatPolling();
    }
  }, 3000);
}
function stopTeamChatPolling() {
  if(teamChatPollInterval) { clearInterval(teamChatPollInterval); teamChatPollInterval = null; }
}

// Автообновление списка задач (чтобы фото-отчёты и статусы появлялись без перезагрузки)
let tasksPollInterval = null;
function startTasksPolling() {
  stopTasksPolling();
  tasksPollInterval = setInterval(() => {
    const active = document.getElementById('screen-tasks')?.classList.contains('active');
    if(!active) { stopTasksPolling(); return; }
    // не обновляем, если открыта какая-либо модалка (чтобы не мешать)
    const modalOpen = document.querySelector('.modal-overlay.open');
    if(modalOpen) return;
    loadTasks();
  }, 8000);
}
function stopTasksPolling() {
  if(tasksPollInterval) { clearInterval(tasksPollInterval); tasksPollInterval = null; }
}

async function loadTeamChat(isPoll) {
  const list = document.getElementById('teamchat-list');
  if(!isPoll) list.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    // Берём последние 50 (по убыванию), затем разворачиваем в хронологический порядок.
    // Так свежие сообщения всегда видны, а старая история не грузится и не тормозит.
    const { data: recent } = await sb.from('team_chat').select('*').eq('channel', currentChatChannel).order('created_at',{ascending:false}).limit(50);
    const messages = (recent||[]).slice().reverse();
    if(!messages || messages.length===0) {
      if(!isPoll || lastTeamChatCount!==0) list.innerHTML = '<div class="empty"><div class="empty-icon">💬</div><div class="empty-text">Пока нет сообщений.<br>Начни общение первым!</div></div>';
      lastTeamChatCount = 0;
      return;
    }
    if(isPoll && messages.length === lastTeamChatCount) return;
    lastTeamChatCount = messages.length;
    const wasAtBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;

    const pinned = messages.filter(m => m.is_pinned);
    const regular = messages.filter(m => !m.is_pinned);
    let html = '';
    if(pinned.length > 0) {
      html += `<div style="background:var(--surface-2);border:1px solid var(--gold);border-radius:12px;padding:10px;margin-bottom:8px">
        <div style="font-size:11px;font-weight:600;color:var(--gold-dark);margin-bottom:6px">📌 Закреплённые</div>
        ${pinned.map(m => chatBubbleHTML(m, m.user_id === currentUser?.id, true)).join('')}
      </div>`;
    }
    html += regular.map(m => chatBubbleHTML(m, m.user_id === currentUser?.id, true)).join('');
    list.innerHTML = html;
    if(!isPoll || wasAtBottom) list.scrollTop = list.scrollHeight;
  } catch(e) { console.error(e); if(!isPoll) list.innerHTML = '<div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div>'; }
  if(!isPoll) startTeamChatPolling();
}

async function toggleChatPin(msgId, isPinned) {
  const role = currentProfile?.role;
  if(role !== 'admin' && role !== 'manager') return showToast('Только управляющий может закреплять');
  await sb.from('team_chat').update({is_pinned: !isPinned}).eq('id', msgId);
  lastTeamChatCount = 0;
  loadTeamChat();
}

let teamChatMediaFile = null;
function pickTeamChatMedia() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  input.onchange = (e) => {
    teamChatMediaFile = e.target.files[0];
    if(teamChatMediaFile) {
      document.getElementById('teamchat-input').placeholder = '📎 ' + teamChatMediaFile.name;
    }
  };
  input.click();
}

async function sendTeamChat() {
  if(isBoss()) return showToast('Режим наблюдателя — вы можете только читать чат');
  const input = document.getElementById('teamchat-input');
  const text = input.value.trim();
  if(!text && !teamChatMediaFile) return;
  try {
    let mediaUrl = null, mediaType = null;
    if(teamChatMediaFile) {
      const fileToUpload = await compressImage(teamChatMediaFile);
      const ext = (fileToUpload.type.startsWith('image') ? 'jpg' : teamChatMediaFile.name.split('.').pop());
      const path = `chat-${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from('task-reports').upload(path, fileToUpload);
      if(upErr) { showToast('Ошибка загрузки: '+upErr.message); return; }
      const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
      mediaUrl = urlData.publicUrl;
      mediaType = teamChatMediaFile.type.startsWith('video') ? 'video' : 'image';
    }

    await sb.from('team_chat').insert({
      user_id: currentUser.id, user_name: currentProfile?.name || currentUser?.email,
      text, channel: currentChatChannel, media_url: mediaUrl, media_type: mediaType
    });
    input.value = '';
    input.placeholder = 'Написать сообщение...';
    teamChatMediaFile = null;
    lastTeamChatCount = 0;
    await loadTeamChat();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

// UNREAD MESSAGES INDICATOR
async function checkUnreadMessages() {
  if(!currentUser || !currentProfile) return;
  try {
    const lastSeenKey = 'slon-lastseen-' + currentUser.id;
    const lastSeen = localStorage.getItem(lastSeenKey) || '2000-01-01';

    const role = currentProfile?.role;
    let myDept = null;
    if(role !== 'admin' && currentProfile?.employee_id) {
      const { data: emp } = await sb.from('employees').select('department').eq('id', currentProfile.employee_id).single();
      myDept = emp?.department;
    }

    let query = sb.from('team_chat').select('id,created_at,channel').gt('created_at', lastSeen).neq('user_id', currentUser.id);
    if(role !== 'admin') {
      const channels = role === 'manager' ? [myDept, 'Управляющий состав'].filter(Boolean) : [myDept].filter(Boolean);
      if(channels.length === 0) { document.getElementById('unread-dot').style.display = 'none'; return; }
      query = query.in('channel', channels);
    }
    const { data } = await query.limit(1);
    const dot = document.getElementById('unread-dot');
    if(dot) dot.style.display = (data && data.length > 0) ? 'block' : 'none';
  } catch(e) { console.error(e); }
}

function markMessagesSeen() {
  if(!currentUser) return;
  localStorage.setItem('slon-lastseen-' + currentUser.id, new Date().toISOString());
  const dot = document.getElementById('unread-dot');
  if(dot) dot.style.display = 'none';
}

setInterval(checkUnreadMessages, 15000);
