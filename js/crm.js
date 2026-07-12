async function loadCRM() {
  try {
    const { data: books } = await sb.from('bookings').select('*').eq('filial', currentFilial).order('date',{ascending:false});
    document.getElementById('crm-count').textContent = `${(books||[]).length} броней · ${getFilialName(currentFilial)}`;
    const list = document.getElementById('crm-list');
    if(!books||books.length===0) { list.innerHTML='<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Броней пока нет</div></div>'; return; }
    list.innerHTML = books.map(b=>`
      <div class="list-item">
        <div class="avatar ${getColor(b.guest_name)}">${escapeHtml(getInitials(b.guest_name))}</div>
        <div class="item-info"><div class="item-name">${escapeHtml(b.guest_name)}</div><div class="item-sub">${escapeHtml(b.date||'')} ${escapeHtml(b.time||'')} · ${escapeHtml(b.zone||'')} · ${b.guests_count||''} чел.</div><div class="item-sub">${escapeHtml(b.phone||'')}</div></div>
        <span class="badge ${b.status==='Подтверждена'?'badge-green':b.status==='Отменена'?'badge-red':'badge-amber'}">${escapeHtml(b.status||'Ожидание')}</span>
      </div>`).join('');
  } catch(e) { console.error(e); document.getElementById('crm-list').innerHTML = '<div class="empty"><div class="empty-text">Ошибка загрузки. Проверьте соединение.</div></div>'; }
}

async function addBooking() {
  if(!canEditData()) return showToast('Режим наблюдателя — редактирование недоступно');
  const name = document.getElementById('book-name').value.trim();
  if(!name) return showToast('Введите имя гостя');
  try {
    await sb.from('bookings').insert({ guest_name:name, phone:document.getElementById('book-phone').value, date:document.getElementById('book-date').value||today(), time:document.getElementById('book-time').value, guests_count:parseInt(document.getElementById('book-guests').value)||1, zone:document.getElementById('book-zone').value, status:'Ожидание', filial: currentFilial });
    closeModal('modal-add-booking');
    ['book-name','book-phone','book-date','book-time','book-guests'].forEach(id=>document.getElementById(id).value='');
    showToast('✅ Бронь добавлена');
    loadCRM();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

document.querySelector('[onclick="openModal(\'modal-add-task\')"]')?.addEventListener('click', loadTaskEmployees);
document.querySelector('[onclick="openModal(\'modal-add-finance\')"]')?.addEventListener('click', ()=>{
  const el = document.getElementById('fin-filial-display');
  if(el) el.textContent = '📍 Операция для филиала: ' + getFilialName(currentFilial);
});
document.querySelector('[onclick="openModal(\'modal-add-booking\')"]')?.addEventListener('click', ()=>{
  const el = document.getElementById('book-filial-display');
  if(el) el.textContent = '📍 Бронь на филиал: ' + getFilialName(currentFilial);
});



