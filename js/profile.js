// PERSONAL CABINET
let profileTab = 'overview';

async function loadProfile2() {
  const content = document.getElementById('profile-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  const name = currentProfile?.name || currentUser?.email;
  document.getElementById('profile-name-label').textContent = name;
  const role = currentProfile?.role;
  const roleLabels = { admin: '👑 Управляющий', manager: '📋 Менеджер', employee: '👤 Сотрудник', boss: '🦉 Владелец (наблюдатель)' };
  const isLeader = canEditData() || isBoss();

  try {
    // Шапка (всегда видна)
    const header = `<div class="welcome" style="text-align:center">
      <div class="avatar" style="width:60px;height:60px;font-size:20px;margin:0 auto 10px;background:var(--gold-light);color:#1a1611">${getInitials(name)}</div>
      <h3>${name}</h3>
      <p>${roleLabels[role]||''}</p>
    </div>`;

    // Собираем содержимое каждой вкладки
    const tabsContent = { overview:'', achievements:'', history:'', team:'' };

    if(currentProfile?.employee_id) {
      const empId = currentProfile.employee_id;
      const now = new Date();
      const firstStr = ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
      const lastStr = ymdLocal(new Date(now.getFullYear(), now.getMonth()+1, 0));
      const todayStr = ymdLocal(now);
      const twoWeeksAgoStr = (() => { const d = new Date(); d.setDate(d.getDate()-14); return ymdLocal(d); })();

      // Все независимые запросы — параллельно (раньше шли по цепочке и тормозили экран)
      const [empR, schedFutR, upcomingR, activeTasksR, myTasksR, monthAttR, shiftsR] = await Promise.all([
        sb.from('employees').select('*').eq('id', empId).single(),
        sb.from('schedules').select('date,is_day_off').eq('employee_id', empId).gt('date',todayStr).lte('date',lastStr),
        sb.from('schedules').select('*').eq('employee_id', empId).gte('date',todayStr).order('date').limit(5),
        sb.from('tasks').select('*').eq('assigned_to_id', currentUser.id).eq('status','pending').order('due_date').limit(6),
        sb.from('tasks').select('status').eq('assigned_to_id', currentUser.id),
        sb.from('attendance').select('*').eq('employee_id', empId).gte('date',firstStr).lte('date',lastStr).order('date',{ascending:false}),
        sb.from('schedules').select('*').eq('employee_id', empId).gte('date', twoWeeksAgoStr).lte('date',todayStr).order('date',{ascending:false}),
      ]);
      const emp = empR.data;
      const monthAtt = monthAttR.data || [];

      // --- ОБЗОР: зарплата ---
      const rate = Number(emp?.salary)||0;
      if(rate > 0) {
        const worked = monthAtt.filter(a=>a.check_in_time).length;
        const penalties = monthAtt.reduce((s,a)=>s+(Number(a.penalty)||0),0);
        const planned = (schedFutR.data||[]).filter(s=>!s.is_day_off).length;
        const earned = worked*rate - penalties;
        const forecast = (worked+planned)*rate - penalties;
        tabsContent.overview += `<div class="card" style="background:linear-gradient(135deg,#2d2416,#4a3a1f);border:none;color:#f0e9db">
          <div style="font-size:11px;opacity:0.7;text-transform:uppercase;margin-bottom:8px">Зарплата · ${now.toLocaleDateString('ru-RU',{month:'long'})}</div>
          <div style="display:flex;justify-content:space-between;align-items:end">
            <div><div style="font-size:12px;opacity:0.7">Заработано сейчас</div><div style="font-size:24px;font-weight:700">${formatNum(earned)} <span style="font-size:13px;opacity:0.7">сум</span></div></div>
            <div style="text-align:right"><div style="font-size:12px;opacity:0.7">Прогноз к концу месяца</div><div style="font-size:18px;font-weight:700;color:#a3e07a">~${formatNum(forecast)}</div></div>
          </div>
          <div style="font-size:11px;opacity:0.65;margin-top:8px">Отработано ${worked} смен · впереди по графику ${planned}${penalties>0?' · удержано '+formatNum(penalties):''}</div>
        </div>`;
      }

      // --- ОБЗОР: ближайшие смены ---
      const upcoming = upcomingR.data;
      if(upcoming && upcoming.length) {
        tabsContent.overview += '<div class="section-label">Ближайшие смены</div><div class="card">';
        tabsContent.overview += upcoming.map(s=>`<div class="list-item"><div class="item-info"><div class="item-name">${new Date(s.date).toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'})}${s.date===todayStr?' · <span style="color:var(--gold-dark)">сегодня</span>':''}</div><div class="item-sub">${s.is_day_off?'🌴 Выходной':'🕐 '+s.shift_start+'–'+s.shift_end+' · '+getFilialName(s.filial||'istikbol')}</div></div></div>`).join('');
        tabsContent.overview += '</div>';
      }

      // --- ОБЗОР: активные задачи ---
      const activeTasks = activeTasksR.data;
      if(activeTasks && activeTasks.length) {
        tabsContent.overview += `<div class="section-label">Мои активные задачи (${activeTasks.length})</div><div class="card">`;
        tabsContent.overview += activeTasks.map(t=>`<div class="list-item"><div class="item-info"><div class="item-name">${escapeHtml(t.title)}</div><div class="item-sub">${t.due_date?'до '+new Date(t.due_date).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}):''} · 📍 ${getFilialName(t.filial||'istikbol')}</div></div></div>`).join('');
        tabsContent.overview += '</div>';
      }
      if(!tabsContent.overview) tabsContent.overview = '<div class="card"><div class="empty"><div class="empty-text">Пока нет данных для обзора</div></div></div>';

      // --- ДОСТИЖЕНИЯ: статистика задач + бейджи ---
      const myTasks = myTasksR.data;
      const total = myTasks?.length || 0;
      const done = myTasks?.filter(t=>t.status==='done').length || 0;
      const pct = total ? Math.round(done/total*100) : 0;
      tabsContent.achievements += `<div class="section-label">Статистика задач</div><div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:13px;color:var(--text-muted)">${done} из ${total} выполнено</span><span style="font-size:18px;font-weight:700;color:var(--gold-dark)">${pct}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`;
      tabsContent.achievements += await loadBadgesBlock(currentProfile.employee_id);

      // --- ИСТОРИЯ: удержания + смены (monthAtt получен выше, параллельно) ---
      const lateItems = monthAtt.filter(a=>a.is_late && Number(a.penalty)>0);
      if(lateItems.length) {
        const totPen = lateItems.reduce((s,a)=>s+Number(a.penalty),0);
        tabsContent.history += `<div class="section-label">Удержания за месяц</div><div class="card">
          <div style="font-size:13px;color:#A13C3C;margin-bottom:8px;font-weight:600">Всего: −${formatNum(totPen)} сум</div>
          ${lateItems.map(a=>`<div class="list-item"><div class="item-info"><div class="item-name">${new Date(a.date).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</div><div class="item-sub">Опоздание на ${a.late_minutes||'?'} мин</div></div><span class="badge badge-red">−${formatNum(a.penalty)}</span></div>`).join('')}
        </div>`;
      }
      const shifts = shiftsR.data;
      tabsContent.history += '<div class="section-label">История смен (14 дней)</div><div class="card">';
      if(!shifts || shifts.length===0) tabsContent.history += '<div class="empty"><div class="empty-icon">📅</div><div class="empty-text">Смен пока нет</div></div>';
      else tabsContent.history += shifts.map(s => `<div class="list-item"><div class="item-info"><div class="item-name">${new Date(s.date).toLocaleDateString('ru-RU',{day:'numeric',month:'short',weekday:'short'})}</div><div class="item-sub">${s.is_day_off?'🌴 Выходной':'🕐 '+s.shift_start+'–'+s.shift_end+' · '+getFilialName(s.filial||'istikbol')}</div></div></div>`).join('');
      tabsContent.history += '</div>';
    } else {
      tabsContent.overview = '<div class="card"><div class="empty"><div class="empty-text">Профиль сотрудника не привязан</div></div></div>';
    }

    // --- КОМАНДА (руководители) ---
    if(isLeader) {
      tabsContent.team += await leaderAttentionBlock();
      tabsContent.team += await leaderTeamTodayBlock();
      if(!tabsContent.team.trim()) tabsContent.team = '<div class="card"><div class="empty"><div class="empty-text">Нет данных по команде</div></div></div>';
    }

    // Смена пароля (внизу всегда)
    const bioOn = (typeof bioIsEnabled === 'function') && bioIsEnabled();
    const bioBtn = bioOn
      ? `<button onclick="disableBiometric()" style="width:100%;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:14px;cursor:pointer;margin-top:8px">🔓 Отключить вход по биометрии</button>
         <div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:center">Вход по Face ID / отпечатку включён на этом устройстве</div>`
      : `<button onclick="enableBiometric()" style="width:100%;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:14px;cursor:pointer;margin-top:8px">👆 Включить вход по Face ID / отпечатку</button>
         <div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:center">Открывать приложение по биометрии, без пароля (на этом устройстве)</div>`;
    const passwordBlock = `<div class="section-label">Безопасность</div>
      <div class="card"><button onclick="openMyPasswordModal()" style="width:100%;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:14px;cursor:pointer">🔑 Сменить мой пароль</button>${bioBtn}</div>`;

    // Настройки уведомлений — только управляющему и владельцу (остальным по умолчанию всё включено)
    let notifBlock = '';
    if(isAdmin() || isBoss()) {
      const prefs = currentProfile?.notify_prefs || {};
      notifBlock = `<div class="section-label">Уведомления в Telegram</div>
        <div class="card">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Что присылать вам в Telegram. Настройка только для вашего аккаунта.</div>
          ${NOTIF_TYPES.map(t=>`
            <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--border)">
              <span><span style="font-size:14px;color:var(--text-primary)">${t.label}</span><br><span style="font-size:11px;color:var(--text-muted)">${t.desc}</span></span>
              <input type="checkbox" class="notif-pref" data-key="${t.key}" ${prefs[t.key]!==false?'checked':''} onchange="saveNotifPrefs()" style="width:20px;height:20px;flex:0 0 auto">
            </label>`).join('')}
        </div>`;
    }

    // Определяем доступные вкладки
    const tabs = [{id:'overview',label:'Обзор'},{id:'achievements',label:'🏅 Достижения'},{id:'history',label:'История'}];
    if(isLeader) tabs.push({id:'team',label:'👥 Команда'});
    // если текущая вкладка недоступна — сброс на обзор
    if(!tabs.find(t=>t.id===profileTab)) profileTab = 'overview';

    // Сохраняем контент вкладок в глобале для переключения без перезагрузки
    window._profileTabs = tabsContent;
    window._profilePasswordBlock = passwordBlock;

    const tabsBar = `<div class="hscroll" style="display:flex;gap:6px;overflow-x:auto;margin-bottom:14px">${tabs.map(t=>`<button onclick="switchProfileTab('${t.id}')" style="flex:0 0 auto;padding:8px 14px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;background:${t.id===profileTab?'var(--gold-dark)':'var(--surface-2)'};color:${t.id===profileTab?'#fff':'var(--text-primary)'}">${t.label}</button>`).join('')}</div>`;

    content.innerHTML = header + tabsBar + `<div id="profile-tab-body">${tabsContent[profileTab]}</div>` + notifBlock + passwordBlock;
  } catch(e) { console.error(e); content.innerHTML = '<div class="loading">Ошибка загрузки</div>'; }
}

// Типы уведомлений для настроек (управляющий/владелец)
const NOTIF_TYPES = [
  { key:'late',           label:'⏰ Опоздания',             desc:'Кто-то опоздал на смену' },
  { key:'checklist_done', label:'☑️ Выполнение чек-листов', desc:'Чек-лист смены выполнен' },
  { key:'review_neg',     label:'⭐ Плохие отзывы',          desc:'Негативный отзыв гостя' },
  { key:'checkin',        label:'🎥 Отметки прихода',        desc:'Приход подчинённых по цеху' },
  { key:'task_new',       label:'🔔 Новые задачи',           desc:'Вам назначили задачу' },
  { key:'task_comment',   label:'💬 Комментарии к задачам',  desc:'Новое сообщение в обсуждении' },
  { key:'schedule',       label:'📅 Изменения графика',      desc:'Ваша смена изменилась' },
];

async function saveNotifPrefs() {
  const prefs = {};
  document.querySelectorAll('.notif-pref').forEach(cb => { prefs[cb.getAttribute('data-key')] = cb.checked; });
  try {
    const { error } = await sb.rpc('update_own_notify_prefs', { new_prefs: prefs });
    if(error) return showToast('Ошибка: ' + error.message);
    if(currentProfile) currentProfile.notify_prefs = prefs;
    showToast('✅ Настройки уведомлений сохранены');
  } catch(e) { showToast('Ошибка: ' + e.message); }
}

function switchProfileTab(tab) {
  profileTab = tab;
  const body = document.getElementById('profile-tab-body');
  if(body && window._profileTabs) body.innerHTML = window._profileTabs[tab] || '';
  // обновить подсветку кнопок
  document.querySelectorAll('#profile-content button[onclick^="switchProfileTab"]').forEach(b=>{
    const t = b.getAttribute('onclick').match(/'([^']+)'/)[1];
    b.style.background = t===tab ? 'var(--gold-dark)' : 'var(--surface-2)';
    b.style.color = t===tab ? '#fff' : 'var(--text-primary)';
  });
}

// Блок "Что требует внимания" для руководителей
async function leaderAttentionBlock() {
  try {
    const todayStr = ymdLocal();
    // просроченные задачи (срок < сегодня и не выполнены)
    const { data: overdue } = await sb.from('tasks').select('id').eq('filial',currentFilial).eq('status','pending').lt('due_date',todayStr);
    // опоздания сегодня
    const { data: latestoday } = await sb.from('attendance').select('id').eq('filial',currentFilial).eq('date',todayStr).eq('is_late',true);
    // плохие отзывы сегодня
    const { data: badrev } = await sb.from('reviews').select('id').eq('filial',currentFilial).eq('sentiment','negative').gte('created_at',todayStr+'T00:00:00');
    const nOverdue=(overdue||[]).length, nLate=(latestoday||[]).length, nBad=(badrev||[]).length;
    if(nOverdue===0 && nLate===0 && nBad===0) {
      return `<div class="card" style="background:linear-gradient(135deg,#1a2e1a,#2d4a2d);border:none;color:#e9f0e9"><div style="font-size:14px">✅ Всё под контролем · ${getFilialName(currentFilial)}</div><div style="font-size:12px;opacity:0.7;margin-top:2px">Нет просроченных задач, опозданий и жалоб сегодня</div></div>`;
    }
    const items = [];
    if(nOverdue) items.push(`<div style="display:flex;justify-content:space-between;padding:6px 0"><span>⏰ Просроченные задачи</span><b style="color:#ff9b9b">${nOverdue}</b></div>`);
    if(nLate) items.push(`<div style="display:flex;justify-content:space-between;padding:6px 0"><span>🚶 Опоздания сегодня</span><b style="color:#ff9b9b">${nLate}</b></div>`);
    if(nBad) items.push(`<div style="display:flex;justify-content:space-between;padding:6px 0"><span>👎 Плохие отзывы сегодня</span><b style="color:#ff9b9b">${nBad}</b></div>`);
    return `<div class="card" style="background:linear-gradient(135deg,#3a2a1a,#5a3d2d);border:none;color:#f0e6db">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;text-transform:uppercase">⚠️ Требует внимания · ${getFilialName(currentFilial)}</div>
      ${items.join('')}
    </div>`;
  } catch(e) { return ''; }
}

// Блок "Моя команда сегодня" для руководителей
async function leaderTeamTodayBlock() {
  try {
    const todayStr = businessToday(); // «команда сегодня» = кассовый день (смена 12:00–03:00)
    // кто в графике сегодня на этом филиале
    const { data: sched } = await sb.from('schedules').select('*').eq('filial',currentFilial).eq('date',todayStr).eq('is_day_off',false);
    if(!sched || sched.length===0) return '';
    // кто отметился
    const { data: att } = await sb.from('attendance').select('*').eq('filial',currentFilial).eq('date',todayStr);
    const attMap = {}; (att||[]).forEach(a=>{ attMap[a.employee_id]=a; });
    const rows = sched.map(s=>{
      const a = attMap[s.employee_id];
      let status;
      if(!a) status = '<span style="color:var(--text-muted)">не отметился</span>';
      else if(a.is_late) status = `<span style="color:#A13C3C">опоздал ${a.late_minutes||''}м</span>`;
      else status = '<span style="color:#3B6D11">на смене</span>';
      const vidBtn = (a && a.checkin_video) ? ` <button onclick="viewReport('${escJsAttr(a.checkin_video)}','video')" style="background:#f0e6d2;color:#8a6a2f;border:none;border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer">🎥</button>` : '';
      return `<div class="list-item"><div class="item-info"><div class="item-name">${escapeHtml(s.employee_name||'')}</div><div class="item-sub">🕐 ${s.shift_start}–${s.shift_end}</div></div><div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:4px">${status}${vidBtn}</div></div>`;
    }).join('');
    return `<div class="section-label">Команда сегодня · ${getFilialName(currentFilial)}</div><div class="card">${rows}</div>`;
  } catch(e) { return ''; }
}

// Бейджи-достижения (вычисляются из существующих данных, без отдельных таблиц)
async function loadBadgesBlock(employeeId) {
  try {
    const now = new Date();
    const monthAgo = new Date(now); monthAgo.setDate(now.getDate()-30);
    const monthAgoStr = ymdLocal(monthAgo);
    const todayStr = ymdLocal(now);

    // Явка (30 дней), задачи и бой посуды — параллельно
    const empName = currentProfile?.name;
    const [attR, myTasksR, breaksR, empR] = await Promise.all([
      sb.from('attendance').select('date,is_late').eq('employee_id', employeeId).gte('date', monthAgoStr).order('date',{ascending:false}),
      sb.from('tasks').select('status').eq('assigned_to_id', currentUser.id),
      empName
        ? sb.from('dishware_moves').select('id').eq('move_type','break').eq('user_name', empName).gte('created_at', monthAgoStr+'T00:00:00')
        : Promise.resolve({ data: [] }),
      sb.from('employees').select('role,salary').eq('id', employeeId).single(),
    ]);
    const attList = attR.data || [];
    const lateInMonth = attList.filter(a=>a.is_late).length;
    const shiftsInMonth = attList.length;
    // серия последних смен без опозданий
    let streak = 0;
    for(const a of attList) { if(a.is_late) break; streak++; }

    const doneTasks = (myTasksR.data||[]).filter(t=>t.status==='done').length;
    const breakCount = (breaksR.data||[]).length;

    // Определяем бейджи: earned (получен) + progress (0..1)
    const badges = [
      { icon:'🔥', name:'Идеальная неделя', desc:'7 смен подряд без опозданий', earned: streak>=7, prog: Math.min(1, streak/7), progText: `${Math.min(streak,7)}/7 смен` },
      { icon:'🎯', name:'Пунктуальность', desc:'20 смен подряд без опозданий', earned: streak>=20, prog: Math.min(1, streak/20), progText: `${Math.min(streak,20)}/20 смен` },
      { icon:'💎', name:'Железная дисциплина', desc:'Месяц без опозданий', earned: shiftsInMonth>=1 && lateInMonth===0, prog: lateInMonth===0?1:0, progText: lateInMonth===0?'чисто!':`${lateInMonth} опозд.` },
      { icon:'✅', name:'Исполнитель', desc:'50 выполненных задач', earned: doneTasks>=50, prog: Math.min(1, doneTasks/50), progText: `${Math.min(doneTasks,50)}/50` },
      { icon:'🏆', name:'Мастер задач', desc:'100 выполненных задач', earned: doneTasks>=100, prog: Math.min(1, doneTasks/100), progText: `${Math.min(doneTasks,100)}/100` },
      { icon:'🍽️', name:'Аккуратные руки', desc:'Месяц без боя посуды', earned: breakCount===0, prog: breakCount===0?1:0, progText: breakCount===0?'ни одной!':`${breakCount} боя` },
    ];

    // Аттестация: стимул для тех, кто ещё на базовой ставке (официанты/бармены/кальянщики).
    // Статус выводим из ставки: 250 000+ = сдал. Уволенных/сеньоров это не касается.
    const emp = empR?.data;
    if(emp && ATTESTATION_ROLES.includes(emp.role)) {
      const passed = Number(emp.salary||0) >= ATTESTATION_PASSED;
      const isWaiter = emp.role === 'Официант';
      badges.push({
        icon: '🎓',
        name: isWaiter ? 'Меню сдано' : 'Аттестация сдана',
        desc: isWaiter ? 'Сдай меню — ставка станет 250 000' : 'Сдай аттестации — ставка станет 250 000',
        earned: passed,
        prog: passed ? 1 : 0,
        progText: passed ? 'ставка 250 000 ✓' : 'сейчас 200 000 → будет 250 000',
      });
    }

    const earned = badges.filter(b=>b.earned);
    const inProgress = badges.filter(b=>!b.earned);

    let html = `<div class="section-label">Достижения (${earned.length}/${badges.length})</div><div class="card">`;
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    // Сначала полученные (яркие), потом в процессе (тусклые)
    html += earned.map(b=>`
      <div style="background:linear-gradient(135deg,#3a2f16,#5a4a1f);border-radius:12px;padding:12px;text-align:center;color:#f0e6d2">
        <div style="font-size:28px">${b.icon}</div>
        <div style="font-size:13px;font-weight:700;margin-top:4px">${b.name}</div>
        <div style="font-size:10px;opacity:0.75;margin-top:2px">${b.desc}</div>
        <div style="font-size:10px;color:#a3e07a;margin-top:4px;font-weight:600">✓ получено</div>
      </div>`).join('');
    html += inProgress.map(b=>`
      <div style="background:var(--surface-2);border-radius:12px;padding:12px;text-align:center;opacity:0.75">
        <div style="font-size:28px;filter:grayscale(1)">${b.icon}</div>
        <div style="font-size:13px;font-weight:700;margin-top:4px;color:var(--text-primary)">${b.name}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${b.desc}</div>
        <div style="background:var(--border);border-radius:4px;height:5px;margin-top:6px;overflow:hidden"><div style="width:${Math.round(b.prog*100)}%;height:100%;background:var(--gold);border-radius:4px"></div></div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${b.progText}</div>
      </div>`).join('');
    html += '</div></div>';
    return html;
  } catch(e) { return ''; }
}

// Смена своего пароля
function openMyPasswordModal() {
  document.getElementById('my-pass-new').value = '';
  document.getElementById('my-pass-new2').value = '';
  openModal('modal-my-password');
}
async function saveMyPassword() {
  const p1 = document.getElementById('my-pass-new').value;
  const p2 = document.getElementById('my-pass-new2').value;
  if(!p1 || p1.length<6) return showToast('Пароль минимум 6 символов');
  if(p1!==p2) return showToast('Пароли не совпадают');
  try {
    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error) return showToast('Ошибка: '+error.message);
    closeModal('modal-my-password');
    showToast('✅ Пароль изменён');
  } catch(e) { showToast('Ошибка: '+e.message); }
}

