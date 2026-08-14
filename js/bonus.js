// ============ ПРОЦЕНТЫ ОФИЦИАНТОВ (BONUS) ============
// Неделя (пн–вс) — расчётный период. До 2% от личной выручки без кальяна,
// четыре блока по 0,5%. Пороги и сам расчёт — в core.js (WAITER_BONUS/computeWaiterBonus).

let bonusTab = 'results';
let bonusWeek = null;      // понедельник выбранной недели
let bonusData = null;      // { emps, stats, points, lates }

function bonusCanManage() { return canEditData(); }
function bonusMyEmpId() { return currentProfile?.employee_id || null; }
// Официант видит только себя; руководство и владелец — весь филиал
function bonusSeesAll() { return canEditData() || isBoss(); }

async function loadBonus() {
  if(!bonusWeek) bonusWeek = weekStartOf();
  const sub = document.getElementById('bonus-subtitle');
  if(sub) sub.textContent = getFilialName(currentFilial);
  // Банк вопросов — только руководству
  const quizTab = document.getElementById('bonus-tab-quiz');
  if(quizTab) quizTab.style.display = (canEditData() || isBoss()) ? 'block' : 'none';
  if(bonusTab === 'quiz' && !(canEditData() || isBoss())) bonusTab = 'results';
  renderBonusWeekNav();
  switchBonusTab(bonusTab);
}

function renderBonusWeekNav() {
  const el = document.getElementById('bonus-week-nav');
  if(!el) return;
  const from = fmtLocale(new Date(bonusWeek), {day:'numeric', month:'short'});
  const to   = fmtLocale(new Date(weekEndOf(bonusWeek)), {day:'numeric', month:'short'});
  const isCurrent = bonusWeek === weekStartOf();
  el.innerHTML = `
    <button onclick="bonusNavWeek(-1)" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:15px;cursor:pointer">‹</button>
    <div style="flex:1;text-align:center">
      <div style="font-size:14px;font-weight:700;color:var(--text-primary)">${from} – ${to}</div>
      <div style="font-size:11px;color:var(--text-muted)">${isCurrent ? t('bonus.thisWeek') : t('bonus.week')}</div>
    </div>
    <button onclick="bonusNavWeek(1)" ${isCurrent?'disabled':''} style="background:var(--surface-2);color:${isCurrent?'var(--text-muted)':'var(--text-primary)'};border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:15px;cursor:${isCurrent?'default':'pointer'}">›</button>`;
}

function bonusNavWeek(delta) {
  const next = addWeeks(bonusWeek, delta);
  if(next > weekStartOf()) return; // в будущее не ходим
  bonusWeek = next;
  bonusData = null;
  renderBonusWeekNav();
  switchBonusTab(bonusTab);
}

function switchBonusTab(tab) {
  bonusTab = tab;
  ['results','points','quiz'].forEach(k=>{
    const el = document.getElementById('bonus-tab-'+k);
    if(!el) return;
    el.style.background = tab===k ? 'var(--gold-dark)' : 'var(--surface-2)';
    el.style.color      = tab===k ? '#fff' : 'var(--text-primary)';
  });
  if(tab==='results') renderBonusResults();
  else if(tab==='points') renderBonusPoints();
  else renderQuizBank();
}

// Суббота этой недели уже прошла? До неё аттестацию не спрашиваем, после — не сдал = 0.
function weekSaturdayPassed(weekStart) {
  const sat = new Date(weekStart); sat.setDate(sat.getDate() + 5); // пн + 5 = сб
  return businessToday() > ymdLocal(sat);
}
// Балл аттестации за неделю: сначала пройденный в приложении тест, потом ручной ввод,
// потом — «не сдавал»: 0, если суббота прошла, и null, если ещё нет.
// Балл из 100: вопросов в тесте может быть не десять (руководство назначает число),
// поэтому считаем долю правильных, а не score × 10.
function attestationForWeek(attempt, weekStart, manualScore) {
  if(attempt && attempt.finished_at != null) {
    const total = Number(attempt.q_total) || 10;
    return Math.round((Number(attempt.score) || 0) / total * 100);
  }
  if(manualScore != null) return manualScore;
  return weekSaturdayPassed(weekStart) ? 0 : null;
}

// Все данные недели одним заходом; кэшируем до смены недели/правки
async function loadBonusWeek() {
  if(bonusData) return bonusData;
  const from = bonusWeek, to = weekEndOf(bonusWeek);
  const [empR, statsR, pointsR, attR, quizR] = await Promise.all([
    sb.from('employees_view').select('id,name,department,filials,status').eq('department','Официанты').order('name'),
    sb.from('waiter_week_stats').select('*').eq('filial', currentFilial).eq('week_start', from),
    sb.from('waiter_points').select('*').eq('filial', currentFilial).gte('date', from).lte('date', to).order('created_at', {ascending:false}),
    sb.from('attendance').select('employee_id,date,is_late,late_excused').eq('filial', currentFilial).gte('date', from).lte('date', to),
    // practice = тренировочный прогон: в проценты не идёт, поэтому не берём его вовсе
    sb.from('quiz_attempts').select('employee_id,score,passed,finished_at,q_total').eq('week_start', from).eq('superseded', false).eq('practice', false),
  ]);
  let emps = (empR.data||[]).filter(e =>
    (e.filials && e.filials.length ? e.filials : ['istikbol','chekhov']).includes(currentFilial) && e.status !== 'Уволен');
  if(!bonusSeesAll()) emps = emps.filter(e => e.id === bonusMyEmpId());

  const stats = {}; (statsR.data||[]).forEach(s => { stats[s.employee_id] = s; });
  const points = {}; (pointsR.data||[]).forEach(p => { (points[p.employee_id] = points[p.employee_id] || []).push(p); });
  // Опоздание, о котором предупредили заранее и заявку одобрили, балл не снимает
  const lates = {}; (attR.data||[]).forEach(a => { if(a.is_late && !a.late_excused) lates[a.employee_id] = (lates[a.employee_id]||0) + 1; });
  const quiz = {}; (quizR.data||[]).forEach(q => { quiz[q.employee_id] = q; });
  bonusData = { emps, stats, points, lates, quiz };
  return bonusData;
}

// Итог по официанту: ручные баллы + опоздания (они и есть дисциплина) + цифры iiko
function bonusRowFor(empId, d) {
  const st = d.stats[empId] || {};
  const pts = d.points[empId] || [];
  const svc  = pts.filter(p=>p.category==='service').reduce((s,p)=>s+(Number(p.points)||0),0);
  const disc = pts.filter(p=>p.category==='discipline').reduce((s,p)=>s+(Number(p.points)||0),0);
  const late = d.lates[empId] || 0; // опоздания подтягиваются из отметок прихода автоматически
  const quiz = (d.quiz || {})[empId] || null;
  const attestation = attestationForWeek(quiz, bonusWeek, st.attestation_score);
  const res = computeWaiterBonus({
    revenue: st.revenue, checks: st.checks, dishes: st.dishes, desserts: st.desserts,
    hasStats: !!d.stats[empId],   // строки за неделю нет — блоки iiko не оцениваем
    attestation, servicePoints: svc, disciplinePoints: disc + late,
  });
  return { st, pts, svc, disc, late, quiz, attestation, res };
}

function fmtPct(n) { return String(n).replace('.', ','); }
function fmtRatio(n) { return (Math.round(n*100)/100).toFixed(2).replace(/\.?0+$/,'').replace('.', ','); }

function bonusCatChip(cat, row) {
  const ok = cat.ok;
  const label = t('bonus.cat.'+cat.key);
  // «Не оценено» — данных iiko за неделю нет. Блок засчитан, но помечен отдельно:
  // зелёным его показывать нельзя, иначе не видно, что цифру никто не вносил.
  if(cat.notRated) {
    return `<div style="flex:1 1 46%;min-width:150px;background:rgba(138,106,47,0.12);border-radius:10px;padding:8px 10px">
      <div style="font-size:11px;color:var(--text-muted)">◻ ${label}</div>
      <div style="font-size:13px;font-weight:700;color:#8a6a2f">${t('bonus.notRated')}</div>
    </div>`;
  }
  let val;
  if(cat.key==='fill' || cat.key==='dessert') val = `${fmtRatio(cat.value)} / ${fmtRatio(cat.target)}`;
  else val = t('bonus.pointsOf', {n: cat.value, max: cat.target});
  const extra = (cat.key==='service' && cat.att != null) ? ` · ${t('bonus.attShort',{n:cat.att})}` : '';
  return `<div style="flex:1 1 46%;min-width:150px;background:${ok?'rgba(59,109,17,0.10)':'rgba(161,60,60,0.10)'};border-radius:10px;padding:8px 10px">
    <div style="font-size:11px;color:var(--text-muted)">${ok?'✓':'✗'} ${label}</div>
    <div style="font-size:13px;font-weight:700;color:${ok?'#3B6D11':'#A13C3C'}">${val}${extra}</div>
  </div>`;
}

async function renderBonusResults() {
  const c = document.getElementById('bonus-content');
  c.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const d = await loadBonusWeek();
    if(d.emps.length === 0) {
      c.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">🍽️</div><div class="empty-text">${t('bonus.noWaiters')}</div></div></div>`;
      return;
    }
    const manage = bonusCanManage();
    let totalAmount = 0;
    const cards = d.emps.map(e => {
      const row = bonusRowFor(e.id, d);
      totalAmount += row.res.amount;
      const noData = !row.st.checks;
      return `<div class="card" style="padding:12px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div class="avatar ${getColor(e.name)}">${escapeHtml(getInitials(e.name))}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700;color:var(--text-primary)">${escapeHtml(e.name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${noData ? t('bonus.noIiko') : t('bonus.revenueChecks',{r:formatNum(Math.round(row.st.revenue||0)), n:row.st.checks})}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:800;color:${row.res.percent>0?'var(--gold-dark)':'var(--text-muted)'}">${fmtPct(row.res.percent)}%</div>
            <div style="font-size:12px;font-weight:700;color:var(--text-primary);white-space:nowrap">${formatNum(row.res.amount)}</div>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${row.res.cats.map(x=>bonusCatChip(x,row)).join('')}</div>
        ${bonusAttestationLine(e, row, manage)}
        ${row.late>0?`<div style="font-size:11px;color:var(--text-muted);margin-top:8px">${t('bonus.lateAuto',{n:row.late})}</div>`:''}
        ${manage?`<button onclick="openWaiterStats(${e.id},'${escJsAttr(e.name)}')" style="width:100%;margin-top:10px;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:9px;font-size:13px;font-weight:600;cursor:pointer">${t('bonus.editStats')}</button>`:''}
      </div>`;
    }).join('');

    // Если по кому-то нет выгрузки iiko — говорим об этом прямо: два блока
    // засчитаны автоматически, и цифры в них ничего не значат, пока их не внесут.
    const noStats = d.emps.filter(e => !d.stats[e.id]).length;
    const iikoWarn = (noStats && bonusCanManage())
      ? `<div class="card" style="padding:10px 12px;margin-bottom:10px;background:rgba(138,106,47,0.12);border:1px solid rgba(138,106,47,0.3)">
           <div style="font-size:12px;color:#8a6a2f;line-height:1.5">⚠️ ${t('bonus.iikoWarn')}</div>
         </div>`
      : '';

    const totalCard = (bonusSeesAll() && d.emps.length>1)
      ? `<div class="card" style="padding:12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
           <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${t('bonus.weekTotal')}</div>
           <div style="font-size:16px;font-weight:800;color:var(--gold-dark)">${formatNum(totalAmount)}</div>
         </div>` : '';

    c.innerHTML = iikoWarn + totalCard + cards + bonusRulesCard();
  } catch(e) {
    c.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('bonus.loadErr')}</div></div></div>`;
  }
}

// Строка про аттестацию: результат теста, «не сдавал» или «будет в субботу» + пересдача
function bonusAttestationLine(emp, row, manage) {
  const q = row.quiz;
  let text, color = 'var(--text-muted)';
  if(q && q.finished_at) {
    text = t('bonus.attResult', {score: q.score, total: q.q_total || 10});
    color = q.passed ? '#3B6D11' : '#A13C3C';
  } else if(row.st.attestation_score != null) {
    text = t('bonus.attManual', {n: row.st.attestation_score});
  } else if(weekSaturdayPassed(bonusWeek)) {
    text = t('bonus.attMissed');
    color = '#A13C3C';
  } else {
    text = t('bonus.attSaturday');
  }
  // Кнопка есть ВСЕГДА, пока управляющий смотрит: назначить тест можно и тому,
  // кто на этой неделе ещё не начинал — раньше в этом случае она не показывалась,
  // и открыть аттестацию вне субботы было нельзя.
  const label = q ? t('bonus.attRetake') : t('bonus.attAssign');
  const retake = manage ? ` <span onclick="reopenQuiz(${emp.id},'${escJsAttr(emp.name)}')" style="color:var(--gold-dark);cursor:pointer;font-weight:600">${label}</span>` : '';
  return `<div style="font-size:11px;margin-top:8px;color:${color}">🎓 ${text}${retake}</div>`;
}

// Открыть официанту пересдачу: старая попытка гасится, новая доступна сразу (не только в субботу)
async function reopenQuiz(empId, empName) {
  if(!canEditData()) return showToast(t('bonus.onlyMgr'));
  const had = !!((bonusData?.quiz || {})[empId]);
  const ask = had ? t('bonus.attRetakeConfirm', {name: empName}) : t('bonus.attAssignConfirm', {name: empName});
  if(!await confirmDialog(ask)) return;
  try {
    const { data, error } = await sb.rpc('quiz_reopen', { p_employee_id: empId, p_week_start: bonusWeek });
    if(error) return showToast(t('common.error')+error.message);
    if(data?.error) return showToast(t('common.error')+data.error);
    showToast(data?.replaced ? t('bonus.attRetakeDone') : t('bonus.attAssignDone', {name: empName}));
    bonusData = null;
    switchBonusTab(bonusTab);
  } catch(e) { showToast(t('common.error')+e.message); }
}

function bonusRulesCard() {
  const b = WAITER_BONUS;
  return `<div class="card" style="padding:12px">
    <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:8px">${t('bonus.rulesTitle',{max:fmtPct(b.maxPercent)})}</div>
    <div style="font-size:12px;color:var(--text-muted);line-height:1.7">
      • ${t('bonus.cat.fill')} — ${t('bonus.ruleFill',{n:fmtRatio(b.dishesPerCheck), p:fmtPct(b.stepPercent)})}<br>
      • ${t('bonus.cat.service')} — ${t('bonus.ruleService',{n:b.servicePointsLimit, a:b.attestationPass, p:fmtPct(b.stepPercent)})}<br>
      • ${t('bonus.cat.discipline')} — ${t('bonus.ruleDiscipline',{n:b.disciplinePointsLimit, p:fmtPct(b.stepPercent)})}<br>
      • ${t('bonus.cat.dessert')} — ${t('bonus.ruleDessert',{n:Math.round(b.dessertsPerCheck*100), p:fmtPct(b.stepPercent)})}
    </div>
  </div>`;
}

// ===== Вкладка «Баллы» =====
async function renderBonusPoints() {
  const c = document.getElementById('bonus-content');
  c.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const d = await loadBonusWeek();
    if(d.emps.length === 0) {
      c.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">🍽️</div><div class="empty-text">${t('bonus.noWaiters')}</div></div></div>`;
      return;
    }
    const manage = bonusCanManage();
    const b = WAITER_BONUS;
    c.innerHTML = d.emps.map(e => {
      const row = bonusRowFor(e.id, d);
      const svcBad  = row.svc > b.servicePointsLimit;
      const discBad = (row.disc + row.late) > b.disciplinePointsLimit;
      return `<div class="card" style="padding:12px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar ${getColor(e.name)}">${escapeHtml(getInitials(e.name))}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700;color:var(--text-primary)">${escapeHtml(e.name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">
              <span style="color:${svcBad?'#A13C3C':'var(--text-muted)'}">${t('bonus.cat.service')}: ${row.svc}/${b.servicePointsLimit}</span> ·
              <span style="color:${discBad?'#A13C3C':'var(--text-muted)'}">${t('bonus.cat.discipline')}: ${row.disc + row.late}/${b.disciplinePointsLimit}</span>
            </div>
          </div>
          ${manage?`<button onclick="openAddPoint(${e.id},'${escJsAttr(e.name)}')" style="background:#F6E7E7;color:#A13C3C;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer">${t('bonus.addPoint')}</button>`:''}
        </div>
        ${row.late>0?`<div style="font-size:11px;color:var(--text-muted);margin-top:8px">${t('bonus.lateAuto',{n:row.late})}</div>`:''}
        ${row.pts.length?`<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">${row.pts.map(p=>`
          <div style="display:flex;align-items:flex-start;gap:8px;padding:4px 0">
            <div style="flex:1">
              <div style="font-size:12px;color:var(--text-primary)">−${p.points} · ${t('bonus.reason.'+p.reason)}${p.note?` — ${escapeHtml(p.note)}`:''}</div>
              <div style="font-size:11px;color:var(--text-muted)">${fmtLocale(new Date(p.date),{day:'numeric',month:'short'})} · ${t('bonus.cat.'+p.category)} · ${escapeHtml(p.created_by_name||'')}</div>
            </div>
            ${manage?`<span onclick="deleteWaiterPoint(${p.id})" style="color:#A32D2D;cursor:pointer;font-weight:700">✕</span>`:''}
          </div>`).join('')}</div>`:''}
      </div>`;
    }).join('');
  } catch(e) {
    c.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('bonus.loadErr')}</div></div></div>`;
  }
}

// ===== Ввод показателей iiko + балл аттестации =====
let bonusStatsEmp = null, bonusStatsName = '';
async function openWaiterStats(empId, empName) {
  if(!bonusCanManage()) return showToast(t('bonus.onlyMgr'));
  bonusStatsEmp = empId; bonusStatsName = empName;
  document.getElementById('ws-emp-name').textContent = empName;
  document.getElementById('ws-week').textContent =
    `${fmtLocale(new Date(bonusWeek),{day:'numeric',month:'short'})} – ${fmtLocale(new Date(weekEndOf(bonusWeek)),{day:'numeric',month:'short'})}`;
  const st = (bonusData?.stats || {})[empId] || {};
  const set = (id,v) => { document.getElementById(id).value = (v==null?'':v); };
  set('ws-revenue', st.revenue || ''); set('ws-checks', st.checks || '');
  set('ws-dishes', st.dishes || '');   set('ws-desserts', st.desserts || '');
  set('ws-attestation', st.attestation_score);
  openModal('modal-waiter-stats');
}

async function saveWaiterStats() {
  if(!bonusCanManage()) return showToast(t('bonus.onlyMgr'));
  const num = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? 0 : v; };
  const attRaw = document.getElementById('ws-attestation').value.trim();
  const att = attRaw === '' ? null : parseInt(attRaw);
  if(att !== null && (isNaN(att) || att < 0 || att > 100)) return showToast(t('bonus.attRange'));
  try {
    const { error } = await sb.from('waiter_week_stats').upsert({
      employee_id: bonusStatsEmp, employee_name: bonusStatsName, filial: currentFilial,
      week_start: bonusWeek,
      revenue: num('ws-revenue'), checks: Math.round(num('ws-checks')),
      dishes: Math.round(num('ws-dishes')), desserts: Math.round(num('ws-desserts')),
      attestation_score: att,
      updated_by: currentUser?.id, updated_by_name: currentProfile?.name || currentUser?.email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,week_start' });
    if(error) return showToast(t('common.error')+error.message);
    closeModal('modal-waiter-stats');
    showToast(t('bonus.statsSaved'));
    bonusData = null;
    switchBonusTab(bonusTab);
  } catch(e) { showToast(t('common.error')+e.message); }
}

// ===== Штрафной балл =====
let bonusPointEmp = null, bonusPointName = '', bonusPointCat = 'service', bonusPointReason = null;
function openAddPoint(empId, empName) {
  if(!bonusCanManage()) return showToast(t('bonus.onlyMgr'));
  bonusPointEmp = empId; bonusPointName = empName;
  bonusPointCat = 'service'; bonusPointReason = null;
  document.getElementById('wp-emp-name').textContent = empName;
  document.getElementById('wp-note').value = '';
  document.getElementById('wp-points').value = 1;
  renderPointPicker();
  openModal('modal-waiter-point');
}
function setPointCategory(cat) { bonusPointCat = cat; bonusPointReason = null; renderPointPicker(); }
function setPointReason(code) { bonusPointReason = code; renderPointPicker(); }
function renderPointPicker() {
  const catBtn = (cat, icon) => `<button onclick="setPointCategory('${cat}')" style="flex:1;padding:9px;border-radius:10px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:${bonusPointCat===cat?'var(--gold-dark)':'var(--surface-2)'};color:${bonusPointCat===cat?'#fff':'var(--text-primary)'}">${icon} ${t('bonus.cat.'+cat)}</button>`;
  document.getElementById('wp-categories').innerHTML = catBtn('service','🎯') + catBtn('discipline','🕐');
  document.getElementById('wp-reasons').innerHTML = WAITER_POINT_REASONS[bonusPointCat].map(code =>
    `<button onclick="setPointReason('${code}')" style="padding:8px 12px;border-radius:20px;border:1px solid var(--border);font-size:12px;cursor:pointer;background:${bonusPointReason===code?'#F6E7E7':'var(--surface)'};color:${bonusPointReason===code?'#A13C3C':'var(--text-primary)'};font-weight:${bonusPointReason===code?'700':'500'}">${t('bonus.reason.'+code)}</button>`
  ).join('');
}
async function saveWaiterPoint() {
  if(!bonusCanManage()) return showToast(t('bonus.onlyMgr'));
  if(!bonusPointReason) return showToast(t('bonus.pickReason'));
  const points = parseInt(document.getElementById('wp-points').value) || 1;
  if(points < 1) return showToast(t('bonus.pointsMin'));
  const note = document.getElementById('wp-note').value.trim();
  try {
    const { error } = await sb.from('waiter_points').insert({
      employee_id: bonusPointEmp, employee_name: bonusPointName, filial: currentFilial,
      date: businessToday(), category: bonusPointCat, points, reason: bonusPointReason, note: note || null,
      created_by: currentUser?.id, created_by_name: currentProfile?.name || currentUser?.email,
    });
    if(error) return showToast(t('common.error')+error.message);
    closeModal('modal-waiter-point');
    showToast(t('bonus.pointAdded'));
    bonusData = null;
    switchBonusTab(bonusTab);
  } catch(e) { showToast(t('common.error')+e.message); }
}
async function deleteWaiterPoint(id) {
  if(!bonusCanManage()) return;
  if(!await confirmDialog(t('bonus.removePoint'))) return;
  try {
    const { error } = await sb.from('waiter_points').delete().eq('id', id);
    if(error) return showToast(t('common.error')+error.message);
    bonusData = null;
    switchBonusTab(bonusTab);
  } catch(e) { showToast(t('common.error')+e.message); }
}

// Проценты официантов за месяц — для зарплатной ведомости (js/hr.js).
// Неделя относится к тому месяцу, в котором её понедельник.
async function loadWaiterBonusForMonth(firstStr, lastStr) {
  const out = {}; // employee_id -> { percentSum, amount, weeks }
  try {
    const weekFrom = weekStartOf(firstStr), weekTo = weekStartOf(lastStr);
    const [statsR, pointsR, attR, quizR] = await Promise.all([
      sb.from('waiter_week_stats').select('*').eq('filial', currentFilial).gte('week_start', firstStr).lte('week_start', lastStr),
      sb.from('waiter_points').select('employee_id,date,category,points').eq('filial', currentFilial).gte('date', weekFrom).lte('date', weekEndOf(weekTo)),
      sb.from('attendance').select('employee_id,date,is_late,late_excused').eq('filial', currentFilial).gte('date', weekFrom).lte('date', weekEndOf(weekTo)),
      sb.from('quiz_attempts').select('employee_id,week_start,score,passed,finished_at,q_total').gte('week_start', weekFrom).lte('week_start', weekTo).eq('superseded', false).eq('practice', false),
    ]);
    const quizByWeek = {}; (quizR.data||[]).forEach(q => { quizByWeek[q.employee_id+'_'+q.week_start] = q; });
    // баллы и опоздания раскладываем по неделям
    const byWeek = {}; // empId_weekStart -> { svc, disc }
    const bump = (empId, date, cat, n) => {
      const k = empId + '_' + weekStartOf(date);
      const w = byWeek[k] = byWeek[k] || { svc:0, disc:0 };
      if(cat === 'service') w.svc += n; else w.disc += n;
    };
    (pointsR.data||[]).forEach(p => bump(p.employee_id, p.date, p.category, Number(p.points)||0));
    (attR.data||[]).forEach(a => { if(a.is_late && !a.late_excused) bump(a.employee_id, a.date, 'discipline', 1); });

    (statsR.data||[]).forEach(s => {
      const w = byWeek[s.employee_id + '_' + s.week_start] || { svc:0, disc:0 };
      const res = computeWaiterBonus({
        revenue: s.revenue, checks: s.checks, dishes: s.dishes, desserts: s.desserts,
        attestation: attestationForWeek(quizByWeek[s.employee_id+'_'+s.week_start], s.week_start, s.attestation_score),
        servicePoints: w.svc, disciplinePoints: w.disc,
      });
      const acc = out[s.employee_id] = out[s.employee_id] || { amount:0, weeks:0, percentSum:0 };
      acc.amount += res.amount;
      acc.percentSum += res.percent;
      acc.weeks += 1;
    });
  } catch(e) { /* таблиц ещё нет — ведомость работает как раньше */ }
  return out;
}
