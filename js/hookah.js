// ============ ОТЧЁТ ПО КАЛЬЯНАМ ============
// Кальянный мастер в конце смены вносит две цифры и фото: сколько кальянов
// продано и на какую сумму. Сделано по образцу кассы, только по своей станции
// и без разбивки по типам оплаты — станции она не нужна.
//
// Одна запись на день и филиал: повторное внесение правит ту же строку, иначе
// выручка задвоится (ровно эту ошибку ловили на кассе). Дату ставит сервер —
// часы телефона можно перевести.

// Кто вносит отчёт: сами кальянщики и руководство
function hookahCanReport() {
  return canEditData() || currentEmployee?.department === 'Кальянные мастера';
}
// Кто видит сводку: руководство, владелец и старший кальянной станции
function hookahCanSeeStats() {
  return canSeeAdminPanel() || canEditData() || myLeadDept() === 'Кальянные мастера';
}

let hookahTodayRow = null;

// ===== Карточка на главном экране =====
async function renderHookahCard() {
  const el = document.getElementById('home-hookah-card');
  if(!el) return;
  if(!hookahCanReport()) { el.innerHTML = ''; return; }
  try {
    const day = businessToday();
    const { data } = await sb.from('hookah_reports').select('*')
      .eq('date', day).eq('filial', currentFilial).maybeSingle();
    hookahTodayRow = data || null;
    const done = !!data;
    el.innerHTML = `<div class="card" style="margin-bottom:12px">
      <div class="card-title">💨 ${t('hk.cardTitle')}</div>
      ${done
        ? `<div style="display:flex;gap:10px;margin:8px 0">
             <div style="flex:1;background:var(--surface-2);border-radius:10px;padding:10px;text-align:center">
               <div class="stat-sub">${t('hk.count')}</div><div style="font-size:20px;font-weight:700">${data.count || 0}</div></div>
             <div style="flex:1;background:var(--surface-2);border-radius:10px;padding:10px;text-align:center">
               <div class="stat-sub">${t('hk.amount')}</div><div style="font-size:20px;font-weight:700" class="finance-positive">${formatNum(data.amount || 0)}</div></div>
           </div>
           ${data.photo_url ? `<img src="${escapeHtml(data.photo_url)}" loading="lazy" decoding="async" onclick="viewReport('${escJsAttr(data.photo_url)}','image')" style="max-width:100%;border-radius:10px;max-height:140px;object-fit:cover;cursor:pointer">` : ''}`
        : `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${t('hk.cardHint')}</div>`}
      <button class="btn ${done ? 'btn-secondary' : 'btn-primary'}" onclick="openHookahModal()" style="margin-top:10px">
        ${done ? t('hk.editBtn') : t('hk.addBtn')}</button>
    </div>`;
  } catch(e) { el.innerHTML = ''; }
}

// ===== Внесение =====
function openHookahModal() {
  if(!hookahCanReport()) return showToast(t('common.observerMode'));
  const r = hookahTodayRow;
  document.getElementById('hookah-count').value = r?.count || '';
  document.getElementById('hookah-amount').value = r?.amount || '';
  document.getElementById('hookah-note').value = r?.note || '';
  document.getElementById('hookah-photo-url').value = r?.photo_url || '';
  document.getElementById('hookah-photo-preview').innerHTML = r?.photo_url
    ? `<img src="${escapeHtml(r.photo_url)}" style="max-width:100%;border-radius:10px;max-height:160px;object-fit:cover">` : '';
  document.getElementById('hookah-filial-label').textContent = getFilialName(currentFilial);
  openModal('modal-hookah');
}

async function onHookahPhoto(input) {
  const file = input.files && input.files[0];
  if(!file) return;
  const status = document.getElementById('hookah-photo-status');
  if(status) status.textContent = t('hk.uploading');
  try {
    const compressed = await compressImage(file);
    const path = `hookah-${currentFilial}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('task-reports').upload(path, compressed);
    if(error) { if(status) status.textContent = t('common.error') + error.message; return; }
    const { data } = sb.storage.from('task-reports').getPublicUrl(path);
    document.getElementById('hookah-photo-url').value = data.publicUrl;
    document.getElementById('hookah-photo-preview').innerHTML =
      `<img src="${escapeHtml(data.publicUrl)}" style="max-width:100%;border-radius:10px;max-height:160px;object-fit:cover">`;
    if(status) status.textContent = t('hk.photoReady');
  } catch(e) { if(status) status.textContent = t('common.error') + e.message; }
}

async function saveHookahReport() {
  if(!hookahCanReport()) return showToast(t('common.observerMode'));
  const count = parseInt(document.getElementById('hookah-count').value, 10);
  const amount = parseFloat(document.getElementById('hookah-amount').value);
  if(isNaN(count) || count < 0) return showToast(t('hk.enterCount'));
  if(isNaN(amount) || amount < 0) return showToast(t('hk.enterAmount'));
  const row = {
    count, amount,
    note: document.getElementById('hookah-note').value.trim() || null,
    photo_url: document.getElementById('hookah-photo-url').value || null,
    created_by: currentUser.id,
    created_by_name: currentProfile?.name || currentUser?.email,
  };
  try {
    let error;
    if(hookahTodayRow) ({ error } = await sb.from('hookah_reports').update(row).eq('id', hookahTodayRow.id));
    else ({ error } = await sb.from('hookah_reports').insert({ ...row, filial: currentFilial, date: businessToday() }));
    if(error) return showToast(t('common.error') + error.message);
    closeModal('modal-hookah');
    showToast(t('hk.saved'));
    renderHookahCard();
  } catch(e) { showToast(t('common.error') + e.message); }
}

// ===== Вкладка дашборда =====
async function loadDashHookah() {
  const body = document.getElementById('dashboard-content');
  if(!body) return;
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { from, to } = dashDateRange();
    const fids = dashActiveFilials().map(f => f.id);
    const { data } = await sb.from('hookah_reports').select('*')
      .in('filial', fids).gte('date', from).lte('date', to).order('date', { ascending: false });
    const rows = data || [];
    const count = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const amount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const avg = count ? Math.round(amount / count) : 0;
    const days = rows.length;

    let html = dashHead('💨 ' + t('dash.tab.hookah'));
    html += dashKpis([
      { label: t('hk.count'),      val: formatNum(count) },
      { label: t('hk.amount'),     val: formatNum(amount) },
      { label: t('hk.avgPrice'),   val: formatNum(avg) },
      { label: t('hk.daysFilled'), val: String(days) },
    ]);
    if(rows.length === 0) {
      html += `<div class="card"><div class="empty"><div class="empty-icon">💨</div><div class="empty-text">${t('hk.noData')}</div></div></div>`;
    } else {
      html += `<div class="section-label">${t('hk.byDays')}</div>` + rows.map(r => `
        <div class="card" style="display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;color:var(--text-primary)">
              ${fmtLocale(new Date(r.date), { day:'numeric', month:'short' })} · ${escapeHtml(getFilialName(r.filial))}</div>
            <div style="font-size:12px;color:var(--text-muted)">
              ${t('hk.count')}: <b>${r.count || 0}</b> · ${t('hk.amount')}: <b>${formatNum(r.amount || 0)}</b>
              ${r.created_by_name ? ' · ' + escapeHtml(firstName(r.created_by_name)) : ''}</div>
            ${r.note ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px">${escapeHtml(r.note)}</div>` : ''}
          </div>
          ${r.photo_url ? `<img src="${escapeHtml(r.photo_url)}" loading="lazy" decoding="async" onclick="viewReport('${escJsAttr(r.photo_url)}','image')" style="width:64px;height:64px;border-radius:10px;object-fit:cover;cursor:zoom-in;flex:0 0 auto">` : ''}
        </div>`).join('');
    }
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('hk.noData')}</div></div></div>`;
  }
}
