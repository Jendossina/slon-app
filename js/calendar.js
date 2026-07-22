// ============ КАЛЕНДАРЬ (CALENDAR) ============
const EVENT_TYPES = {
  delivery:{icon:'📦',label:'Доставка',color:'#3B6D11'},
  inspection:{icon:'🔍',label:'Проверка',color:'#A32D2D'},
  banquet:{icon:'🎉',label:'Банкет',color:'#7B4FA6'},
  birthday:{icon:'🎂',label:'День рождения',color:'#C77D2F'},
  other:{icon:'📌',label:'Другое',color:'#666'}
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
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const title = document.getElementById('event-title').value.trim();
  const event_type = document.getElementById('event-type').value;
  const event_date = document.getElementById('event-date').value;
  const event_time = document.getElementById('event-time').value || null;
  const note = document.getElementById('event-note').value.trim() || null;
  const filial = document.getElementById('event-filial').value || null;
  const editId = document.getElementById('event-delete-btn').getAttribute('data-id');
  if(!title) return showToast('Введите название');
  if(!event_date) return showToast('Выберите дату');
  try {
    if(editId) {
      await sb.from('events').update({title,event_type,event_date,event_time,note,filial}).eq('id',editId);
    } else {
      await sb.from('events').insert({title,event_type,event_date,event_time,note,filial,created_by:currentUser.id,created_by_name:currentProfile?.name||currentUser?.email});
    }
    closeModal('modal-event');
    showToast('✅ Сохранено');
    loadCalendar();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function deleteEvent() {
  const id = document.getElementById('event-delete-btn').getAttribute('data-id');
  if(!id) return;
  if(!await confirmDialog('Удалить событие?')) return;
  try {
    await sb.from('events').delete().eq('id', id);
    closeModal('modal-event');
    showToast('✅ Удалено');
    loadCalendar();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function loadCalendar() {
  const addBtn = document.getElementById('cal-add-btn');
  if(addBtn) addBtn.style.display = canEditData() ? 'block' : 'none';
  document.getElementById('cal-subtitle').textContent = 'Филиал: ' + getFilialName(currentFilial);
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  document.getElementById('cal-month-label').textContent = monthNames[calMonth] + ' ' + calYear;

  const content = document.getElementById('calendar-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const first = ymdLocal(new Date(calYear, calMonth, 1));
    const last = ymdLocal(new Date(calYear, calMonth+1, 0));
    const { data: events } = await sb.from('events').select('*')
      .or(`filial.eq.${currentFilial},filial.is.null`)
      .gte('event_date', first).lte('event_date', last)
      .order('event_date').order('event_time');

    if(!events || events.length===0) {
      content.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">📅</div><div class="empty-text">В этом месяце событий нет'+(canEditData()?'.<br>Нажми «+ Событие».':'')+'</div></div></div>';
      return;
    }
    // Группируем по дате
    const byDate = {};
    events.forEach(e=>{ (byDate[e.event_date]=byDate[e.event_date]||[]).push(e); });
    const todayStr = ymdLocal();

    content.innerHTML = Object.keys(byDate).sort().map(date=>{
      const d = new Date(date);
      const isToday = date===todayStr;
      const dayLabel = d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'long'});
      return `<div style="margin-bottom:14px">
        <div style="font-size:13px;font-weight:700;color:${isToday?'var(--gold-dark)':'var(--text-secondary)'};margin-bottom:6px;padding-left:4px">${isToday?'📍 Сегодня · ':''}${dayLabel}</div>
        ${byDate[date].map(e=>{
          const t = EVENT_TYPES[e.event_type]||EVENT_TYPES.other;
          return `<div class="card" style="border-left:3px solid ${t.color};${canEditData()?'cursor:pointer':''}" ${canEditData()?`onclick='openEventEdit(${JSON.stringify(e).replace(/'/g,"&#39;")})'`:''}>
            <div style="display:flex;align-items:center;gap:10px">
              <div style="font-size:22px">${t.icon}</div>
              <div style="flex:1">
                <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(e.title)}</div>
                <div style="font-size:12px;color:var(--text-muted)">${t.label}${e.event_time?' · '+e.event_time:''}${e.filial?' · '+getFilialName(e.filial):' · все филиалы'}${e.note?' · '+escapeHtml(e.note):''}</div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  } catch(e) { content.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка. Возможно, календарь ещё не настроен в Supabase.</div></div></div>'; }
}

