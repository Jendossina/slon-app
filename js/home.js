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
  if(typeof renderHookahCard === 'function') renderHookahCard();
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

    // Смена и отметка прихода — одной карточкой в самом верху экрана
    if(empId) {
      const myShifts = shiftsRes.data;
      // Строк на день может быть две — смена в одном филиале и выходной в другом
      const myShift = pickDayShift(myShifts);
      const attRecord = (attRes.data && attRes.data[0]) || null;
      renderShiftAndAttendance(myShift, attRecord);
      // Позиция в зале — сразу под сменой: официант открывает приложение в
      // начале смены как раз чтобы узнать свои столы. Свой запрос, экран не держим.
      loadPositionCard(myShift);

      // Моя зарплата за сегодня
      loadSalaryCard(attRecord);
      // Аттестация по меню (официантам, по субботам) — свои запросы, не держим экран
      loadQuizCard();
    }

    // Заявки на замену и об опоздании. Снаружи блока «если есть employee_id»:
    // у управляющего аккаунт бывает не привязан к сотруднику, а решать по
    // заявкам ему всё равно нужно. Свой запрос, экран не держим.
    if(typeof loadRequestsCard === 'function') loadRequestsCard();

    // Telegram link card
    const tgCard = document.getElementById('telegram-link-card');
    if(tgCard) {
      if(!currentProfile?.telegram_id) {
        // Инструкция из четырёх шагов свёрнута: она нужна один раз в жизни, а
        // места на главной занимала больше, чем отметка прихода. Развернётся по
        // нажатию — заголовок остаётся на виду, чтобы про уведомления не забыли.
        tgCard.innerHTML = `<div class="card" style="background:#E8F4FD;border:1px solid #b3d9f2;margin-bottom:12px">
          <div onclick="toggleTelegramCard()" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <div style="font-size:13px;font-weight:600;color:#1A6FA8">${t('home.tg.title')}</div>
            <span style="margin-left:auto;font-size:12px;color:#1A6FA8;white-space:nowrap">${t('home.tg.connect')} ›</span>
          </div>
          <div id="tg-card-body" style="display:none;margin-top:10px">
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

function toggleTelegramCard() {
  const b = document.getElementById('tg-card-body');
  if(b) b.style.display = b.style.display === 'none' ? 'block' : 'none';
}

// ATTENDANCE
function getCurrentTimeStr() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

// Смена и отметка прихода рисуются вместе: раньше это были две отдельные
// карточки подряд — тёмная с часами смены и белая с кнопкой. Вместе они
// занимали пол-экрана, из-за чего кнопку сдвигало вниз. Теперь один блок:
// часы смены и кнопка под ними, всё видно без прокрутки.
// Запись о приходе приезжает вместе с остальными данными главного экрана
// (loadHome), поэтому карточка только рисует — своего запроса у неё нет.
function renderShiftAndAttendance(myShift, record) {
  const shiftEl = document.getElementById('home-shift-card');
  const attEl = document.getElementById('home-attendance-card');
  if(shiftEl) shiftEl.innerHTML = '';
  if(attEl) attEl.innerHTML = '';

  if(!myShift) return;                       // смены сегодня нет — и отмечаться нечего
  if(myShift.is_day_off) {
    if(shiftEl) shiftEl.innerHTML = `<div class="card" style="background:linear-gradient(135deg,#EAF3DE,#d4edda);border:none;margin-bottom:12px"><div style="text-align:center;padding:8px"><div style="font-size:28px">🌴</div><div style="font-size:15px;font-weight:600;color:#3B6D11;margin-top:4px">${t('home.dayOff')}</div></div></div>`;
    return;
  }
  if(!attEl) return;

  try {
    const head = `<div style="font-size:11px;opacity:0.7;margin-bottom:4px">${t('home.shiftToday')} · ${getFilialName(myShift.filial||'istikbol')}</div>
      <div style="font-size:24px;font-weight:700">🕐 ${myShift.shift_start||''} — ${myShift.shift_end||''}</div>
      ${myShift.note?`<div style="font-size:12px;opacity:0.7;margin-top:4px">${escapeHtml(myShift.note)}</div>`:''}`;

    let body;
    if(!record) {
      // Главное действие начала смены — кнопка золотая и во всю ширину карточки
      body = `<button onclick="startCheckIn()" style="width:100%;margin-top:14px;background:var(--gold);color:#1a1a1a;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer">${t('att.recordBtn')}</button>
        <div style="font-size:11px;opacity:0.65;margin-top:8px;line-height:1.4">${t('att.startsAt',{time:myShift.shift_start})}</div>`;
    } else {
      // Отметки ухода нет: смену закрывает график, а не кнопка в телефоне.
      const lateBadge = record.is_late ? `<span class="badge badge-red" style="margin-left:6px">${t('att.late')}</span>` : `<span class="badge badge-green" style="margin-left:6px">${t('att.onTime')}</span>`;
      // Видео могло не долететь (камера не открылась, связь оборвалась,
      // приложение выгрузили) — приход при этом засчитан, и человек досылает
      // видео одной кнопкой, хоть через час.
      const needVideo = !record.checkin_video ? `
        <button onclick="startResendVideo(${record.id})" style="width:100%;margin-top:10px;background:rgba(255,255,255,0.14);color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:600;cursor:pointer">${t('att.resendVideoBtn')}</button>
        <div style="font-size:12px;color:#ff9b9b;margin-top:6px;line-height:1.4">${t('att.noVideoYet')}</div>` : '';
      body = `<div style="font-size:14px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.12)">✅ ${t('att.arrivedAt')} <b>${record.check_in_time}</b>${lateBadge}</div>
        ${needVideo}`;
    }

    attEl.innerHTML = `<div class="card" style="background:linear-gradient(135deg,#1a1a2e,#2d2b6b);border:none;color:#fff;margin-bottom:12px">
      ${head}
      ${body}
      <div id="checkin-status" style="font-size:12px;opacity:0.75;margin-top:8px;text-align:center;line-height:1.4"></div>
    </div>`;
  } catch(e) { console.error(e); attEl.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="card-title">${t('att.title')}</div><div style="font-size:12px;color:#A32D2D">${t('att.loadErr')}</div></div>`; }
}

// Позиция официанта в зале: какие столы он сегодня обслуживает.
// Раздачу считает база (waiter_positions_assign) — здесь только показываем.
// Карточка рисуется всем, у кого позиция на сегодня есть; у остальных цехов её
// не будет просто потому, что раздача касается только официантов.
async function loadPositionCard(myShift) {
  const el = document.getElementById('home-position-card');
  if(!el) return;
  el.innerHTML = '';
  try {
    if(!currentProfile?.employee_id) return;
    if(myShift && myShift.is_day_off) return;          // в выходной столов нет
    const day = businessToday();
    const { data: rows } = await sb.from('waiter_position_assignments')
      .select('position_ids,employee_name,split_from').eq('date', day).eq('employee_id', currentProfile.employee_id);
    const mine = rows && rows[0];
    if(!mine || !mine.position_ids || !mine.position_ids.length) return;

    const { data: positions } = await sb.from('waiter_positions')
      .select('id,name,tables_list,sort').in('id', mine.position_ids).order('sort');
    if(!positions || !positions.length) return;

    // Кто на остальных позициях — официанту это нужно не меньше своей: понятно,
    // к кому идти с чужим столом и кого подменять.
    const { data: others } = await sb.from('waiter_position_assignments')
      .select('employee_name,position_ids').eq('date', day).eq('filial', currentFilial)
      .neq('employee_id', currentProfile.employee_id);

    const otherNames = [];
    for(const o of (others||[])) {
      const { data: op } = await sb.from('waiter_positions').select('name').in('id', o.position_ids||[]);
      otherNames.push(`${(op||[]).map(p=>escapeHtml(p.name)).join(' + ')} — ${escapeHtml(shortName(o.employee_name))}`);
    }

    // Пока вышли не все, зал общий: официант с 11:00 до прихода второго и
    // третьего обслуживает всё. Час деления — начало последней смены дня, он
    // посчитан при раздаче. Если человек сам выходит последним, оговорка ему не
    // нужна — он и есть тот, с кого зал делится.
    const splitFrom = (mine.split_from || '').slice(0,5);
    const myStart = (myShift?.shift_start || '').slice(0,5);
    const sharedNote = (splitFrom && myStart && splitFrom > myStart)
      ? `<div style="font-size:13px;margin-top:8px;padding:8px 10px;background:rgba(255,255,255,0.12);border-radius:8px;line-height:1.45">${t('pos.sharedUntil',{time:splitFrom})}</div>` : '';

    el.innerHTML = `<div class="card" style="background:linear-gradient(135deg,#16352b,#1f5e43);border:none;color:#fff;margin-bottom:12px">
      <div style="font-size:11px;opacity:0.75;margin-bottom:4px;text-transform:uppercase">${t('pos.myToday')}</div>
      <div style="font-size:22px;font-weight:700">${positions.map(p=>escapeHtml(p.name)).join(' + ')}</div>
      <div style="font-size:15px;margin-top:6px;line-height:1.5">${t('pos.tables')}: <b>${positions.map(p=>escapeHtml(p.tables_list)).join(' · ')}</b></div>
      ${sharedNote}
      ${otherNames.length?`<div style="font-size:12px;opacity:0.8;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.15);line-height:1.6">${otherNames.join('<br>')}</div>`:''}
    </div>`;
  } catch(e) { console.error('position card', e); }
}

// «Соснин Владислав Николаевич» → «Соснин Владислав»: в карточку помещается
// список из трёх человек, а отчество в зале никто не использует.
function shortName(full) {
  const parts = String(full||'').trim().split(/\s+/);
  return parts.slice(0, 2).join(' ');
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

// onReady(file) — куда девать снятый ролик: к какой записи о приходе его дописать
let checkinOnReady = null;
let checkinBusy = false;          // защита от второго нажатия, пока идёт отметка

// ПОРЯДОК: сначала приход в базу, потом камера. Раньше было наоборот, и на
// телефонах, где WebView снимать не даёт (сборки APK до 07.08.2026 — в манифесте
// не было разрешения на камеру), человек не мог отметиться ВООБЩЕ: съёмка
// уходила в системную камеру, Android выгружал приложение из памяти, отметка
// не появлялась ни разу за смену. Теперь приход засчитан до того, как что-либо
// может сломаться, а видео — отдельный шаг, который можно повторить кнопкой
// «Дослать видео»; пока его нет, отметка помечена красным и старшие уведомлены.
async function startCheckIn() {
  if(checkinBusy) return;
  checkinBusy = true;
  try {
    const ctx = await checkIn();
    if(!ctx) return;
    const { rec, myShift } = ctx;
    checkinOnReady = file => sendResendVideo(rec.id, file);
    const how = await recordCheckinVideo();
    // Камеру внутри приложения открыть не дали — сняться человек, может, ещё и
    // успеет системной, но управляющему это знать нужно сразу: такой телефон
    // теряет видео и ему нужна свежая сборка приложения.
    if(how !== 'recording') notifyCheckinNoVideo(rec, myShift);
  } finally { checkinBusy = false; }
}

// Возвращает 'recording' — снимаем внутри приложения; 'fallback' — открыли
// системную камеру; 'none' — не вышло ни так, ни так.
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
  box.style.display = 'flex';      // оверлей размечен флексом: центрирует превью
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
    const done = checkinOnReady;
    checkinOnReady = null;
    if(done) await done(file);
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
  return 'recording';
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

// Запасной путь — системная камера. Такое видео телефон сохраняет в галерею, а
// приложение уходит в фон и на слабых телефонах не возвращается. Приход к этому
// моменту уже записан, так что потерять можно только ролик.
function startCheckInFallback() {
  const input = document.getElementById('checkin-video-file');
  if(!input) return 'none';
  input.value = '';
  input.click();
  return 'fallback';
}

// Ролик из системной камеры. Приход уже записан — ролик просто дописывается к
// нему, тем же путём, что и кнопка «Дослать видео».
async function onCheckInVideo(input) {
  const file = input.files && input.files[0];
  if(!file) return;
  if(!file.type || !file.type.startsWith('video')) { showToast(t('att.needVideo')); return; }
  const done = checkinOnReady;
  checkinOnReady = null;
  if(done) await done(file);
}

// Постоянная строка состояния под кнопкой отметки. Всплывающая подсказка живёт
// 2,5 секунды, а загрузка видео с телефона идёт куда дольше — человек видел
// «загружаю видео», подсказка пропадала, и дальше было непонятно, идёт что-то
// или всё зависло.
function setCheckInStatus(text, kind) {
  const el = document.getElementById('checkin-status');
  if(!el) return;
  // Строка живёт на тёмной карточке смены — обычный текст наследует её белый,
  // «плохой» берёт светло-красный: тёмно-красный на тёмном фоне не читался
  el.style.color = kind === 'bad' ? '#ff9b9b' : '';
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

async function sendResendVideo(recordId, file) {
  const ok = await attachCheckinVideo(recordId, file);
  if(ok) { showToast(t('att.videoAttached')); }
  loadHome();   // и когда долетело, и когда нет: карточка покажет, что вышло
}

// Дослать видео к отметке, у которой его нет (кнопка на главном экране)
async function startResendVideo(recordId) {
  checkinOnReady = file => sendResendVideo(recordId, file);
  await recordCheckinVideo();
}

// Записывает приход в базу и возвращает { rec, myShift } — или null, если не
// вышло. Видео здесь больше нет: оно снимается ПОСЛЕ отметки (см. startCheckIn)
// и дописывается в ту же строку.
async function checkIn() {
  try {
    const todayStr = businessToday(); // отметка прихода записывается на кассовый день смены
    const timeStr = getCurrentTimeStr();
    const { data: myShifts } = await sb.from('schedules').select('*').eq('date', todayStr).eq('employee_id', currentProfile.employee_id);
    const myShift = pickDayShift(myShifts);

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
      setCheckInStatus(msg, 'bad'); showToast(msg);
      if(attErr.code === '23505') loadHome();   // отметка всё-таки есть — покажем её
      return null;
    }

    const lateMin = Number(rec?.late_minutes) || 0;
    const penalty = Number(rec?.penalty) || 0;
    const isLate = !!rec?.is_late;
    const timeIn = rec?.check_in_time || timeStr;

    showToast(isLate ? t('att.lateToast',{min:lateMin,pen:formatNum(penalty)}) : t('att.onTimeToast'));

    // Уведомляем вверх по иерархии: старшие по цеху + все управляющие (и владелец)
    try {
      const me = await checkinWho();
      const myLevel = (typeof JOB_TITLE_LEVEL !== 'undefined' ? (JOB_TITLE_LEVEL[me?.role]||0) : 0);
      const lateTxt = isLate ? `⏰ опоздал ${lateMin} мин · штраф ${formatNum(penalty)} сум` : 'вовремя';
      const msg = `🎥 <b>Отметка прихода</b>\n\n👤 ${tgEscape(me?.name||currentProfile?.name||'')} · ${tgEscape(me?.role||'')}\n🕐 Пришёл в ${timeIn} — ${lateTxt}\n📍 ${getFilialName(myShift?.filial||currentFilial)}`;
      if(me?.department) await notifyDeptSeniors(me.department, myLevel, msg, 'checkin'); // старшим по цеху — все отметки
      if(isLate) await notifyAdminsAll(msg, 'late');                                       // управляющим — только опоздания
    } catch(e) { console.error('notify checkin', e); }

    // Карточка сразу показывает «✅ Пришёл в HH:MM» — человек видит, что приход
    // засчитан, ДО того как открылась камера. Ждём отрисовки: дальше поверх неё
    // ляжет окно съёмки, и порядок не должен зависеть от скорости запросов.
    await loadHome();
    return { rec, myShift };
  } catch(e) {
    setCheckInStatus(t('common.error')+e.message, 'bad'); showToast(t('common.error')+e.message);
    return null;
  }
}

// Кто отмечается — нужно для адресации уведомлений старшим по цеху
async function checkinWho() {
  const { data } = await sb.from('employees').select('department,role,name').eq('id', currentProfile.employee_id).single();
  return data;
}

// Приход есть, а подтвердить его нечем: камеру в приложении открыть не дали.
// Старшим это важно знать сразу — и чтобы проверить человека, и чтобы понять,
// что у него телефон со старой сборкой, которая видео теряет.
async function notifyCheckinNoVideo(rec, myShift) {
  try {
    setCheckInStatus(t('att.cameraBlocked'), 'bad');
    const me = await checkinWho();
    const myLevel = (typeof JOB_TITLE_LEVEL !== 'undefined' ? (JOB_TITLE_LEVEL[me?.role]||0) : 0);
    const msg = `⚠️ <b>Отметка без видео</b>\n\n👤 ${tgEscape(me?.name||currentProfile?.name||'')} · ${tgEscape(me?.role||'')}\n🕐 Пришёл в ${rec?.check_in_time||''}\n📍 ${getFilialName(myShift?.filial||currentFilial)}\n\nКамера в приложении не открылась — видео к отметке не приложено. Проверьте, что на телефоне свежая версия приложения.`;
    if(me?.department) await notifyDeptSeniors(me.department, myLevel, msg, 'checkin');
    await notifyAdminsAll(msg, 'checkin');
  } catch(e) { console.error('notify no video', e); }
}

// Отметки ухода больше нет — решение владельца. Колонка check_out_time в базе
// осталась вместе со старыми записями, но приложение её не пишет и не
// показывает: смена считается по графику, а не по нажатию кнопки в конце дня.

