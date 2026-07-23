// ============ КАЛЕНДАРЬ (CALENDAR) ============
const EVENT_TYPES = {
  delivery:{icon:'📦',label:t('cal.evDelivery'),color:'#3B6D11'},
  inspection:{icon:'🔍',label:t('cal.evInspection'),color:'#A32D2D'},
  banquet:{icon:'🎉',label:t('cal.evBanquet'),color:'#7B4FA6'},
  birthday:{icon:'🎂',label:t('cal.evBirthday'),color:'#C77D2F'},
  other:{icon:'📌',label:t('cal.evOther'),color:'#666'}
};
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();

function calPrevMonth() { calMonth--; if(calMonth<0){calMonth=11;calYear--;} loadCalendar(); }
function calNextMonth() { calMonth++; if(calMonth>11){calMonth=0;calYear++;} loadCalendar(); }

function openEventModal(dateStr) {
  if(!canEditData()) return;
  document.getElementById('event-type').value = 'delivery';
  document.getElementById('event-title').value = '';
  document.getElementById('event-date').value = dateStr || ymdLocal();
  document.getElementById('event-time').value = '';
  document.getElementById('event-note').value = '';
  document.getElementById('event-filial').value = '';
  document.getElementById('event-delete-btn').style.display = 'none';
  document.getElementById('event-delete-btn').removeAttribute('data-id');
  openModal('modal-event');
}

function openEventEdit(ev) {
  if(!canEditData()) return;
  document.getElementById('event-type').value = ev.event_type;
  document.getElementById('event-title').value = ev.title;
  document.getElementById('event-date').value = ev.event_date;
  document.getElementById('event-time').value = ev.event_time || '';
  document.getElementById('event-note').value = ev.note || '';
  document.getElementById('event-filial').value = ev.filial || '';
  const delBtn = document.getElementById('event-delete-btn');
  delBtn.style.display = 'block';
  delBtn.setAttribute('data-id', ev.id);
  openModal('modal-event');
}

async function saveEvent() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const title = document.getElementById('event-title').value.trim();
  const event_type = document.getElementById('event-type').value;
  const event_date = document.getElementById('event-date').value;
  const event_time = document.getElementById('event-time').value || null;
  const note = document.getElementById('event-note').value.trim() || null;
  const filial = document.getElementById('event-filial').value || null;
  const editId = document.getElementById('event-delete-btn').getAttribute('data-id');
  if(!title) return showToast(t('cal.enterTitle'));
  if(!event_date) return showToast(t('cal.selectDate'));
  try {
    if(editId) {
      await sb.from('events').update({title,event_type,event_date,event_time,note,filial}).eq('id',editId);
    } else {
      await sb.from('events').insert({title,event_type,event_date,event_time,note,filial,created_by:currentUser.id,created_by_name:currentProfile?.name||currentUser?.email});
    }
    closeModal('modal-event');
    showToast(t('sch.saved'));
    loadCalendar();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function deleteEvent() {
  const id = document.getElementById('event-delete-btn').getAttribute('data-id');
  if(!id) return;
  if(!await confirmDialog(t('cal.delEventConfirm'))) return;
  try {
    await sb.from('events').delete().eq('id', id);
    closeModal('modal-event');
    showToast(t('sch.deleted'));
    loadCalendar();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function loadCalendar() {
  const addBtn = document.getElementById('cal-add-btn');
  if(addBtn) addBtn.style.display = canEditData() ? 'block' : 'none';
  document.getElementById('cal-subtitle').textContent = getFilialName(currentFilial);
  const monthNames = getLang()==='uz'
    ? ['Январ','Феврал','Март','Апрел','Май','Июн','Июл','Август','Сентябр','Октябр','Ноябр','Декабр']
    : ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  document.getElementById('cal-month-label').textContent = monthNames[calMonth] + ' ' + calYear;

  const content = document.getElementById('calendar-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const first = ymdLocal(new Date(calYear, calMonth, 1));
    const last = ymdLocal(new Date(calYear, calMonth+1, 0));
    const { data: events } = await sb.from('events').select('*')
      .or(`filial.eq.${currentFilial},filial.is.null`)
      .gte('event_date', first).lte('event_date', last)
      .order('event_date').order('event_time');

    if(!events || events.length===0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">📅</div><div class="empty-text">${t('cal.noEvents')}${canEditData()?t('cal.addHint'):''}</div></div></div>`;
      return;
    }
    // Группируем по дате
    const byDate = {};
    events.forEach(e=>{ (byDate[e.event_date]=byDate[e.event_date]||[]).push(e); });
    const todayStr = ymdLocal();

    content.innerHTML = Object.keys(byDate).sort().map(date=>{
      const d = new Date(date);
      const isToday = date===todayStr;
      const dayLabel = fmtLocale(d, {weekday:'short',day:'numeric',month:'long'});
      return `<div style="margin-bottom:14px">
        <div style="font-size:13px;font-weight:700;color:${isToday?'var(--gold-dark)':'var(--text-secondary)'};margin-bottom:6px;padding-left:4px">${isToday?t('cal.today'):''}${dayLabel}</div>
        ${byDate[date].map(e=>{
          const t = EVENT_TYPES[e.event_type]||EVENT_TYPES.other;
          return `<div class="card" style="border-left:3px solid ${t.color};${canEditData()?'cursor:pointer':''}" ${canEditData()?`onclick='openEventEdit(${JSON.stringify(e).replace(/'/g,"&#39;")})'`:''}>
            <div style="display:flex;align-items:center;gap:10px">
              <div style="font-size:22px">${t.icon}</div>
              <div style="flex:1">
                <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(e.title)}</div>
                <div style="font-size:12px;color:var(--text-muted)">${t.label}${e.event_time?' · '+e.event_time:''}${e.filial?' · '+getFilialName(e.filial):' · '+tr('cal.allFilials')}${e.note?' · '+escapeHtml(e.note):''}</div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('cal.errNotSetup')}</div></div></div>`; }
}

