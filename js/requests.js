// ЗАЯВКИ СОТРУДНИКОВ: замена смены и предупреждение об опоздании.
//
// Обе заявки устроены одинаково: сотрудник подаёт — ответственный решает.
// Ответственный тот же, что правит график: старший цеха по своему цеху,
// управляющий и менеджер по любому (canLeadDept, та же лестница продублирована
// в базе как can_edit_schedule_of).
//
// Здесь только форма и список. График правит база в момент одобрения
// (shift_requests_decide), и это принципиально: сотруднику писать в schedules
// нельзя, иначе заявка стала бы обходным путём для правки своих смен.

const REQ_HORIZON_DAYS = 14;   // насколько вперёд предлагаем смены для замены

let reqMyShifts = [];          // мои ближайшие смены
let reqPartnerShifts = [];     // смены выбранного напарника
let reqInboxRows = [];

// Может ли текущий пользователь решить по этой заявке. Владелец только смотрит,
// свою заявку старший цеха не утверждает — она уходит наверх.
function canDecideRequest(r) {
  if(!r || r.status !== 'pending' || isBoss()) return false;
  if(r.employee_id === currentProfile?.employee_id && !canEditData()) return false;
  return canLeadDept(r.department);
}

function reqDayLabel(ds) { return fmtLocale(new Date(ds), { weekday:'short', day:'numeric', month:'long' }); }

// Смены человека на ближайшие две недели. Выходные отбрасываем здесь, а не в
// запросе: is_day_off бывает null, и фильтр по равенству их бы потерял.
async function loadUpcomingShifts(empId) {
  if(!empId) return [];
  const from = businessToday();
  const to = ymdLocal(new Date(Date.now() + REQ_HORIZON_DAYS * 864e5));
  const { data } = await sb.from('schedules').select('id,date,shift_start,shift_end,filial')
    .eq('employee_id', empId).gte('date', from).lte('date', to).order('date');
  return (data || []).filter(s => !s.is_day_off && s.shift_start);
}

function reqShiftOptions(shifts, selected) {
  return shifts.map(s =>
    `<option value="${s.date}"${s.date===selected?' selected':''}>${reqDayLabel(s.date)} · ${escapeHtml(s.shift_start||'')}</option>`
  ).join('');
}

// ===== ЗАЯВКА НА ЗАМЕНУ =====

async function openSwapRequest() {
  const empId = currentProfile?.employee_id;
  if(!empId) return showToast(t('req.noEmployee'));
  openModal('modal-swap-request');
  const body = document.getElementById('swap-form-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;

  const dept = currentEmployee?.department || (await myDepartment());
  const [shifts, mates] = await Promise.all([
    loadUpcomingShifts(empId),
    sb.from('employees').select('id,name').eq('department', dept).neq('status','Уволен').order('name'),
  ]);
  reqMyShifts = shifts;

  if(shifts.length === 0) {
    body.innerHTML = `<div class="empty"><div class="empty-text">${t('req.noShifts')}</div></div>`;
    return;
  }
  const partners = (mates.data || []).filter(e => e.id !== empId);
  if(partners.length === 0) {
    body.innerHTML = `<div class="empty"><div class="empty-text">${t('req.noMates')}</div></div>`;
    return;
  }

  body.innerHTML = `
    <div class="form-group"><label class="form-label" for="swap-my-date">${t('req.myShift')}</label>
      <select class="form-select" id="swap-my-date">${reqShiftOptions(shifts, shifts[0].date)}</select>
    </div>
    <div class="form-group"><label class="form-label">${t('req.swapKind')}</label>
      <div style="display:flex;gap:8px" id="swap-kind-row">
        <button type="button" onclick="setSwapKind('exchange')" id="swap-kind-exchange" class="req-kind-btn">${t('req.kindExchange')}</button>
        <button type="button" onclick="setSwapKind('cover')" id="swap-kind-cover" class="req-kind-btn">${t('req.kindCover')}</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px" id="swap-kind-hint"></div>
    </div>
    <div class="form-group"><label class="form-label" for="swap-partner">${t('req.partner')}</label>
      <select class="form-select" id="swap-partner" onchange="onSwapPartnerChange()">
        ${partners.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group" id="swap-partner-date-group" style="display:none">
      <label class="form-label" for="swap-partner-date">${t('req.partnerShift')}</label>
      <select class="form-select" id="swap-partner-date"></select>
    </div>
    <div class="form-group"><label class="form-label" for="swap-reason">${t('req.reason')}</label>
      <input class="form-input" id="swap-reason" placeholder="${t('req.reasonPh')}">
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="submitSwapRequest()">${t('req.send')}</button>`;

  await setSwapKind('exchange');
}

let reqSwapKind = 'exchange';
// Возвращает промис: список смен напарника грузится запросом, и до его конца
// в поле стоит заглушка. Отправить заявку с заглушкой вместо даты нельзя —
// поэтому у неё пустое value, а submitSwapRequest такую заявку не пропускает.
function setSwapKind(kind) {
  reqSwapKind = kind;
  ['exchange','cover'].forEach(k => {
    const btn = document.getElementById('swap-kind-'+k);
    if(!btn) return;
    const on = k === kind;
    btn.style.cssText = `flex:1;border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid ${on?'var(--gold)':'var(--border)'};background:${on?'var(--gold)':'var(--surface-2)'};color:${on?'#1a1611':'var(--text-primary)'}`;
  });
  document.getElementById('swap-kind-hint').textContent = t(kind==='exchange' ? 'req.kindExchangeHint' : 'req.kindCoverHint');
  document.getElementById('swap-partner-date-group').style.display = kind==='exchange' ? '' : 'none';
  return kind === 'exchange' ? onSwapPartnerChange() : Promise.resolve();
}

async function onSwapPartnerChange() {
  if(reqSwapKind !== 'exchange') return;
  const sel = document.getElementById('swap-partner-date');
  const partnerId = Number(document.getElementById('swap-partner').value);
  sel.innerHTML = `<option value="">${t('common.loading')}</option>`;
  reqPartnerShifts = await loadUpcomingShifts(partnerId);
  sel.innerHTML = reqPartnerShifts.length
    ? reqShiftOptions(reqPartnerShifts, reqPartnerShifts[0].date)
    : `<option value="">${t('req.partnerNoShifts')}</option>`;
}

async function submitSwapRequest() {
  const myDate = document.getElementById('swap-my-date').value;
  const partnerSel = document.getElementById('swap-partner');
  const partnerId = Number(partnerSel.value);
  const partnerName = partnerSel.options[partnerSel.selectedIndex]?.text || '';
  const partnerDate = reqSwapKind === 'exchange' ? document.getElementById('swap-partner-date').value : null;
  if(reqSwapKind === 'exchange' && !partnerDate) return showToast(t('req.partnerNoShifts'));

  const myShift = reqMyShifts.find(s => s.date === myDate);
  try {
    const { error } = await sb.from('shift_requests').insert({
      kind: 'swap',
      filial: myShift?.filial || currentFilial,
      department: currentEmployee?.department || null,
      employee_id: currentProfile.employee_id,
      employee_name: currentEmployee?.name || currentProfile?.name || '',
      date: myDate,
      swap_kind: reqSwapKind,
      partner_id: partnerId,
      partner_name: partnerName,
      partner_date: partnerDate,
      reason: document.getElementById('swap-reason').value.trim() || null,
    });
    if(error) throw error;

    closeModal('modal-swap-request');
    showToast(t('req.sent'));
    const what = reqSwapKind === 'exchange'
      ? `${reqDayLabel(myDate)} ⇄ ${reqDayLabel(partnerDate)}`
      : `${reqDayLabel(myDate)} → ${tgEscape(partnerName)}`;
    notifyApprovers(`🔄 <b>Заявка на замену</b>\n\n👤 ${tgEscape(currentEmployee?.name||'')}\n${what}\n\nОткрой приложение: https://slon-app.vercel.app`);
    loadRequestsCard();
  } catch(e) {
    // 23505 — уникальный индекс на одну необработанную заявку в день
    showToast(e?.code === '23505' ? t('req.dupe') : t('common.error') + (e?.message || e));
  }
}

// ===== ЗАЯВКА ОБ ОПОЗДАНИИ =====

async function openLateRequest() {
  const empId = currentProfile?.employee_id;
  if(!empId) return showToast(t('req.noEmployee'));
  openModal('modal-late-request');
  const body = document.getElementById('late-form-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;

  reqMyShifts = await loadUpcomingShifts(empId);
  if(reqMyShifts.length === 0) {
    body.innerHTML = `<div class="empty"><div class="empty-text">${t('req.noShifts')}</div></div>`;
    return;
  }
  // Предупреждают почти всегда о ближайшей смене, поэтому она и выбрана
  body.innerHTML = `
    <div class="form-group"><label class="form-label" for="late-date">${t('req.myShift')}</label>
      <select class="form-select" id="late-date">${reqShiftOptions(reqMyShifts, reqMyShifts[0].date)}</select>
    </div>
    <div class="form-group"><label class="form-label" for="late-minutes">${t('req.lateHowLong')}</label>
      <select class="form-select" id="late-minutes">
        ${[10,15,20,30,45,60,90,120].map(m=>`<option value="${m}">${t('req.lateMin',{min:m})}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label class="form-label" for="late-reason">${t('req.reason')}</label>
      <input class="form-input" id="late-reason" placeholder="${t('req.lateReasonPh')}">
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;line-height:1.5">${t('req.lateHint')}</div>
    <button class="btn btn-primary" style="width:100%" onclick="submitLateRequest()">${t('req.send')}</button>`;
}

async function submitLateRequest() {
  const date = document.getElementById('late-date').value;
  const minutes = Number(document.getElementById('late-minutes').value);
  const reason = document.getElementById('late-reason').value.trim();
  const shift = reqMyShifts.find(s => s.date === date);
  try {
    const { error } = await sb.from('shift_requests').insert({
      kind: 'late',
      filial: shift?.filial || currentFilial,
      department: currentEmployee?.department || null,
      employee_id: currentProfile.employee_id,
      employee_name: currentEmployee?.name || currentProfile?.name || '',
      date,
      late_minutes: minutes,
      reason: reason || null,
    });
    if(error) throw error;

    closeModal('modal-late-request');
    showToast(t('req.sent'));
    notifyApprovers(`⏰ <b>Предупреждение об опоздании</b>\n\n👤 ${tgEscape(currentEmployee?.name||'')}\n📅 ${reqDayLabel(date)} · смена ${tgEscape(shift?.shift_start||'')}\n🕐 Опоздает на ${minutes} мин${reason?`\n📝 ${tgEscape(reason)}`:''}\n\nОткрой приложение: https://slon-app.vercel.app`);
    loadRequestsCard();
  } catch(e) {
    showToast(e?.code === '23505' ? t('req.dupe') : t('common.error') + (e?.message || e));
  }
}

// Заявка бесполезна, если о ней никто не узнал: шлём тем же, кто и решает —
// старшим своего цеха и управляющим.
async function notifyApprovers(msg) {
  try {
    const dept = currentEmployee?.department;
    const myLevel = (typeof JOB_TITLE_LEVEL !== 'undefined' ? (JOB_TITLE_LEVEL[currentEmployee?.role]||0) : 0);
    if(dept) await notifyDeptSeniors(dept, myLevel, msg, 'request');
    await notifyAdminsAll(msg, 'request');
  } catch(e) { console.error('notify request', e); }
}

// ===== СПИСОК ЗАЯВОК =====

async function openRequestsInbox() {
  openModal('modal-requests');
  await renderRequestsInbox();
}

async function renderRequestsInbox() {
  const body = document.getElementById('requests-inbox-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    // Политики базы уже отдают только то, что человеку положено видеть:
    // свои заявки, заявки своего цеха и те, где он назван напарником.
    const weekAgo = ymdLocal(new Date(Date.now() - 7 * 864e5));
    const { data, error } = await sb.from('shift_requests').select('*')
      .gte('date', weekAgo).order('status').order('date');
    if(error) throw error;
    reqInboxRows = data || [];

    const pending = reqInboxRows.filter(r => r.status === 'pending');
    const decided = reqInboxRows.filter(r => r.status !== 'pending').slice(0, 20);
    if(reqInboxRows.length === 0) {
      body.innerHTML = `<div class="empty"><div class="empty-icon">📥</div><div class="empty-text">${t('req.empty')}</div></div>`;
      return;
    }
    body.innerHTML =
      (pending.length ? `<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:4px 0 8px">${t('req.pendingTitle')}</div>` + pending.map(requestCard).join('') : '') +
      (decided.length ? `<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:16px 0 8px">${t('req.decidedTitle')}</div>` + decided.map(requestCard).join('') : '');
  } catch(e) {
    body.innerHTML = `<div class="empty"><div class="empty-text">${t('common.error')}${escapeHtml(e?.message||String(e))}</div></div>`;
  }
}

function requestCard(r) {
  const mine = r.employee_id === currentProfile?.employee_id;
  const head = r.kind === 'late'
    ? `⏰ ${t('req.lateTitle')} · ${t('req.lateMin',{min:r.late_minutes})}`
    : (r.swap_kind === 'exchange' ? `🔄 ${t('req.exchangeTitle')}` : `🔄 ${t('req.coverTitle')}`);
  const what = r.kind === 'late'
    ? reqDayLabel(r.date)
    : (r.swap_kind === 'exchange'
        ? `${reqDayLabel(r.date)} ⇄ ${escapeHtml(r.partner_name||'')} · ${reqDayLabel(r.partner_date)}`
        : `${reqDayLabel(r.date)} → ${escapeHtml(r.partner_name||'')}`);

  const badge = { pending:'', approved:`<span class="badge badge-green">${t('req.approved')}</span>`,
                  rejected:`<span class="badge badge-red">${t('req.rejected')}</span>`,
                  cancelled:`<span class="badge">${t('req.cancelled')}</span>` }[r.status] || '';

  let actions = '';
  if(canDecideRequest(r)) {
    actions = `<div style="display:flex;gap:8px;margin-top:10px">
      <button onclick="decideRequest(${r.id},'approved')" style="flex:1;background:var(--gold);color:#1a1611;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer">${t('req.approve')}</button>
      <button onclick="decideRequest(${r.id},'rejected')" style="flex:1;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:13px;cursor:pointer">${t('req.reject')}</button>
    </div>`;
  } else if(mine && r.status === 'pending') {
    actions = `<button onclick="decideRequest(${r.id},'cancelled')" style="width:100%;margin-top:10px;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:13px;cursor:pointer">${t('req.cancel')}</button>`;
  }

  return `<div style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${head}</div>${badge}
    </div>
    <div style="font-size:12px;color:var(--text-primary);margin-top:6px">👤 ${escapeHtml(r.employee_name||'')}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-top:2px">📅 ${what}</div>
    ${r.reason?`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">📝 ${escapeHtml(r.reason)}</div>`:''}
    ${r.decided_by_name?`<div style="font-size:11px;color:var(--text-muted);margin-top:6px">${t('req.decidedBy',{who:escapeHtml(r.decided_by_name)})}</div>`:''}
    ${actions}
  </div>`;
}

async function decideRequest(id, status) {
  const r = reqInboxRows.find(x => x.id === id);
  if(!r) return;
  if(status !== 'cancelled') {
    const approve = status === 'approved';
    const ok = await confirmDialog(t(approve ? 'req.confirmApprove' : 'req.confirmReject'), {
      title: t('req.confirmTitle'),
      okText: t(approve ? 'req.approve' : 'req.reject'),
      danger: !approve,
    });
    if(!ok) return;
  }
  try {
    const { error } = await sb.from('shift_requests').update({ status }).eq('id', id);
    if(error) throw error;   // база сама не даст одобрить то, чего нет в графике
    showToast(t('req.decisionSaved'));
    await renderRequestsInbox();
    loadRequestsCard();
    if(status === 'cancelled') return;

    // Автору — решение, напарнику — только состоявшуюся замену: отказ его не касается
    const verdict = status === 'approved' ? '✅ одобрена' : '❌ отклонена';
    const what = r.kind === 'late'
      ? `⏰ опоздание ${r.late_minutes} мин · ${reqDayLabel(r.date)}`
      : `🔄 замена ${reqDayLabel(r.date)}`;
    const { data: prof } = await sb.from('profiles').select('user_id').eq('employee_id', r.employee_id).maybeSingle();
    if(prof?.user_id) {
      const tail = (status === 'approved' && r.kind === 'late') ? '\n\nШтраф за это опоздание не начислится.' : '';
      await notifyEmployee(prof.user_id, `📋 <b>Заявка ${verdict}</b>\n\n${what}${tail}`, 'request');
    }
    if(status === 'approved' && r.kind === 'swap' && r.partner_id) {
      const { data: pp } = await sb.from('profiles').select('user_id').eq('employee_id', r.partner_id).maybeSingle();
      if(pp?.user_id) await notifyEmployee(pp.user_id, `🔄 <b>График изменён</b>\n\n${tgEscape(r.employee_name||'')} — замена на ${reqDayLabel(r.date)}. Проверь свой график.`, 'request');
    }
    if(typeof loadSchedule === 'function' && document.getElementById('screen-schedule')?.classList.contains('active')) loadSchedule();
  } catch(e) {
    showToast(t('common.error') + (e?.message || e));
  }
}

// ===== КАРТОЧКА НА ГЛАВНОЙ =====
// Сотруднику — две кнопки, ответственному — сколько заявок ждёт решения.
// Один запрос: pending-заявки, которые человеку вообще видны (остальное отсеяли
// политики базы), из них считаем и своё, и чужое.
async function loadRequestsCard() {
  const el = document.getElementById('home-requests-card');
  if(!el) return;
  // Подать заявку может только тот, кто есть в штате; решать — и непривязанный
  // аккаунт управляющего, поэтому карточку рисуем в обоих случаях.
  const canApply = !!currentProfile?.employee_id;
  try {
    const { data } = await sb.from('shift_requests').select('id,employee_id,department,status,kind')
      .eq('status','pending');
    const rows = data || [];
    const toDecide = rows.filter(canDecideRequest).length;
    const myPending = canApply ? rows.filter(r => r.employee_id === currentProfile.employee_id).length : 0;
    // Список заявок открывается и когда решать нечего: посмотреть, чем кончились
    // прошлые, нужно не реже, чем одобрить новую.
    const canDecideAny = canEditData() || !!myLeadDept();
    if(!canApply && !canDecideAny) { el.innerHTML = ''; return; }
    const inboxLabel = toDecide ? t('req.toDecide',{n:toDecide})
                     : myPending ? t('req.myPending',{n:myPending})
                     : t('req.openInbox');

    const btn = (onclick, label) =>
      `<button onclick="${onclick}" style="flex:1;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer">${label}</button>`;

    el.innerHTML = `<div class="card" style="margin-bottom:12px">
      ${canApply ? `<div style="display:flex;gap:8px">
        ${btn('openLateRequest()', '⏰ ' + t('req.lateBtn'))}
        ${btn('openSwapRequest()', '🔄 ' + t('req.swapBtn'))}
      </div>` : ''}
      <button onclick="openRequestsInbox()" style="width:100%;${canApply?'margin-top:8px;':''}background:none;border:none;color:var(--gold-dark);font-size:12px;font-weight:600;cursor:pointer;padding:4px">
        ${inboxLabel} →
      </button>
    </div>`;
  } catch(e) { console.error('requests card', e); }
}
