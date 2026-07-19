// SCHEDULE - WEEKLY GRID VIEW
const DEPARTMENTS = ['Официанты','Бармены','Кальянные мастера','Повара','Техперсонал','Менеджеры'];

// Готовые варианты смен по цехам — управляющий выбирает кнопкой, а не вводит время вручную.
// end <= start означает переход через полночь (напр. 15:00–03:00). Цеха без списка (Техперсонал,
// Менеджеры) используют ручной ввод времени.
const SHIFT_PRESETS = {
  'Официанты': [
    { start: '11:00', end: '23:00' },
    { start: '15:00', end: '03:00' },
    { start: '18:00', end: '03:00' },
  ],
  'Бармены': [
    { start: '11:30', end: '00:00' },
    { start: '15:00', end: '02:00' },
    { start: '11:30', end: '02:00', full: true }, // весь день, +100 000
  ],
  'Кальянные мастера': [
    { start: '11:30', end: '00:00' },
    { start: '12:45', end: '01:00' },
    { start: '14:45', end: '03:00' },
  ],
  'Повара': [
    { start: '11:00', end: '23:00' },
    { start: '14:30', end: '02:30' },
  ],
};

// Длина смены в минутах с учётом перехода через полночь
function shiftDurationMin(start, end) {
  if(!start || !end) return 0;
  const [sh,sm] = start.split(':').map(Number);
  const [eh,em] = end.split(':').map(Number);
  let s = sh*60+sm, e = eh*60+em;
  if(e <= s) e += 24*60;
  return e - s;
}
function shiftDurLabel(start, end) {
  const m = shiftDurationMin(start, end);
  const h = Math.floor(m/60), mm = m%60;
  return mm ? `${h} ч ${mm} м` : `${h} ч`;
}

let currentDept = 'Официанты';
let scheduleWeekStart = getMonday(new Date());
let scheduleAutoJumped = false; // чтобы автопереход в свой отдел не откатывал ручной выбор вкладки

// Кэш списка сотрудников по отделу (id,name,filials). При листании недель и смене
// филиала переиспользуется — меняются только смены. Сбрасывается при изменении штата.
let scheduleEmpCache = {};
function invalidateScheduleEmps() { scheduleEmpCache = {}; }

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

    // Расписания недели грузим всегда; список сотрудников отдела — из кэша, если есть.
    // employees_view: только нужные поля, без '*' — иначе представление считает зарплату
    // подзапросом на каждую строку, что и подтормаживало.
    // Расписания берём по филиалу+неделе; лишние строки чужих отделов просто не отрисуются.
    const dept = currentDept;
    const cachedEmps = scheduleEmpCache[dept];
    const [empsR, schedR] = await Promise.all([
      cachedEmps
        ? Promise.resolve({ data: cachedEmps })
        : sb.from('employees_view').select('id,name,filials').eq('department', dept).order('name'),
      sb.from('schedules').select('*').eq('filial', currentFilial).gte('date', dateStrs[0]).lte('date', dateStrs[6]),
    ]);
    if(!cachedEmps && empsR.data) scheduleEmpCache[dept] = empsR.data;
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
  const firstPreset = (SHIFT_PRESETS[currentDept]||[])[0];
  document.getElementById('sch-start').value = firstPreset ? firstPreset.start : '11:00';
  document.getElementById('sch-end').value = firstPreset ? firstPreset.end : '23:00';
  document.getElementById('sch-note').value = '';
  renderShiftPresets('sch-presets', 'pickShiftPreset');
  openModal('modal-add-schedule');
}

function toggleDayOff(cb) {
  document.getElementById('sch-time-fields').style.display = cb.checked ? 'none' : 'block';
  const presets = document.getElementById('sch-presets');
  if(presets) presets.style.display = (cb.checked || !SHIFT_PRESETS[currentDept]) ? 'none' : 'block';
}

// Кнопки смен цеха. applyFn — имя функции, которой передаём start/end при нажатии.
function renderShiftPresets(containerId, applyFn) {
  const el = document.getElementById(containerId);
  if(!el) return;
  const presets = SHIFT_PRESETS[currentDept];
  if(!presets || !presets.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML =
    `<div class="form-label" style="margin-bottom:6px">Смены цеха «${escapeHtml(currentDept)}» — нажми, чтобы выбрать</div>
     <div style="display:flex;flex-wrap:wrap;gap:6px">
       ${presets.map(p=>`
         <button type="button" onclick="${applyFn}('${p.start}','${p.end}')"
           style="display:flex;flex-direction:column;align-items:center;gap:1px;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer">
           <span>${p.start}–${p.end}</span>
           <span style="font-size:10px;font-weight:400;color:var(--text-muted)">${shiftDurLabel(p.start,p.end)}${p.full?' · весь день':''}</span>
         </button>`).join('')}
     </div>`;
}

// Выбор смены в модалке «Назначить смену» (одна ячейка)
function pickShiftPreset(start, end) {
  document.getElementById('sch-dayoff').checked = false;
  document.getElementById('sch-time-fields').style.display = 'block';
  document.getElementById('sch-start').value = start;
  document.getElementById('sch-end').value = end;
}

// Кнопка смены в «Заполнить неделю» — применяет её ко всем 7 дням
function pickWeekPreset(start, end) {
  const selects = document.querySelectorAll('.wf-select');
  if(selects.length) {
    const v = start+'|'+end;
    selects.forEach(s => { s.value = v; });
    document.querySelectorAll('.wf-custom').forEach(el => { el.style.display = 'none'; }); // прячем ручной ввод
  } else {
    document.getElementById('week-default-start').value = start;
    document.getElementById('week-default-end').value = end;
    applyToAllDays();
  }
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
  const hasPresets = !!(SHIFT_PRESETS[currentDept]||[]).length;
  // Ручной блок «Начало/Конец/Всем дням» нужен только цехам без пресетов
  const manualRow = document.getElementById('wf-manual-default');
  if(manualRow) manualRow.style.display = hasPresets ? 'none' : 'flex';
  renderShiftPresets('wf-presets', 'pickWeekPreset');
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

  const presets = SHIFT_PRESETS[currentDept] || [];
  const dayLabel = (d,i) => `<div style="width:96px;flex:0 0 auto;font-size:13px;color:var(--text-primary);font-weight:500">${dayNames[i]}<div style="font-size:11px;color:var(--text-muted)">${d.getDate()}.${d.getMonth()+1}</div></div>`;

  const container = document.getElementById('week-fill-days');
  container.innerHTML = weekFillDates.map((d,i) => {
    const dateStr = dateStrs[i];
    const ex = existingMap[dateStr];
    const isOff = ex?.is_day_off || false;

    // Цех с пресетами — выпадающий список смен на день + пункт «Другое время…» для ручного ввода
    if(presets.length) {
      const exVal = ex?.shift_start ? ex.shift_start+'|'+(ex.shift_end||'') : '';
      const isCustom = !isOff && ex?.shift_start && !presets.some(p=>p.start+'|'+p.end===exVal);
      const curVal = isOff ? 'off' : isCustom ? 'custom' : (exVal || presets[0].start+'|'+presets[0].end);
      const mStart = ex?.shift_start || presets[0].start;
      const mEnd = ex?.shift_end || presets[0].end;
      let opts = presets.map(p=>{
        const v = p.start+'|'+p.end;
        return `<option value="${v}" ${v===curVal?'selected':''}>${p.start}–${p.end} · ${shiftDurLabel(p.start,p.end)}${p.full?' · весь день':''}</option>`;
      }).join('');
      opts += `<option value="custom" ${isCustom?'selected':''}>✏️ Другое время…</option>`;
      opts += `<option value="off" ${isOff?'selected':''}>🌴 Выходной</option>`;
      return `<div style="display:flex;flex-direction:column;gap:6px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          ${dayLabel(d,i)}
          <select class="form-select wf-select" data-idx="${i}" onchange="toggleWfCustom(${i})" style="flex:1;padding:9px 10px;font-size:13px">${opts}</select>
        </div>
        <div class="wf-custom" data-idx="${i}" style="display:${isCustom?'flex':'none'};gap:8px;align-items:center;padding-left:106px">
          <input type="time" class="wf-start form-input" data-idx="${i}" value="${mStart}" style="padding:6px 8px;font-size:12px">
          <span style="font-size:12px;color:var(--text-muted)">—</span>
          <input type="time" class="wf-end form-input" data-idx="${i}" value="${mEnd}" style="padding:6px 8px;font-size:12px">
        </div>
      </div>`;
    }

    // Цех без пресетов — ручной ввод времени
    const startVal = ex?.shift_start || '11:00';
    const endVal = ex?.shift_end || '23:00';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
      ${dayLabel(d,i)}
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted)">
        <input type="checkbox" class="wf-dayoff" data-idx="${i}" ${isOff?'checked':''} onchange="toggleWfDayOff(${i})"> Вых
      </label>
      <input type="time" class="wf-start form-input" data-idx="${i}" value="${startVal}" style="padding:6px 8px;font-size:12px;${isOff?'display:none':''}">
      <span style="font-size:12px;color:var(--text-muted);${isOff?'display:none':''}" class="wf-dash-${i}">—</span>
      <input type="time" class="wf-end form-input" data-idx="${i}" value="${endVal}" style="padding:6px 8px;font-size:12px;${isOff?'display:none':''}">
    </div>`;
  }).join('');
}

// Показать поля ручного ввода времени, когда в списке дня выбрано «Другое время…»
function toggleWfCustom(idx) {
  const sel = document.querySelector(`.wf-select[data-idx="${idx}"]`);
  const custom = document.querySelector(`.wf-custom[data-idx="${idx}"]`);
  if(sel && custom) custom.style.display = (sel.value === 'custom') ? 'flex' : 'none';
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
      let isOff, start, end;
      const daySel = document.querySelector(`.wf-select[data-idx="${i}"]`);
      if(daySel) { // цех с пресетами — значение из выпадающего списка
        if(daySel.value === 'off') { isOff = true; }
        else if(daySel.value === 'custom') { // ручной ввод для этого дня
          isOff = false;
          start = document.querySelector(`.wf-start[data-idx="${i}"]`).value;
          end = document.querySelector(`.wf-end[data-idx="${i}"]`).value;
        }
        else { isOff = false; [start, end] = daySel.value.split('|'); }
      } else {     // ручной ввод (цех без пресетов)
        isOff = document.querySelector(`.wf-dayoff[data-idx="${i}"]`).checked;
        start = document.querySelector(`.wf-start[data-idx="${i}"]`).value;
        end = document.querySelector(`.wf-end[data-idx="${i}"]`).value;
      }

      await sb.from('schedules').delete().eq('employee_id', empId).eq('date', dateStr).eq('filial', currentFilial);
      await sb.from('schedules').insert({
        employee_id: parseInt(empId), employee_name: empName, date: dateStr,
        shift_start: isOff ? null : start, shift_end: isOff ? null : end,
        is_day_off: isOff, filial: currentFilial
      });
    }

    const { data: profile } = await sb.from('profiles').select('telegram_id,notify_prefs').eq('employee_id', empId).single();
    if(profile?.telegram_id && _wantsNotif(profile.notify_prefs, 'schedule')) {
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

    const { data: profile } = await sb.from('profiles').select('telegram_id,notify_prefs').eq('employee_id', empId).single();
    if(profile?.telegram_id && _wantsNotif(profile.notify_prefs, 'schedule')) {
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


