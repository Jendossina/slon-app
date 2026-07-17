// SCHEDULE - WEEKLY GRID VIEW
const DEPARTMENTS = ['Официанты','Бармены','Кальянные мастера','Повара','Техперсонал','Менеджеры'];
let currentDept = 'Официанты';
let scheduleWeekStart = getMonday(new Date());
let scheduleAutoJumped = false; // чтобы автопереход в свой отдел не откатывал ручной выбор вкладки

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function fmtDate(d) { return d.toISOString().split('T')[0]; }

async function loadSchedule() {
  const role = currentProfile?.role;
  const fabBtn = document.getElementById('fab-schedule-btn');
  const fabWeekBtn = document.getElementById('fab-week-btn');
  const canEdit = canEditData();
  if(fabBtn) fabBtn.style.display = canEdit ? 'block' : 'none';
  if(fabWeekBtn) fabWeekBtn.style.display = canEdit ? 'block' : 'none';

  // If employee, jump to their department automatically — но только один раз,
  // иначе это откатывает ручной выбор другой вкладки при каждой перезагрузке
  if(role === 'employee' && currentProfile?.employee_id && !scheduleAutoJumped) {
    scheduleAutoJumped = true;
    const { data: emp } = await sb.from('employees').select('department').eq('id', currentProfile.employee_id).single();
    if(emp?.department) currentDept = emp.department;
  }

  // Department tabs
  const nav = document.getElementById('schedule-dept-nav');
  nav.innerHTML = DEPARTMENTS.map(d => {
    const isActive = d === currentDept;
    return `<button onclick="selectDept('${d}')" style="background:${isActive?'var(--gold-dark)':'rgba(255,255,255,0.15)'};color:#fff;border:none;border-radius:20px;padding:6px 14px;font-size:12px;white-space:nowrap;cursor:pointer">${d}</button>`;
  }).join('');

  const weekEnd = new Date(scheduleWeekStart);
  weekEnd.setDate(weekEnd.getDate()+6);
  document.getElementById('schedule-week').textContent = scheduleWeekStart.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}) + ' — ' + weekEnd.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});

  await loadScheduleGrid();
}

function selectDept(dept) {
  currentDept = dept;
  loadSchedule();
}

function shiftWeek(dir) {
  scheduleWeekStart.setDate(scheduleWeekStart.getDate() + dir*7);
  loadSchedule();
}

async function loadScheduleGrid() {
  const content = document.getElementById('schedule-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    // Даты недели (нужны до запроса расписаний)
    const weekDates = [];
    for(let i=0; i<7; i++) {
      const d = new Date(scheduleWeekStart);
      d.setDate(d.getDate()+i);
      weekDates.push(d);
    }
    const dateStrs = weekDates.map(fmtDate);

    // Сотрудники отдела и расписания недели — параллельно (раньше шли по цепочке).
    // employees_view: только нужные поля, без '*' — иначе представление считает зарплату
    // подзапросом на каждую строку, что и подтормаживало.
    // Расписания берём по филиалу+неделе; лишние строки чужих отделов просто не отрисуются.
    const [empsR, schedR] = await Promise.all([
      sb.from('employees_view').select('id,name,filials').eq('department', currentDept).order('name'),
      sb.from('schedules').select('*').eq('filial', currentFilial).gte('date', dateStrs[0]).lte('date', dateStrs[6]),
    ]);
    const emps = (empsR.data||[]).filter(e => (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));

    if(!emps || emps.length===0) {
      content.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">📅</div><div class="empty-text">В этом отделе нет сотрудников для филиала «' + getFilialName(currentFilial) + '»</div></div></div>';
      return;
    }

    // Build map: date+empId -> schedule
    const schedMap = {};
    (schedR.data||[]).forEach(s => { schedMap[s.date+'_'+s.employee_id] = s; });

    const dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const isAdmin = canEditData();

    let html = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button onclick="shiftWeek(-1)" style="background:var(--surface);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer">← Пред. неделя</button>
        <button onclick="shiftWeek(1)" style="background:var(--surface);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer">След. неделя →</button>
      </div>
      <table style="border-collapse:collapse;width:100%;min-width:${100 + emps.length*90}px;background:var(--surface);border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
        <thead>
          <tr>
            <th style="background:#1a1a2e;color:#fff;padding:10px 8px;font-size:12px;text-align:left;min-width:70px;position:sticky;left:0;z-index:2">День</th>
            ${emps.map(e=>`<th style="background:${getColorHex(e.name)};color:#fff;padding:10px 8px;font-size:12px;min-width:85px;text-align:center">${escapeHtml(firstName(e.name))}</th>`).join('')}
          </tr>
        </thead>
        <tbody>`;

    weekDates.forEach((d, di) => {
      const dateStr = dateStrs[di];
      const isToday = dateStr === today();
      html += `<tr style="${isToday?'background:#F5F3FF':''}">
        <td style="padding:8px;font-size:12px;font-weight:600;color:var(--text-primary);border-top:1px solid var(--border);position:sticky;left:0;background:${isToday?'var(--surface-2)':'var(--surface)'};z-index:1">${dayNames[di]}<br><span style="font-weight:400;color:var(--text-muted);font-size:11px">${d.getDate()}.${d.getMonth()+1}</span></td>`;
      
      emps.forEach(e => {
        const sched = schedMap[dateStr+'_'+e.id];
        let cellContent = '<span style="color:#ccc;font-size:11px">—</span>';
        let cellBg = 'var(--surface)';
        if(sched) {
          if(sched.is_day_off) {
            cellContent = '<span style="color:#A32D2D;font-weight:600;font-size:12px">Вых</span>';
            cellBg = 'var(--surface-2)';
          } else {
            cellContent = `<span style="font-weight:700;font-size:12px;color:#1a1611">${escapeHtml(sched.shift_start||'')}</span>`;
            cellBg = 'var(--gold-light)';
          }
        }
        const clickHandler = isAdmin ? `onclick="quickEditSchedule(${e.id},'${escJsAttr(e.name)}','${dateStr}')"` : '';
        html += `<td ${clickHandler} style="padding:8px;text-align:center;border-top:1px solid var(--border);border-left:1px solid var(--border);background:${cellBg};cursor:${isAdmin?'pointer':'default'}">${cellContent}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    // My shift today card (for employees)
    if(currentProfile?.employee_id) {
      const myTodaySched = schedMap[today()+'_'+currentProfile.employee_id];
      if(myTodaySched) {
        let card = '';
        if(myTodaySched.is_day_off) {
          card = `<div class="card" style="background:linear-gradient(135deg,#EAF3DE,#d4edda);border:none;margin-top:12px"><div style="text-align:center;padding:8px"><div style="font-size:28px">🌴</div><div style="font-size:15px;font-weight:600;color:#3B6D11;margin-top:4px">Сегодня твой выходной</div></div></div>`;
        } else {
          card = `<div class="card" style="background:linear-gradient(135deg,#1a1a2e,#2d2b6b);border:none;color:#fff;margin-top:12px"><div style="font-size:11px;opacity:0.7;margin-bottom:4px">ТВОЯ СМЕНА СЕГОДНЯ</div><div style="font-size:22px;font-weight:700">🕐 ${myTodaySched.shift_start||''} — ${myTodaySched.shift_end||''}</div></div>`;
        }
        html = card + html;
      }
    }

    content.innerHTML = html;
  } catch(e) { console.error(e); content.innerHTML = '<div class="loading">Ошибка загрузки</div>'; }
}

function getColorHex(name) {
  const hexColors = ['#8a6a2f','#0F6E56','#993C1D','#854F0B','#1A6FA8','#7C3AED'];
  let h=0; for(let c of name) h+=c.charCodeAt(0);
  return hexColors[h % hexColors.length];
}

// Quick edit cell
let quickEditEmpId = null, quickEditEmpName = null, quickEditDate = null;
function quickEditSchedule(empId, empName, date) {
  quickEditEmpId = empId; quickEditEmpName = empName; quickEditDate = date;
  document.getElementById('sch-employee-display').textContent = empName;
  document.getElementById('sch-date-display').textContent = new Date(date).toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
  document.getElementById('sch-filial-display').textContent = '📍 ' + getFilialName(currentFilial);
  document.getElementById('sch-dayoff').checked = false;
  document.getElementById('sch-time-fields').style.display = 'block';
  document.getElementById('sch-start').value = '11:00';
  document.getElementById('sch-end').value = '23:00';
  document.getElementById('sch-note').value = '';
  openModal('modal-add-schedule');
}

function toggleDayOff(cb) {
  document.getElementById('sch-time-fields').style.display = cb.checked ? 'none' : 'block';
}

async function loadScheduleEmployees() {
  quickEditEmpId = null;
}

async function pickEmployeeForSchedule() {
  const { data: allEmps } = await sb.from('employees').select('id,name,filials,status').eq('department', currentDept).order('name');
  const emps = (allEmps||[]).filter(e => (e.status!=='Уволен') && (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));
  if(!emps || emps.length===0) return showToast('В этом отделе нет сотрудников для филиала «' + getFilialName(currentFilial) + '»');

  document.getElementById('pick-emp-subtitle').textContent = '📍 ' + getFilialName(currentFilial) + ' · ' + currentDept;
  document.getElementById('pick-emp-list').innerHTML = emps.map(e=>`
    <button onclick="choosePickedEmployee(${e.id}, '${escapeHtml(e.name).replace(/'/g,"\\'")}')" style="width:100%;display:flex;align-items:center;gap:12px;text-align:left;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer">
      <div class="avatar ${getColor(e.name)}" style="width:36px;height:36px;font-size:12px">${escapeHtml(getInitials(e.name))}</div>
      <span style="font-size:15px;color:var(--text-primary);font-weight:500">${escapeHtml(e.name)}</span>
    </button>`).join('');
  openModal('modal-pick-employee');
}

function choosePickedEmployee(id, name) {
  closeModal('modal-pick-employee');
  quickEditSchedule(id, name, today());
}

// WEEK FILL
let weekFillDates = [];
async function openWeekFillPicker() {
  const { data: allEmps } = await sb.from('employees').select('id,name,filials').eq('department', currentDept).order('name');
  const emps = (allEmps||[]).filter(e => (e.filials&&e.filials.length?e.filials:['istikbol','chekhov']).includes(currentFilial));
  if(!emps || emps.length===0) return showToast('В этом отделе нет сотрудников для филиала «' + getFilialName(currentFilial) + '»');
  const sel = document.getElementById('week-employee');
  sel.innerHTML = emps.map(e=>`<option value="${e.id}" data-name="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join('');
  document.getElementById('wf-filial-display').textContent = '📍 ' + getFilialName(currentFilial);
  await renderWeekFillDays();
  openModal('modal-week-fill');
}

async function renderWeekFillDays() {
  const sel = document.getElementById('week-employee');
  const empId = sel.value;
  weekFillDates = [];
  for(let i=0;i<7;i++) {
    const d = new Date(scheduleWeekStart);
    d.setDate(d.getDate()+i);
    weekFillDates.push(d);
  }
  const dayNames = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];

  // Load existing schedule for this employee this week
  const dateStrs = weekFillDates.map(fmtDate);
  const { data: existing } = await sb.from('schedules').select('*').eq('employee_id', empId).eq('filial', currentFilial).in('date', dateStrs);
  const existingMap = {};
  (existing||[]).forEach(s => { existingMap[s.date] = s; });

  const container = document.getElementById('week-fill-days');
  container.innerHTML = weekFillDates.map((d,i) => {
    const dateStr = dateStrs[i];
    const ex = existingMap[dateStr];
    const isOff = ex?.is_day_off || false;
    const startVal = ex?.shift_start || '11:00';
    const endVal = ex?.shift_end || '23:00';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="width:90px;font-size:13px;color:var(--text-primary);font-weight:500">${dayNames[i]}<div style="font-size:11px;color:var(--text-muted)">${d.getDate()}.${d.getMonth()+1}</div></div>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted)">
        <input type="checkbox" class="wf-dayoff" data-idx="${i}" ${isOff?'checked':''} onchange="toggleWfDayOff(${i})"> Вых
      </label>
      <input type="time" class="wf-start form-input" data-idx="${i}" value="${startVal}" style="padding:6px 8px;font-size:12px;${isOff?'display:none':''}">
      <span style="font-size:12px;color:var(--text-muted);${isOff?'display:none':''}" class="wf-dash-${i}">—</span>
      <input type="time" class="wf-end form-input" data-idx="${i}" value="${endVal}" style="padding:6px 8px;font-size:12px;${isOff?'display:none':''}">
    </div>`;
  }).join('');
}

function toggleWfDayOff(idx) {
  const cb = document.querySelector(`.wf-dayoff[data-idx="${idx}"]`);
  const start = document.querySelector(`.wf-start[data-idx="${idx}"]`);
  const end = document.querySelector(`.wf-end[data-idx="${idx}"]`);
  const dash = document.querySelector(`.wf-dash-${idx}`);
  const show = !cb.checked;
  start.style.display = show ? 'inline-block' : 'none';
  end.style.display = show ? 'inline-block' : 'none';
  if(dash) dash.style.display = show ? 'inline' : 'none';
}

function applyToAllDays() {
  const start = document.getElementById('week-default-start').value;
  const end = document.getElementById('week-default-end').value;
  document.querySelectorAll('.wf-start').forEach(el => el.value = start);
  document.querySelectorAll('.wf-end').forEach(el => el.value = end);
  document.querySelectorAll('.wf-dayoff').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('.wf-start, .wf-end').forEach(el => el.style.display = 'inline-block');
  document.querySelectorAll('[class^="wf-dash-"]').forEach(el => el.style.display = 'inline');
}

async function saveWeekFill() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const sel = document.getElementById('week-employee');
  const empId = sel.value;
  const empName = sel.options[sel.selectedIndex]?.getAttribute('data-name') || '';
  if(!empId) return showToast('Выберите сотрудника');

  try {
    for(let i=0; i<7; i++) {
      const dateStr = fmtDate(weekFillDates[i]);
      const isOff = document.querySelector(`.wf-dayoff[data-idx="${i}"]`).checked;
      const start = document.querySelector(`.wf-start[data-idx="${i}"]`).value;
      const end = document.querySelector(`.wf-end[data-idx="${i}"]`).value;

      await sb.from('schedules').delete().eq('employee_id', empId).eq('date', dateStr).eq('filial', currentFilial);
      await sb.from('schedules').insert({
        employee_id: parseInt(empId), employee_name: empName, date: dateStr,
        shift_start: isOff ? null : start, shift_end: isOff ? null : end,
        is_day_off: isOff, filial: currentFilial
      });
    }

    const { data: profile } = await sb.from('profiles').select('telegram_id').eq('employee_id', empId).single();
    if(profile?.telegram_id) {
      await sendTelegram(profile.telegram_id, `📅 <b>Твоё расписание на неделю обновлено!</b>\n\nОткрой приложение чтобы посмотреть: https://slon-app.vercel.app`);
    }

    closeModal('modal-week-fill');
    showToast('✅ Неделя заполнена');
    loadScheduleGrid();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function addSchedule() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const empId = quickEditEmpId;
  const empName = quickEditEmpName;
  const date = quickEditDate || today();
  const isDayOff = document.getElementById('sch-dayoff').checked;
  const start = document.getElementById('sch-start').value;
  const end = document.getElementById('sch-end').value;
  const note = document.getElementById('sch-note').value;

  if(!empId) return showToast('Выберите ячейку в таблице');

  try {
    await sb.from('schedules').delete().eq('employee_id', empId).eq('date', date).eq('filial', currentFilial);
    await sb.from('schedules').insert({
      employee_id: parseInt(empId), employee_name: empName, date,
      shift_start: isDayOff ? null : start, shift_end: isDayOff ? null : end,
      is_day_off: isDayOff, note, filial: currentFilial
    });

    const { data: profile } = await sb.from('profiles').select('telegram_id').eq('employee_id', empId).single();
    if(profile?.telegram_id) {
      const msg = isDayOff 
        ? `📅 <b>Расписание обновлено</b>\n\n🌴 ${date} — выходной день`
        : `📅 <b>Расписание обновлено</b>\n\n🕐 ${date}: смена ${start}–${end}${note?' ('+note+')':''}`;
      await sendTelegram(profile.telegram_id, msg);
    }

    closeModal('modal-add-schedule');
    showToast('✅ Сохранено');
    loadScheduleGrid();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function deleteSchedule(id) {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  await sb.from('schedules').delete().eq('id', id);
  showToast('✅ Удалено');
  loadScheduleGrid();
}


