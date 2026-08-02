// ============ АТТЕСТАЦИЯ ПО МЕНЮ (QUIZ) ============
// 10 случайных вопросов, 8 правильных (80%) = сдал. Проходится по субботам.
// Вопросы и проверку ответов выдаёт сервер (функции quiz_start/quiz_submit),
// поэтому правильные ответы физически не попадают в телефон до конца теста.
//
// Руководство может назначить тест с другим числом вопросов и пометкой
// «тренировочная» — такая попытка не идёт в проценты и не расходует субботнюю.
// Поэтому число вопросов и порог сдачи берём из ответа сервера, а константы
// ниже — только значения по умолчанию для текстов.

const QUIZ_TOTAL = 10;
const QUIZ_PASS = 8;
const quizPassFor = total => Math.max(1, Math.ceil((total || QUIZ_TOTAL) * 0.8));

let quizAttemptId = null, quizQuestions = [], quizAnswers = {}, quizIndex = 0;
let quizTotal = QUIZ_TOTAL, quizPass = QUIZ_PASS, quizPractice = false, quizAreas = null;

// Тест может быть сужен до областей (бар / кухня / сервис) — говорим об этом вслух,
// иначе официант не поймёт, почему вопросы только про одно.
const QUIZ_AREAS = ['kitchen', 'bar', 'service'];
function quizAreaName(a) { return t('quiz.area.' + a); }
function quizScopeText(areas) {
  const list = (areas || []).filter(a => QUIZ_AREAS.includes(a));
  return list.length && list.length < QUIZ_AREAS.length
    ? t('quiz.scopeOnly', { areas: list.map(quizAreaName).join(t('quiz.scopeAnd')) }) : '';
}

// ===== Сторона официанта =====

async function openQuiz() {
  openModal('modal-quiz');
  const body = document.getElementById('quiz-body');
  body.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data, error } = await sb.rpc('quiz_start');
    if(error) return quizFail(t('quiz.errStart') + error.message);
    if(data?.error) return quizFail(quizErrorText(data));
    quizAttemptId = data.attempt_id;
    quizQuestions = data.questions || [];
    quizTotal = data.total || quizQuestions.length || QUIZ_TOTAL;
    quizPass = data.pass || quizPassFor(quizTotal);
    quizPractice = !!data.practice;
    quizAreas = data.areas || null;
    quizAnswers = {}; quizIndex = 0;
    renderQuizQuestion();
  } catch(e) { quizFail(t('quiz.errStart') + e.message); }
}

function quizErrorText(d) {
  if(d.error === 'not_saturday')          return t('quiz.errNotSaturday');
  if(d.error === 'already_done')          return t('quiz.errAlreadyDone');
  if(d.error === 'no_employee')           return t('quiz.errNoEmployee');
  if(d.error === 'not_enough_questions')  return t('quiz.errNoQuestions', {have: d.have || 0, need: d.need || QUIZ_TOTAL});
  return t('common.error') + d.error;
}
function quizFail(msg) {
  document.getElementById('quiz-body').innerHTML =
    `<div class="empty" style="padding:20px 0"><div class="empty-icon">🎓</div><div class="empty-text">${msg}</div></div>`;
}

function renderQuizQuestion() {
  const q = quizQuestions[quizIndex];
  if(!q) return;
  const chosen = quizAnswers[q.id];
  const last = quizIndex === quizQuestions.length - 1;
  const scope = quizScopeText(quizAreas);
  document.getElementById('quiz-body').innerHTML = `
    ${quizPractice||scope?`<div style="font-size:11px;font-weight:600;color:#8a6a2f;background:rgba(138,106,47,0.12);border-radius:8px;padding:6px 9px;margin-bottom:10px">${quizPractice?`🏋️ ${t('quiz.practiceBadge')}`:''}${quizPractice&&scope?' · ':''}${scope}</div>`:''}
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <div style="flex:1;height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${Math.round((quizIndex+1)/quizQuestions.length*100)}%;background:var(--gold-dark)"></div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);white-space:nowrap">${t('quiz.progress',{n:quizIndex+1,total:quizQuestions.length})}</div>
    </div>
    <div style="font-size:15px;font-weight:600;color:var(--text-primary);line-height:1.45;margin-bottom:14px">${escapeHtml(q.question)}</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${(q.options||[]).map((opt,i)=>`
        <button onclick="pickQuizAnswer(${q.id},${i})" style="text-align:left;padding:12px 14px;border-radius:12px;border:1px solid ${chosen===i?'var(--gold-dark)':'var(--border)'};background:${chosen===i?'rgba(184,143,58,0.12)':'var(--surface)'};color:var(--text-primary);font-size:14px;line-height:1.4;cursor:pointer">
          <b style="color:var(--gold-dark);margin-right:8px">${'АБВГ'[i]}</b>${escapeHtml(opt)}
        </button>`).join('')}
    </div>
    <div style="display:flex;gap:8px">
      ${quizIndex>0?`<button onclick="quizPrev()" style="flex:0 0 auto;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:12px 16px;font-size:14px;cursor:pointer">${t('quiz.back')}</button>`:''}
      <button onclick="${last?'finishQuiz()':'quizNext()'}" ${chosen==null?'disabled':''} style="flex:1;background:${chosen==null?'var(--surface-2)':'var(--gold-dark)'};color:${chosen==null?'var(--text-muted)':'#fff'};border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:${chosen==null?'default':'pointer'}">${last?t('quiz.finish'):t('quiz.next')}</button>
    </div>`;
}

function pickQuizAnswer(qid, i) { quizAnswers[qid] = i; renderQuizQuestion(); }
function quizNext() { if(quizIndex < quizQuestions.length-1) { quizIndex++; renderQuizQuestion(); } }
function quizPrev() { if(quizIndex > 0) { quizIndex--; renderQuizQuestion(); } }

async function finishQuiz() {
  const body = document.getElementById('quiz-body');
  body.innerHTML = `<div class="loading">${t('quiz.checking')}</div>`;
  const answers = quizQuestions.map(q => ({ id: q.id, a: quizAnswers[q.id] })).filter(x => x.a != null);
  try {
    const { data, error } = await sb.rpc('quiz_submit', { p_attempt_id: quizAttemptId, p_answers: answers });
    if(error) return quizFail(t('common.error') + error.message);
    if(data?.error) return quizFail(quizErrorText(data));
    renderQuizResult(data);
  } catch(e) { quizFail(t('common.error') + e.message); }
}

function renderQuizResult(r) {
  const wrong = (r.details||[]).filter(d => !d.ok);
  const total = r.total || quizTotal;
  const pass  = r.pass  || quizPassFor(total);
  const practice = r.practice ?? quizPractice;
  // У тренировочной попытки итог тот же, а вот приписки про проценты быть не должно:
  // она в них не идёт, и обещать «блок засчитан» или пугать «сгорел» здесь нельзя.
  const hint = practice ? t('quiz.practiceHint') : (r.passed?t('quiz.passedHint'):t('quiz.failedHint'));
  document.getElementById('quiz-body').innerHTML = `
    <div style="text-align:center;padding:10px 0 16px">
      <div style="font-size:44px">${r.passed?'🎓':'📕'}</div>
      <div style="font-size:26px;font-weight:800;color:${r.passed?'#3B6D11':'#A13C3C'};margin-top:6px">${r.score} / ${total}</div>
      <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-top:4px">${r.passed?t('quiz.passed'):t('quiz.failed',{need:pass})}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${hint}</div>
    </div>
    ${wrong.length?`
      <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:8px">${t('quiz.mistakes',{n:wrong.length})}</div>
      ${wrong.map(d=>`
        <div style="background:var(--surface-2);border-radius:10px;padding:10px 12px;margin-bottom:8px">
          <div style="font-size:13px;color:var(--text-primary);margin-bottom:4px">${escapeHtml(d.question)}</div>
          <div style="font-size:12px;color:#A13C3C">${t('quiz.yourAnswer')}: ${escapeHtml(d.yourText||'—')}</div>
          <div style="font-size:12px;color:#3B6D11">${t('quiz.rightAnswer')}: ${escapeHtml(d.correctText||'')}</div>
        </div>`).join('')}`:''}
    <button class="btn btn-primary" onclick="closeQuizAndRefresh()">${t('common.close')}</button>`;
}

function closeQuizAndRefresh() {
  closeModal('modal-quiz');
  quizAttemptId = null; quizQuestions = []; quizAnswers = {};
  quizTotal = QUIZ_TOTAL; quizPass = QUIZ_PASS; quizPractice = false; quizAreas = null;
  if(typeof loadHome === 'function' && document.getElementById('screen-home')?.classList.contains('active')) loadHome();
  if(typeof bonusData !== 'undefined' && document.getElementById('screen-bonus')?.classList.contains('active')) { bonusData = null; switchBonusTab(bonusTab); }
}

// Карточка на Главной: официанту напоминаем про аттестацию по субботам
// (и в любой день, если администратор открыл пересдачу).
async function loadQuizCard() {
  const el = document.getElementById('home-quiz-card');
  if(!el) return;
  el.innerHTML = '';
  const empId = currentProfile?.employee_id;
  if(!empId) return;
  try {
    const { data: emp } = await sb.from('employees').select('department').eq('id', empId).single();
    if(emp?.department !== 'Официанты') return;

    const week = weekStartOf();
    const today = businessToday();
    const { data: attempts } = await sb.from('quiz_attempts')
      .select('score,passed,finished_at,superseded,practice,q_total,question_ids,date,areas')
      .eq('employee_id', empId).eq('week_start', week);
    const all = attempts || [];
    const qn = a => (a.question_ids || []).length;
    // Назначение от руководства — погашенная строка без вопросов; израсходованное закрыто finished_at
    const assign  = all.find(a => a.superseded && !qn(a) && !a.finished_at);
    // Зачётная попытка недели (тренировочные её не занимают)
    const active  = all.find(a => !a.superseded && !a.practice && qn(a));
    const started = all.find(a => !a.finished_at && qn(a) && (!a.practice || a.date === today));
    const donePractice = all.find(a => a.practice && a.finished_at && a.date === today);
    const isSaturday = new Date(today).getDay() === 6;

    // Итог показываем в день сдачи: зачётный — в субботу, тренировочный — в свой день.
    // Но в субботу тренировка не должна закрывать собой зачётную аттестацию:
    // пока она не сдана, карточка с итогом тренировки уступает ей место.
    const saturdayPending = isSaturday && !(active && active.finished_at);
    const done = (active && active.finished_at && isSaturday) ? active
               : (!assign && !started && !saturdayPending ? donePractice : null);
    if(done) {
      const total = done.q_total || QUIZ_TOTAL;
      el.innerHTML = `<div class="card" style="margin-bottom:12px;background:${done.passed?'linear-gradient(135deg,#EAF3DE,#d4edda)':'linear-gradient(135deg,#F6E7E7,#f5d9d9)'};border:none">
        <div style="text-align:center;padding:6px">
          <div style="font-size:26px">${done.passed?'🎓':'📕'}</div>
          <div style="font-size:15px;font-weight:700;color:${done.passed?'#3B6D11':'#A13C3C'};margin-top:4px">${t('quiz.cardDone',{score:done.score,total})}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${done.practice?t('quiz.practiceBadge'):(done.passed?t('quiz.passed'):t('quiz.failed',{need:quizPassFor(total)}))}</div>
        </div></div>`;
      return;
    }
    if(active && active.finished_at && !assign && !started) return; // сдал раньше — не мозолим глаза
    if(!isSaturday && !assign && !started) return;

    const run = started || assign || null;
    const practice = !!(run && run.practice);
    const total = (run && run.q_total) || QUIZ_TOTAL;
    const label = practice ? t('quiz.cardPractice') : (assign||started ? t('quiz.cardRetake') : t('quiz.cardSaturday'));
    const scope = quizScopeText(run && run.areas);
    el.innerHTML = `<div class="card" style="margin-bottom:12px;background:linear-gradient(135deg,#2d2416,#4a3a1f);border:none;color:#f0e9db">
      <div style="font-size:11px;opacity:0.75;margin-bottom:4px">${label}</div>
      <div style="font-size:17px;font-weight:700;margin-bottom:10px">${practice?'🏋️':'🎓'} ${practice?t('quiz.practiceTitle'):t('quiz.cardTitle')}</div>
      <div style="font-size:12px;opacity:0.8;margin-bottom:12px">${practice?t('quiz.practiceCardHint',{total,pass:quizPassFor(total)}):t('quiz.cardHint',{total,pass:quizPassFor(total)})}${scope?` ${scope}`:''}</div>
      <button onclick="openQuiz()" style="width:100%;background:var(--gold-dark);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">${t('quiz.cardBtn')}</button>
    </div>`;
  } catch(e) { /* таблиц ещё нет — карточку просто не показываем */ }
}

// ===== Банк вопросов (руководство) =====

let quizBankDept = 'Официанты';

async function renderQuizBank() {
  const c = document.getElementById('bonus-content');
  if(!canEditData() && !isBoss()) { c.innerHTML = ''; return; }
  c.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data, error } = await sb.from('quiz_questions').select('*')
      .eq('department', quizBankDept).neq('status','archived').order('status').order('id');
    if(error) throw error;
    const drafts = (data||[]).filter(q=>q.status==='draft');
    const active = (data||[]).filter(q=>q.status==='active');
    const manage = canEditData();

    let html = `<div class="card" style="padding:12px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:4px">${t('quiz.bankTitle')}</div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.6">${t('quiz.bankHint',{active:active.length,need:QUIZ_TOTAL,pass:QUIZ_PASS})}</div>
      ${active.length < QUIZ_TOTAL?`<div style="font-size:12px;color:#A13C3C;margin-top:6px">${t('quiz.bankTooFew',{n:QUIZ_TOTAL})}</div>`:''}
      ${manage?`<div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="openGenerateQuiz()" style="flex:1;background:linear-gradient(135deg,#2d2416,#4a3a1f);color:#f0e9db;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer">${t('quiz.genBtn')}</button>
        <button onclick="openQuizQuestion()" style="flex:0 0 auto;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer">${t('quiz.addBtn')}</button>
      </div>`:''}
    </div>`;

    const card = (q, isDraft) => `
      <div class="card" style="padding:12px;margin-bottom:8px;${isDraft?'border-left:3px solid var(--gold-dark)':''}">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);line-height:1.45;margin-bottom:8px">${escapeHtml(q.question)}</div>
        ${(q.options||[]).map((o,i)=>`<div style="font-size:12px;color:${i===q.correct_index?'#3B6D11':'var(--text-muted)'};padding:2px 0">${i===q.correct_index?'✓':'○'} ${escapeHtml(o)}</div>`).join('')}
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px">
          ${q.source?`${t('quiz.source')}: ${escapeHtml(q.source)}`:''}${q.source&&q.topic?' · ':''}${q.topic?`${t('quiz.topic')}: ${escapeHtml(q.topic)}`:''}
        </div>
        <div style="font-size:11px;margin-top:4px;color:${q.area?'var(--gold-dark)':'#A13C3C'}">
          ${q.area?`${t('quiz.area')}: ${quizAreaName(q.area)}`:t('quiz.noArea')}
        </div>
        ${manage?`<div style="display:flex;gap:6px;margin-top:10px">
          ${isDraft?`<button onclick="approveQuizQuestion(${q.id})" style="flex:1;background:#EAF3DE;color:#3B6D11;border:none;border-radius:8px;padding:8px;font-size:12px;font-weight:700;cursor:pointer">${t('quiz.approve')}</button>`:''}
          <button onclick="openQuizQuestion(${q.id})" style="flex:0 0 auto;background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer">${t('quiz.edit')}</button>
          <button onclick="deleteQuizQuestion(${q.id})" style="flex:0 0 auto;background:var(--surface-2);color:#A32D2D;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer">✕</button>
        </div>`:''}
      </div>`;

    if(drafts.length) html += `<div style="font-size:12px;font-weight:700;color:var(--gold-dark);margin:12px 4px 8px">${t('quiz.draftsTitle',{n:drafts.length})}</div>` + drafts.map(q=>card(q,true)).join('');
    html += `<div style="font-size:12px;font-weight:700;color:var(--text-muted);margin:12px 4px 8px">${t('quiz.activeTitle',{n:active.length})}</div>`;
    html += active.length ? active.map(q=>card(q,false)).join('')
      : `<div class="card"><div class="empty"><div class="empty-text">${t('quiz.noQuestions')}</div></div></div>`;
    c.innerHTML = html;
  } catch(e) {
    c.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('quiz.bankErr')}</div></div></div>`;
  }
}

let quizEditId = null;
async function openQuizQuestion(id) {
  if(!canEditData()) return showToast(t('bonus.onlyMgr'));
  quizEditId = id || null;
  let q = null;
  if(id) { const { data } = await sb.from('quiz_questions').select('*').eq('id', id).single(); q = data; }
  document.getElementById('qq-text').value = q?.question || '';
  for(let i=0;i<4;i++) document.getElementById('qq-opt-'+i).value = q?.options?.[i] || '';
  document.getElementById('qq-topic').value = q?.topic || '';
  document.getElementById('qq-area').value = q?.area || '';
  quizCorrectIndex = q?.correct_index ?? 0;
  renderQuizCorrectPicker();
  openModal('modal-quiz-question');
}
let quizCorrectIndex = 0;
function setQuizCorrect(i) { quizCorrectIndex = i; renderQuizCorrectPicker(); }
function renderQuizCorrectPicker() {
  document.getElementById('qq-correct').innerHTML = [0,1,2,3].map(i=>
    `<button onclick="setQuizCorrect(${i})" style="flex:1;padding:9px;border-radius:9px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:${quizCorrectIndex===i?'#EAF3DE':'var(--surface-2)'};color:${quizCorrectIndex===i?'#3B6D11':'var(--text-primary)'}">${'АБВГ'[i]}</button>`
  ).join('');
}
async function saveQuizQuestion() {
  if(!canEditData()) return showToast(t('bonus.onlyMgr'));
  const question = document.getElementById('qq-text').value.trim();
  const options = [0,1,2,3].map(i => document.getElementById('qq-opt-'+i).value.trim());
  if(!question) return showToast(t('quiz.enterQuestion'));
  if(options.some(o=>!o)) return showToast(t('quiz.enterOptions'));
  const topic = document.getElementById('qq-topic').value.trim().toLowerCase() || null;
  const area = document.getElementById('qq-area').value || null;
  const row = {
    department: quizBankDept, question, options, correct_index: quizCorrectIndex, topic, area, status: 'active',
    created_by: currentUser?.id, created_by_name: currentProfile?.name || currentUser?.email,
  };
  try {
    const { error } = quizEditId
      ? await sb.from('quiz_questions').update({ question, options, correct_index: quizCorrectIndex, topic, area }).eq('id', quizEditId)
      : await sb.from('quiz_questions').insert(row);
    if(error) return showToast(t('common.error')+error.message);
    closeModal('modal-quiz-question');
    showToast(t('quiz.questionSaved'));
    renderQuizBank();
  } catch(e) { showToast(t('common.error')+e.message); }
}
async function approveQuizQuestion(id) {
  if(!canEditData()) return;
  const { error } = await sb.from('quiz_questions').update({ status:'active' }).eq('id', id);
  if(error) return showToast(t('common.error')+error.message);
  renderQuizBank();
}
async function deleteQuizQuestion(id) {
  if(!canEditData()) return;
  if(!await confirmDialog(t('quiz.removeQuestion'))) return;
  const { error } = await sb.from('quiz_questions').delete().eq('id', id);
  if(error) return showToast(t('common.error')+error.message);
  renderQuizBank();
}

// ===== Генерация вопросов из Базы знаний (ИИ) =====
async function openGenerateQuiz() {
  if(!canEditData()) return showToast(t('bonus.onlyMgr'));
  const sel = document.getElementById('qg-book');
  sel.innerHTML = `<option value="">${t('quiz.genLoading')}</option>`;
  openModal('modal-quiz-generate');
  document.getElementById('qg-status').textContent = '';
  const { data: books } = await sb.from('kb_books').select('id,title').order('title');
  sel.innerHTML = (books||[]).map(b=>`<option value="${b.id}">${escapeHtml(b.title)}</option>`).join('');
}
async function generateQuizQuestions() {
  if(!canEditData()) return showToast(t('bonus.onlyMgr'));
  const bookId = document.getElementById('qg-book').value;
  const count = parseInt(document.getElementById('qg-count').value) || 10;
  if(!bookId) return showToast(t('quiz.genPickBook'));
  const status = document.getElementById('qg-status');
  status.textContent = t('quiz.genWorking');
  try {
    const { data, error } = await sb.functions.invoke('gen-quiz', {
      body: { book_id: Number(bookId), count, department: quizBankDept },
    });
    if(error) { status.textContent = t('quiz.genErr') + (error.message||''); return; }
    if(data?.error) { status.textContent = t('quiz.genErr') + data.error; return; }
    status.textContent = t('quiz.genDone', { n: data?.created ?? 0 });
    showToast(t('quiz.genDone', { n: data?.created ?? 0 }));
    setTimeout(()=>{ closeModal('modal-quiz-generate'); renderQuizBank(); }, 900);
  } catch(e) { status.textContent = t('quiz.genErr') + e.message; }
}
