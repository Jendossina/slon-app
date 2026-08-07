async function loadHome() {
  const d = new Date();
  document.getElementById('home-date').textContent = fmtLocale(d, {weekday:'long', day:'numeric', month:'long'});
  document.getElementById('finance-period').textContent = fmtLocale(d, {month:'long', year:'numeric'});
  const role = currentProfile?.role;
  const name = currentProfile?.name || currentUser?.email;
  document.getElementById('home-welcome-text').textContent = t('home.welcome', {name});
  const roleLabels = { admin: t('role.admin'), manager: t('role.manager'), employee: t('role.employee'), boss: t('role.boss') };
  document.getElementById('home-role-text').textContent = roleLabels[role] || '';
  loadHomeAnnouncements();
  if(typeof renderInstallCard === 'function') renderInstallCard();
  if(typeof renderStopListCard === 'function') renderStopListCard();
  try {
    const todayStr = today();
    const shiftDay = businessToday(); // смена 12:00–03:00 = один кассовый день (ночью = вчера)
    const empId = currentProfile?.employee_id;

    // Все запросы главного экрана уходят разом. Раньше они шли цепочкой —
    // задачи, потом смена, потом отметка, потом зарплата — и на мобильном
    // интернете каждый добавлял свои полсекунды к появлению экрана.
    let tasksQuery = sb.from('tasks').select('*').eq('due_date', todayStr);
    if(role === 'employee') tasksQuery = tasksQuery.eq('assigned_to_id', currentUser.id);
    else tasksQuery = tasksQuery.eq('filial', currentFilial);

    const [tasksRes, shiftsRes, attRes, booksRes, finsRes] = await Promise.all([
      tasksQuery,
      empId ? sb.from('schedules').select('*').eq('date', shiftDay).eq('employee_id', empId) : Promise.resolve({}),
      empId ? sb.from('attendance').select('*').eq('employee_id', empId).eq('date', shiftDay) : Promise.resolve({}),
      role !== 'employee' ? sb.from('bookings').select('id').eq('date', todayStr).eq('filial', currentFilial) : Promise.resolve({}),
      (role !== 'employee' && canSeeFinance()) ? sb.from('finances').select('amount').eq('date', shiftDay).eq('type','income').eq('filial', currentFilial) : Promise.resolve({}),
    ]);

    const tasks = tasksRes.data;
    const done = (tasks||[]).filter(t=>t.status==='done').length;
    const total = (tasks||[]).length;
    const pct = total ? Math.round(done/total*100) : 0;
    document.getElementById('home-progress-bar').style.width = pct+'%';
    document.getElementById('home-tasks-text').textContent = total ? t('home.tasksDone',{done,total}) : t('home.noTasksToday');
    const myEl = document.getElementById('home-my-tasks');
    if(!tasks||tasks.length===0) { myEl.innerHTML=`<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">${t('home.noTasksToday')}</div></div>`; }
    else {
      // Рисуем задачи сразу, а точки непрочитанных комментариев дорисовываем,
      // когда придёт ответ — раньше список ждал этот запрос впустую
      myEl.innerHTML = tasks.map(t=>taskHTML(t)).join('');
      if(typeof computeTaskUnread === 'function') {
        computeTaskUnread(tasks.map(t=>t.id))
          .then(() => { myEl.innerHTML = tasks.map(t=>taskHTML(t)).join(''); })
          .catch(()=>{});
      }
    }

    // Show my shift on home screen
    if(empId) {
      const myShifts = shiftsRes.data;
      const myShift = myShifts && myShifts.length > 0 ? myShifts[0] : null;
      const shiftEl = document.getElementById('home-shift-card');
      if(shiftEl) {
        if(myShift) {
          if(myShift.is_day_off) {
            shiftEl.innerHTML = `<div class="card" style="background:linear-gradient(135deg,#EAF3DE,#d4edda);border:none;margin-bottom:12px"><div style="text-align:center;padding:8px"><div style="font-size:28px">🌴</div><div style="font-size:15px;font-weight:600;color:#3B6D11;margin-top:4px">${t('home.dayOff')}</div></div></div>`;
          } else {
            shiftEl.innerHTML = `<div class="card" style="background:linear-gradient(135deg,#1a1a2e,#2d2b6b);border:none;color:#fff;margin-bottom:12px"><div style="font-size:11px;opacity:0.7;margin-bottom:4px">${t('home.shiftToday')} · ${getFilialName(myShift.filial||'istikbol')}</div><div style="font-size:24px;font-weight:700">🕐 ${myShift.shift_start||''} — ${myShift.shift_end||''}</div>${myShift.note?`<div style="font-size:12px;opacity:0.7;margin-top:4px">${escapeHtml(myShift.note)}</div>`:''}</div>`;
          }
        } else { shiftEl.innerHTML = ''; }
      }

      // Attendance check-in/out
      const attRecord = (attRes.data && attRes.data[0]) || null;
      if(myShift && !myShift.is_day_off) {
        renderAttendanceCard(myShift, attRecord);
      } else {
        const attEl = document.getElementById('home-attendance-card');
        if(attEl) attEl.innerHTML = '';
      }

      // Моя зарплата за сегодня
      loadSalaryCard(attRecord);
      // Аттестация по меню (официантам, по субботам) — свои запросы, не держим экран
      loadQuizCard();
    }

    // Telegram link card
    const tgCard = document.getElementById('telegram-link-card');
    if(tgCard) {
      if(!currentProfile?.telegram_id) {
        tgCard.innerHTML = `<div class="card" style="background:#E8F4FD;border:1px solid #b3d9f2;margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:#1A6FA8;margin-bottom:6px">${t('home.tg.title')}</div>
          <div style="font-size:12px;color:#666;margin-bottom:10px">${t('home.tg.desc')}</div>
          <ol style="font-size:12px;color:#666;margin:0 0 10px 16px;padding:0;line-height:1.6">
            <li>Открой бота <b>@SlonShishaBot</b> в Telegram</li>
            <li>Напиши ему <b>/start</b></li>
            <li>Найди бота <b>@userinfobot</b>, напиши <b>/start</b> — он покажет твой ID</li>
            <li>Введи этот ID ниже</li>
          </ol>
          <div style="display:flex;gap:8px">
            <input class="form-input" id="tg-id-input" placeholder="Например: 123456789" style="flex:1;padding:10px">
            <button onclick="saveTelegramId()" style="background:var(--gold-dark);color:#fff;border:none;border-radius:10px;padding:0 16px;font-size:13px;font-weight:600;cursor:pointer">${t('home.tg.save')}</button>
          </div>
        </div>`;
      } else {
        tgCard.innerHTML = '';
      }
    }

    if(role !== 'employee') {
      document.getElementById('home-bookings').textContent = (booksRes.data||[]).length;
      const revEl = document.getElementById('home-revenue');
      const revCard = revEl ? revEl.closest('.card') : null;
      if(canSeeFinance()) {
        revEl.textContent = formatNum((finsRes.data||[]).reduce((s,f)=>s+Number(f.amount),0));
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

// Запись о приходе приезжает вместе с остальными данными главного экрана
// (loadHome), поэтому карточка только рисует — своего запроса у неё нет.
function renderAttendanceCard(myShift, record) {
  const attEl = document.getElementById('home-attendance-card');
  if(!attEl) return;
  try {
    if(!record) {
      attEl.innerHTML = `<div class="card" style="margin-bottom:12px">
        <div class="card-title">${t('att.title')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${t('att.startsAt',{time:myShift.shift_start})}</div>
        <input type="file" accept="video/*" capture="user" id="checkin-video-file" style="display:none" onchange="onCheckInVideo(this)">
        <button class="btn btn-primary" onclick="startCheckIn()">${t('att.recordBtn')}</button>
        <div id="checkin-status" style="font-size:12px;color:var(--text-muted);margin-top:8px;text-align:center;line-height:1.4"></div>
      </div>`;
    } else {
      // Отметки ухода нет: смену закрывает график, а не кнопка в телефоне.
      const lateBadge = record.is_late ? `<span class="badge badge-red" style="margin-left:6px">${t('att.late')}</span>` : `<span class="badge badge-green" style="margin-left:6px">${t('att.onTime')}</span>`;
      // Видео могло не долететь (связь оборвалась, приложение выгрузили) — приход
      // при этом засчитан, и человек досылает видео одной кнопкой.
      const needVideo = !record.checkin_video ? `
        <input type="file" accept="video/*" capture="user" id="checkin-resend-file" style="display:none" onchange="resendCheckinVideo(this, ${record.id})">
        <button class="btn btn-secondary" onclick="startResendVideo(${record.id})" style="margin-top:10px">${t('att.resendVideoBtn')}</button>
        <div style="font-size:12px;color:#A32D2D;margin-top:6px;text-align:center;line-height:1.4">${t('att.noVideoYet')}</div>` : '';
      attEl.innerHTML = `<div class="card" style="margin-bottom:12px">
        <div class="card-title">${t('att.title')}</div>
        <div style="font-size:14px;color:var(--text-primary)">${t('att.arrivedAt')} <b>${record.check_in_time}</b>${lateBadge}</div>
        ${needVideo}
        <div id="checkin-status" style="font-size:12px;color:var(--text-muted);margin-top:8px;text-align:center;line-height:1.4"></div>
      </div>`;
    }
  } catch(e) { console.error(e); attEl.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="card-title">${t('att.title')}</div><div style="font-size:12px;color:#A32D2D">${t('att.loadErr')}</div></div>`; }
}

// Карточка "Моя зарплата" на главном экране — за СЕГОДНЯ (за период — в личном кабинете)
// Ставка берётся из currentEmployee, отметка прихода — из уже загруженной записи:
// раньше карточка делала два своих запроса поверх тех же данных.
function loadSalaryCard(record) {
  const el = document.getElementById('home-salary-card');
  if(!el) return;
  el.innerHTML = '';
  try {
    if(!currentProfile?.employee_id) return;
    const rate = Number(currentEmployee?.salary) || 0;
    if(!rate) return;

    const worked = record?.check_in_time ? 1 : 0;
    const penalty = Number(record?.penalty) || 0;
    const earned = worked * rate;
    const total = earned - penalty;

    el.innerHTML = `<div class="card" style="margin-bottom:12px;background:linear-gradient(135deg,#2d2416,#4a3a1f);border:none;color:#f0e9db">
      <div style="font-size:11px;opacity:0.7;margin-bottom:8px;text-transform:uppercase">${t('salary.todayTitle')}</div>
      <div style="font-size:28px;font-weight:700;margin-bottom:10px">${formatNum(total)} <span style="font-size:14px;opacity:0.7">${t('common.sum')}</span></div>
      <div style="display:flex;gap:16px;font-size:12px;opacity:0.85;flex-wrap:wrap">
        <div>${t('salary.rate')}: <b>${formatNum(rate)}</b></div>
        ${!worked?`<div>${t('salary.notMarked')}</div>`:''}
        ${penalty>0?`<div style="color:#ff9b9b">${t('salary.penalty')}: <b>−${formatNum(penalty)}</b></div>`:''}
      </div>
    </div>`;
  } catch(e) { console.error('salary card', e); }
}
// Опоздание и штраф больше не считаются на клиенте — это делает триггер
// attendance_guard() в базе (миграция 2026-08-03_attendance_server_time.sql).
// Лестница штрафов живёт только там, иначе телефон снова станет источником правды.

// ===== Запись видео прихода внутри приложения =====
// Раньше открывалась системная камера: видео оставалось в галерее телефона, а
// само приложение уходило в фон — и Android спокойно выгружал его из памяти
// вместе с недогруженной отметкой. Теперь снимаем прямо в приложении: ролик
// живёт только в памяти страницы, в галерею не попадает, приложение не
// сворачивается, а размер файла мы задаём сами — секунды вместо минут загрузки.
const CHECKIN_SECONDS = 5;       // столько пишем: этого хватает подтвердить, что человек на месте
let checkinStream = null;
let checkinRecorder = null;
let checkinTimer = null;

// Умеет ли телефон снимать внутри страницы. Старый Android-webview в APK до
// пересборки — не умеет, для него остаётся системная камера.
function canRecordInApp() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

function pickRecorderMime() {
  const types = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
  for(const ty of types) { if(MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(ty)) return ty; }
  return '';
}

// onReady(file) — что делать с записанным роликом: новая отметка или досылка
let checkinOnReady = null;

async function startCheckIn() {
  checkinOnReady = file => checkIn(file);
  await recordCheckinVideo();
}

async function recordCheckinVideo() {
  if(!canRecordInApp()) return startCheckInFallback();
  try {
    setCheckInStatus(t('att.cameraStarting'));
    // Фронтальная камера, небольшое разрешение: качество «видно, что это ты и
    // что ты на месте» — больше и не нужно, зато файл уезжает за секунды.
    checkinStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch(e) {
    console.error('getUserMedia failed', e);
    setCheckInStatus('');
    return startCheckInFallback();   // не дали доступ или камеры нет — как раньше
  }
  const video = document.getElementById('checkin-preview');
  const box = document.getElementById('checkin-recorder');
  if(!video || !box) { stopCheckinStream(); return startCheckInFallback(); }
  video.srcObject = checkinStream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(()=>{});
  box.style.display = 'block';
  setCheckInStatus('');

  const chunks = [];
  const mime = pickRecorderMime();
  try {
    checkinRecorder = new MediaRecorder(checkinStream, mime ? { mimeType: mime, videoBitsPerSecond: 800000 } : undefined);
  } catch(e) {
    console.error('MediaRecorder failed', e);
    stopCheckinStream(); box.style.display = 'none';
    return startCheckInFallback();
  }
  checkinRecorder.ondataavailable = ev => { if(ev.data && ev.data.size) chunks.push(ev.data); };
  checkinRecorder.onstop = async () => {
    stopCheckinStream();
    box.style.display = 'none';
    const type = (chunks[0] && chunks[0].type) || mime || 'video/webm';
    const blob = new Blob(chunks, { type });
    if(!blob.size) { showToast(t('att.needVideo')); return; }
    // Файл живёт только в памяти страницы — на диск телефона он не попадает
    const name = 'checkin.' + (type.includes('mp4') ? 'mp4' : 'webm');
    let file;
    try { file = new File([blob], name, { type }); }
    catch(e) { file = blob; file.name = name; }
    const done = checkinOnReady || (f => checkIn(f));
    checkinOnReady = null;
    await done(file);
  };
  checkinRecorder.start();

  // Обратный отсчёт: человеку видно, сколько осталось
  let left = CHECKIN_SECONDS;
  const counter = document.getElementById('checkin-countdown');
  if(counter) counter.textContent = t('att.recording', { n: left });
  checkinTimer = setInterval(() => {
    left -= 1;
    if(counter) counter.textContent = t('att.recording', { n: Math.max(0, left) });
    if(left <= 0) stopCheckinRecording();
  }, 1000);
}

function stopCheckinRecording() {
  if(checkinTimer) { clearInterval(checkinTimer); checkinTimer = null; }
  if(checkinRecorder && checkinRecorder.state !== 'inactive') checkinRecorder.stop();
  checkinRecorder = null;
}

function stopCheckinStream() {
  if(checkinTimer) { clearInterval(checkinTimer); checkinTimer = null; }
  if(checkinStream) { checkinStream.getTracks().forEach(tr => tr.stop()); checkinStream = null; }
}

// Отмена записи (кнопка «Отмена») — ничего не отправляем
function cancelCheckinRecording() {
  if(checkinRecorder) { checkinRecorder.onstop = null; if(checkinRecorder.state !== 'inactive') checkinRecorder.stop(); checkinRecorder = null; }
  stopCheckinStream();
  const box = document.getElementById('checkin-recorder');
  if(box) box.style.display = 'none';
  setCheckInStatus('');
}

// Запасной путь — системная камера. Такое видео телефон сохраняет в галерею,
// но лучше так, чем человек не сможет отметиться вовсе.
function startCheckInFallback() {
  const input = document.getElementById('checkin-video-file');
  if(!input) return;
  input.value = '';
  input.click();
}

async function onCheckInVideo(input) {
  const file = input.files && input.files[0];
  if(!file) return;
  if(!file.type || !file.type.startsWith('video')) { showToast(t('att.needVideo')); return; }
  await checkIn(file);
}

// Постоянная строка состояния под кнопкой отметки. Всплывающая подсказка живёт
// 2,5 секунды, а загрузка видео с телефона идёт куда дольше — человек видел
// «загружаю видео», подсказка пропадала, и дальше было непонятно, идёт что-то
// или всё зависло.
function setCheckInStatus(text, kind) {
  const el = document.getElementById('checkin-status');
  if(!el) return;
  el.style.color = kind === 'bad' ? '#A32D2D' : 'var(--text-muted)';
  el.textContent = text || '';
}

// Догружаем видео к уже записанной отметке. Возвращает true, если долетело.
// Триггер в базе разрешает дописать checkin_video, только пока он пустой
// (миграция 2026-08-06_attach_checkin_video.sql).
async function attachCheckinVideo(recordId, videoFile) {
  try {
    setCheckInStatus(t('att.uploadingVideo'));
    const ext = (f => { const p=(f.name||'').split('.'); return p.length>1?p.pop():'mp4'; })(videoFile);
    const path = `checkin-${currentProfile.employee_id}-${Date.now()}.${ext}`;
    // Загрузка на слабой связи тянется минутами, а может и молча оборваться:
    // ждём не дольше трёх минут и в любом случае говорим, чем кончилось.
    const upRes = await Promise.race([
      sb.storage.from('task-reports').upload(path, videoFile).catch(e => ({ error: e })),
      new Promise(r => setTimeout(() => r({ timedOut: true }), 180000)),
    ]);
    if(upRes.timedOut || upRes.error) {
      setCheckInStatus(t('att.videoLater'), 'bad');
      showToast(t('att.videoLater'));
      return false;
    }
    const { data: urlData } = sb.storage.from('task-reports').getPublicUrl(path);
    const { error } = await sb.from('attendance').update({ checkin_video: urlData.publicUrl }).eq('id', recordId);
    if(error) { setCheckInStatus(t('att.videoLater'), 'bad'); return false; }
    setCheckInStatus('');
    return true;
  } catch(e) {
    setCheckInStatus(t('att.videoLater'), 'bad');
    return false;
  }
}

// Дослать видео к отметке, у которой его нет (кнопка на главном экране)
async function resendCheckinVideo(input, recordId) {
  const file = input.files && input.files[0];
  if(!file) return;
  if(!file.type || !file.type.startsWith('video')) { showToast(t('att.needVideo')); return; }
  await sendResendVideo(recordId, file);
}

async function sendResendVideo(recordId, file) {
  const ok = await attachCheckinVideo(recordId, file);
  if(ok) { showToast(t('att.videoAttached')); loadHome(); }
}

async function startResendVideo(recordId) {
  if(canRecordInApp()) {
    checkinOnReady = file => sendResendVideo(recordId, file);
    return recordCheckinVideo();
  }
  const input = document.getElementById('checkin-resend-file');
  if(!input) return;
  input.value = '';
  input.click();
}

async function checkIn(videoFile) {
  try {
    // Видео обязательно — защита от отметки не на рабочем месте
    if(!videoFile) { startCheckIn(); return; }

    const todayStr = businessToday(); // отметка прихода записывается на кассовый день смены
    const timeStr = getCurrentTimeStr();
    const { data: myShifts } = await sb.from('schedules').select('*').eq('date', todayStr).eq('employee_id', currentProfile.employee_id);
    const myShift = myShifts && myShifts[0];

    // ОТМЕТКА ПИШЕТСЯ ПЕРВОЙ, видео уезжает следом. Раньше было наоборот, и на
    // недорогих андроидах система успевала выгрузить приложение из памяти, пока
    // с камеры уходили десятки мегабайт: запрос обрывался, отметки не было
    // вовсе. Теперь приход засчитан за секунду, а видео догружается и
    // дописывается в ту же строку; не долетело — сотрудник дошлёт с главной.
    setCheckInStatus(t('att.savingMark'));
    // Время прихода, опоздание и штраф проставляет триггер в базе по часам
    // сервера: часы телефона можно перевести назад, и раньше это давало отметку
    // «вовремя». Клиент их больше не считает и не шлёт — только читает результат.
    const { data: rec, error: attErr } = await sb.from('attendance').insert({
      employee_id: currentProfile.employee_id, user_id: currentUser.id,
      user_name: currentProfile?.name || currentUser?.email,
      date: todayStr, check_in_time: timeStr,
      filial: myShift?.filial || currentFilial
    }).select().single();
    if(attErr) {
      const msg = attErr.code === '23505' ? t('att.already') : t('common.error') + attErr.message;
      setCheckInStatus(msg, 'bad'); showToast(msg); return;
    }

    const lateMin = Number(rec?.late_minutes) || 0;
    const penalty = Number(rec?.penalty) || 0;
    const isLate = !!rec?.is_late;
    const timeIn = rec?.check_in_time || timeStr;

    showToast(isLate ? t('att.lateToast',{min:lateMin,pen:formatNum(penalty)}) : t('att.onTimeToast'));

    // Приход уже засчитан — теперь видео. Экран не держим: если загрузка
    // сорвётся, на главной появится кнопка «дослать видео».
    attachCheckinVideo(rec.id, videoFile).then(ok => { if(ok) loadHome(); });

    // Уведомляем вверх по иерархии: старшие по цеху + все управляющие (и владелец)
    try {
      const { data: me } = await sb.from('employees').select('department,role,name').eq('id', currentProfile.employee_id).single();
      const myLevel = (typeof JOB_TITLE_LEVEL !== 'undefined' ? (JOB_TITLE_LEVEL[me?.role]||0) : 0);
      const lateTxt = isLate ? `⏰ опоздал ${lateMin} мин · штраф ${formatNum(penalty)} сум` : 'вовремя';
      const msg = `🎥 <b>Отметка прихода</b>\n\n👤 ${tgEscape(me?.name||currentProfile?.name||'')} · ${tgEscape(me?.role||'')}\n🕐 Пришёл в ${timeIn} — ${lateTxt}\n📍 ${getFilialName(myShift?.filial||currentFilial)}`;
      if(me?.department) await notifyDeptSeniors(me.department, myLevel, msg, 'checkin'); // старшим по цеху — все отметки
      if(isLate) await notifyAdminsAll(msg, 'late');                                       // управляющим — только опоздания
    } catch(e) { console.error('notify checkin', e); }
    loadHome();
  } catch(e) { setCheckInStatus(t('common.error')+e.message, 'bad'); showToast(t('common.error')+e.message); }
}

// Отметки ухода больше нет — решение владельца. Колонка check_out_time в базе
// осталась вместе со старыми записями, но приложение её не пишет и не
// показывает: смена считается по графику, а не по нажатию кнопки в конце дня.

