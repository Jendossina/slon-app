async function loadHome() {
  const d = new Date();
  document.getElementById('home-date').textContent = d.toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});
  document.getElementById('finance-period').textContent = d.toLocaleDateString('ru-RU', {month:'long', year:'numeric'});
  const role = currentProfile?.role;
  const name = currentProfile?.name || currentUser?.email;
  document.getElementById('home-welcome-text').textContent = `Привет, ${name}!`;
  const roleLabels = { admin: '👑 Управляющий', manager: '📋 Менеджер', employee: '👤 Сотрудник', boss: '🦉 Владелец (наблюдатель)' };
  document.getElementById('home-role-text').textContent = roleLabels[role] || '';
  loadHomeAnnouncements();
  try {
    const todayStr = today();
    let tasksQuery = sb.from('tasks').select('*').eq('due_date', todayStr);
    if(role === 'employee') tasksQuery = tasksQuery.eq('assigned_to_id', currentUser.id);
    else tasksQuery = tasksQuery.eq('filial', currentFilial);
    const { data: tasks } = await tasksQuery;
    const done = (tasks||[]).filter(t=>t.status==='done').length;
    const total = (tasks||[]).length;
    const pct = total ? Math.round(done/total*100) : 0;
    document.getElementById('home-progress-bar').style.width = pct+'%';
    document.getElementById('home-tasks-text').textContent = total ? `${done} из ${total} выполнено` : 'Задач на сегодня нет';
    const myEl = document.getElementById('home-my-tasks');
    if(!tasks||tasks.length===0) { myEl.innerHTML='<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">Задач на сегодня нет</div></div>'; }
    else { myEl.innerHTML = tasks.map(t=>taskHTML(t)).join(''); }

    // Show my shift on home screen
    if(currentProfile?.employee_id) {
      const { data: myShifts } = await sb.from('schedules').select('*').eq('date', todayStr).eq('employee_id', currentProfile.employee_id);
      const myShift = myShifts && myShifts.length > 0 ? myShifts[0] : null;
      const shiftEl = document.getElementById('home-shift-card');
      if(shiftEl) {
        if(myShift) {
          if(myShift.is_day_off) {
            shiftEl.innerHTML = `<div class="card" style="background:linear-gradient(135deg,#EAF3DE,#d4edda);border:none;margin-bottom:12px"><div style="text-align:center;padding:8px"><div style="font-size:28px">🌴</div><div style="font-size:15px;font-weight:600;color:#3B6D11;margin-top:4px">Сегодня выходной</div></div></div>`;
          } else {
            shiftEl.innerHTML = `<div class="card" style="background:linear-gradient(135deg,#1a1a2e,#2d2b6b);border:none;color:#fff;margin-bottom:12px"><div style="font-size:11px;opacity:0.7;margin-bottom:4px">ТВОЯ СМЕНА СЕГОДНЯ · ${getFilialName(myShift.filial||'istikbol')}</div><div style="font-size:24px;font-weight:700">🕐 ${myShift.shift_start||''} — ${myShift.shift_end||''}</div>${myShift.note?`<div style="font-size:12px;opacity:0.7;margin-top:4px">${escapeHtml(myShift.note)}</div>`:''}</div>`;
          }
        } else { shiftEl.innerHTML = ''; }
      }

      // Attendance check-in/out
      if(myShift && !myShift.is_day_off) {
        await loadAttendanceCard(todayStr, myShift);
      } else {
        const attEl = document.getElementById('home-attendance-card');
        if(attEl) attEl.innerHTML = '';
      }

      // Моя зарплата за месяц
      await loadSalaryCard();
    }

    // Telegram link card
    const tgCard = document.getElementById('telegram-link-card');
    if(tgCard) {
      if(!currentProfile?.telegram_id) {
        tgCard.innerHTML = `<div class="card" style="background:#E8F4FD;border:1px solid #b3d9f2;margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:#1A6FA8;margin-bottom:6px">🔔 Подключи Telegram-уведомления</div>
          <div style="font-size:12px;color:#666;margin-bottom:10px">Получай уведомления о новых задачах прямо в Telegram</div>
          <ol style="font-size:12px;color:#666;margin:0 0 10px 16px;padding:0;line-height:1.6">
            <li>Открой бота <b>@SlonShishaBot</b> в Telegram</li>
            <li>Напиши ему <b>/start</b></li>
            <li>Найди бота <b>@userinfobot</b>, напиши <b>/start</b> — он покажет твой ID</li>
            <li>Введи этот ID ниже</li>
          </ol>
          <div style="display:flex;gap:8px">
            <input class="form-input" id="tg-id-input" placeholder="Например: 123456789" style="flex:1;padding:10px">
            <button onclick="saveTelegramId()" style="background:var(--gold-dark);color:#fff;border:none;border-radius:10px;padding:0 16px;font-size:13px;font-weight:600;cursor:pointer">Сохранить</button>
          </div>
        </div>`;
      } else {
        tgCard.innerHTML = '';
      }
    }

    if(role !== 'employee') {
      const { data: books } = await sb.from('bookings').select('id').eq('date', todayStr).eq('filial', currentFilial);
      document.getElementById('home-bookings').textContent = (books||[]).length;
      const revEl = document.getElementById('home-revenue');
      const revCard = revEl ? revEl.closest('.card') : null;
      if(canSeeFinance()) {
        const { data: fins } = await sb.from('finances').select('amount').eq('date', todayStr).eq('type','income').eq('filial', currentFilial);
        revEl.textContent = formatNum((fins||[]).reduce((s,f)=>s+Number(f.amount),0));
        if(revCard) revCard.style.display = '';
      } else {
        // менеджер не видит финансы — прячем карточку выручки
        if(revCard) revCard.style.display = 'none';
      }
    }
  } catch(e) { console.error(e); }
}

// ATTENDANCE
function getCurrentTimeStr() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function minutesFromStr(t) {
  if(!t) return 0;
  const [h,m] = t.split(':').map(Number);
  return h*60+m;
}

async function loadAttendanceCard(dateStr, myShift) {
  const attEl = document.getElementById('home-attendance-card');
  if(!attEl) return;
  try {
    const { data: records } = await sb.from('attendance').select('*').eq('employee_id', currentProfile.employee_id).eq('date', dateStr);
    const record = records && records.length > 0 ? records[0] : null;

    if(!record) {
      attEl.innerHTML = `<div class="card" style="margin-bottom:12px">
        <div class="card-title">Отметка на смену</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Смена начинается в ${myShift.shift_start}. Для отметки нужно снять короткое видео на месте.</div>
        <input type="file" accept="video/*" capture="user" id="checkin-video-file" style="display:none" onchange="onCheckInVideo(this)">
        <button class="btn btn-primary" onclick="startCheckIn()">🎥 Снять видео и отметить приход</button>
      </div>`;
    } else if(!record.check_out_time) {
      const lateBadge = record.is_late ? '<span class="badge badge-red" style="margin-left:6px">Опоздание</span>' : '<span class="badge badge-green" style="margin-left:6px">Вовремя</span>';
      attEl.innerHTML = `<div class="card" style="margin-bottom:12px">
        <div class="card-title">Отметка на смену</div>
        <div style="font-size:14px;color:var(--text-primary);margin-bottom:10px">Пришёл в <b>${record.check_in_time}</b>${lateBadge}</div>
        <button class="btn btn-primary" onclick="checkOut(${record.id})" style="background:#A13C3C">🚪 Отметить уход</button>
      </div>`;
    } else {
      attEl.innerHTML = `<div class="card" style="margin-bottom:12px;background:var(--surface-2)">
        <div class="card-title">Смена завершена</div>
        <div style="font-size:13px;color:var(--text-secondary)">Пришёл: <b>${record.check_in_time}</b> · Ушёл: <b>${record.check_out_time}</b></div>
      </div>`;
    }
  } catch(e) { console.error(e); attEl.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="card-title">Отметка на смену</div><div style="font-size:12px;color:#A32D2D">Не удалось загрузить. Проверьте соединение и обновите страницу.</div></div>`; }
}

// Карточка "Моя зарплата" на главном экране — за СЕГОДНЯ (за период — в личном кабинете)
async function loadSalaryCard() {
  const el = document.getElementById('home-salary-card');
  if(!el) return;
  el.innerHTML = '';
  try {
    if(!currentProfile?.employee_id) return;
    const { data: emp } = await sb.from('employees').select('salary,name').eq('id', currentProfile.employee_id).single();
    const rate = Number(emp?.salary) || 0;
    if(!rate) return;

    const todayStr = today();
    const { data: att } = await sb.from('attendance').select('penalty,check_in_time')
      .eq('employee_id', currentProfile.employee_id).eq('date', todayStr);
    const record = att && att[0];
    const worked = record?.check_in_time ? 1 : 0;
    const penalty = Number(record?.penalty) || 0;
    const earned = worked * rate;
    const total = earned - penalty;

    el.innerHTML = `<div class="card" style="margin-bottom:12px;background:linear-gradient(135deg,#2d2416,#4a3a1f);border:none;color:#f0e9db">
      <div style="font-size:11px;opacity:0.7;margin-bottom:8px;text-transform:uppercase">Моя зарплата · сегодня</div>
      <div style="font-size:28px;font-weight:700;margin-bottom:10px">${formatNum(total)} <span style="font-size:14px;opacity:0.7">сум</span></div>
      <div style="display:flex;gap:16px;font-size:12px;opacity:0.85;flex-wrap:wrap">
        <div>Ставка: <b>${formatNum(rate)}</b></div>
        ${!worked?'<div>Смена сегодня ещё не отмечена</div>':''}
        ${penalty>0?`<div style="color:#ff9b9b">Штраф: <b>−${formatNum(penalty)}</b></div>`:''}
      </div>
    </div>`;
  } catch(e) { console.error('salary card', e); }
}
function calcLatePenalty(lateMin) {
  if(lateMin <= 5) return 0;
  if(lateMin <= 15) return 30000;
  if(lateMin <= 60) return 50000;
  return 100000;
}

function startCheckIn() {
  const input = document.getElementById('checkin-video-file');
  if(!input) return;
  input.value = '';
  input.click();
}

async function onCheckInVideo(input) {
  const file = input.files && input.files[0];
  if(!file) return;
  if(!file.type || !file.type.startsWith('video')) { showToast('Нужно именно видео с камеры'); return; }
  await checkIn(file);
}

async function checkIn(videoFile) {
  try {
    // Видео обязательно — защита от отметки не на рабочем месте
    if(!videoFile) { startCheckIn(); return; }

    showToast('⏳ Загружаю видео...');
    let videoUrl = null;
    const ext = (file => { const p=(file.name||'').split('.'); return p.length>1?p.pop():'mp4'; })(videoFile);
    const path = `checkin-${currentProfile.employee_id}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('task-reports').upload(path, videoFile);
    if(upErr) { showToast('Ошибка загрузки видео: '+upErr.message); return; }
    const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
    videoUrl = urlData.publicUrl;

    const todayStr = today();
    const timeStr = getCurrentTimeStr();
    const { data: myShifts } = await sb.from('schedules').select('*').eq('date', todayStr).eq('employee_id', currentProfile.employee_id);
    const myShift = myShifts && myShifts[0];
    const lateMin = myShift ? Math.max(0, minutesFromStr(timeStr) - minutesFromStr(myShift.shift_start)) : 0;
    const penalty = myShift ? calcLatePenalty(lateMin) : 0;
    const isLate = penalty > 0;

    await sb.from('attendance').insert({
      employee_id: currentProfile.employee_id, user_id: currentUser.id,
      user_name: currentProfile?.name || currentUser?.email,
      date: todayStr, check_in_time: timeStr, is_late: isLate,
      late_minutes: lateMin, penalty: penalty,
      filial: myShift?.filial || currentFilial,
      checkin_video: videoUrl
    });

    showToast(isLate ? `⏰ Опоздание ${lateMin} мин · штраф ${formatNum(penalty)} сум` : '✅ Отмечено вовремя!');
    if(isLate) {
      await notifyAdmin(`⏰ <b>Опоздание на смену</b>\n\n👤 ${tgEscape(currentProfile?.name||'')}\n🕐 Пришёл в ${timeStr} (смена с ${myShift?.shift_start||''})\n⏱ Опоздание: ${lateMin} мин\n💸 Штраф: ${formatNum(penalty)} сум`);
    }
    loadHome();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function checkOut(recordId) {
  try {
    const timeStr = getCurrentTimeStr();
    await sb.from('attendance').update({check_out_time: timeStr}).eq('id', recordId);
    showToast('✅ Уход отмечен');
    loadHome();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

