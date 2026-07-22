// ============ ОТЗЫВЫ (REVIEWS) ============
let reviewFilter = 'all';
let reviewsSelectedDay = null; // null = все дни

function renderReviewsDaySwitcher() {
  const el = document.getElementById('reviews-day-switcher');
  if(!el) return;
  const now = new Date();
  const days = [];
  for(let i=0; i>=-6; i--) { // сегодня и 6 дней назад
    const d = new Date(now); d.setDate(now.getDate()+i);
    const ds = ymdLocal(d);
    let label;
    if(i===0) label = 'Сегодня';
    else if(i===-1) label = 'Вчера';
    else label = d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
    days.push({ ds, label });
  }
  const chip = (active, onclick, label) =>
    `<button onclick="${onclick}" style="flex:0 0 auto;padding:6px 12px;border-radius:16px;border:none;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;background:${active?'#4a3a1f':'var(--surface-2)'};color:${active?'#fff':'var(--text-primary)'}">${label}</button>`;
  let html = chip(reviewsSelectedDay===null, "selectReviewDay(null)", 'Все дни');
  html += days.map(d=>chip(reviewsSelectedDay===d.ds, `selectReviewDay('${d.ds}')`, d.label)).join('');
  // Кнопка выбора произвольной даты
  const isCustom = reviewsSelectedDay && !days.find(d=>d.ds===reviewsSelectedDay);
  const customLabel = isCustom ? '📅 ' + new Date(reviewsSelectedDay).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}) : '📅 Дата';
  html += `<button onclick="document.getElementById('reviews-date-picker').showPicker?document.getElementById('reviews-date-picker').showPicker():document.getElementById('reviews-date-picker').click()" style="flex:0 0 auto;padding:6px 12px;border-radius:16px;border:none;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;background:${isCustom?'#4a3a1f':'var(--surface-2)'};color:${isCustom?'#fff':'var(--text-primary)'}">${customLabel}</button>`;
  html += `<input type="date" id="reviews-date-picker" aria-label="Выбрать дату" onchange="selectReviewDay(this.value)" style="position:absolute;opacity:0;width:0;height:0;pointer-events:none">`;
  el.innerHTML = html;
}

function selectReviewDay(ds) {
  reviewsSelectedDay = ds;
  loadReviews();
}

const REVIEW_CATS = { bar:'🍹 Бар', kitchen:'🍽️ Кухня', hookah:'💨 Кальян', other:'💬 Прочее' };
const REVIEW_SENT = { positive:'👍', negative:'👎', neutral:'😐' };
const REVIEW_SENT_LABEL = { positive:'Положительный', negative:'Отрицательный', neutral:'Нейтральный' };

function openReviewModal() {
  document.getElementById('review-guest').value = '';
  document.getElementById('review-text').value = '';
  document.getElementById('review-filial-display').textContent = '📍 Отзыв по филиалу: ' + getFilialName(currentFilial);
  openModal('modal-review');
}

async function saveReview() {
  const text = document.getElementById('review-text').value.trim();
  const guest = document.getElementById('review-guest').value.trim();
  if(!text) return showToast('Введите текст отзыва');
  showToast('🤖 Анализирую отзыв...');
  let category = 'other', sentiment = 'neutral';
  // Пробуем разобрать через ИИ
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const res = await fetch('https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/analyze-review', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_KEY, 'Authorization':'Bearer '+(accessToken||SUPABASE_KEY) },
      body: JSON.stringify({ text })
    });
    const result = await res.json();
    if(result.category) category = result.category;
    if(result.sentiment) sentiment = result.sentiment;
  } catch(e) { /* если ИИ недоступен — сохраним с значениями по умолчанию, поправят вручную */ }

  try {
    await sb.from('reviews').insert({
      text, guest_name: guest||null, category, sentiment, filial: currentFilial,
      created_by: currentUser.id, created_by_name: currentProfile?.name || currentUser?.email
    });
    closeModal('modal-review');
    showToast('✅ Отзыв сохранён');
    // Уведомляем руководство о негативном отзыве
    if(sentiment === 'negative') {
      const catLabel = {bar:'🍹 Бар', kitchen:'🍽️ Кухня', hookah:'💨 Кальян', other:'💬 Прочее'}[category] || '💬';
      await notifyAdminsAll(`⚠️ <b>Негативный отзыв</b> · ${getFilialName(currentFilial)}\n\n${catLabel}\n${guest?'👤 Гость: '+tgEscape(guest)+'\n':''}💬 «${tgEscape(text)}»\n\nЗаписал: ${tgEscape(currentProfile?.name||'')}`, 'review_neg');
    }
    loadReviews();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function loadReviews() {
  document.getElementById('reviews-subtitle').textContent = 'Филиал: ' + getFilialName(currentFilial);
  renderReviewsDaySwitcher();
  // Фильтры
  const filters = [
    { id:'all', label:'Все' },
    { id:'bar', label:'🍹 Бар' },
    { id:'kitchen', label:'🍽️ Кухня' },
    { id:'hookah', label:'💨 Кальян' },
    { id:'positive', label:'👍 Хорошие' },
    { id:'negative', label:'👎 Плохие' }
  ];
  document.getElementById('reviews-filters').innerHTML = filters.map(f=>`<button onclick="setReviewFilter('${f.id}')" style="flex:0 0 auto;padding:7px 13px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;background:${f.id===reviewFilter?'var(--gold-dark)':'var(--surface-2)'};color:${f.id===reviewFilter?'#fff':'var(--text-primary)'}">${f.label}</button>`).join('');

  const content = document.getElementById('reviews-content');
  content.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    let query = sb.from('reviews').select('*').eq('filial', currentFilial).order('created_at',{ascending:false});
    if(['bar','kitchen','hookah','other'].includes(reviewFilter)) query = query.eq('category', reviewFilter);
    if(['positive','negative','neutral'].includes(reviewFilter)) query = query.eq('sentiment', reviewFilter);
    if(reviewsSelectedDay) query = query.gte('created_at', reviewsSelectedDay+'T00:00:00').lte('created_at', reviewsSelectedDay+'T23:59:59');
    const { data: reviews } = await query;

    if(!reviews || reviews.length===0) {
      content.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">⭐</div><div class="empty-text">'+(reviewsSelectedDay?'За этот день отзывов нет':'Отзывов пока нет')+'</div></div></div>';
      return;
    }

    // Рейтинг-соревнование отделов (только на вкладке "Все")
    let summary = '';
    if(reviewFilter==='all' && !reviewsSelectedDay) {
      // Считаем баллы по всем отзывам филиала (не только показанным)
      const { data: allRev } = await sb.from('reviews').select('category,sentiment').eq('filial', currentFilial);
      const depts = [
        { id:'bar', label:'🍹 Бар' },
        { id:'kitchen', label:'🍽️ Кухня' },
        { id:'hookah', label:'💨 Кальян' }
      ];
      const scores = depts.map(d=>{
        const list = (allRev||[]).filter(r=>r.category===d.id);
        const pos = list.filter(r=>r.sentiment==='positive').length;
        const neg = list.filter(r=>r.sentiment==='negative').length;
        return { ...d, pos, neg, score: pos-neg, total: list.length };
      }).sort((a,b)=>b.score-a.score);

      const medals = ['🥇','🥈','🥉'];
      const maxAbs = Math.max(1, ...scores.map(s=>Math.abs(s.score)));
      summary = `<div class="card" style="background:linear-gradient(135deg,#2d2416,#4a3a1f);border:none;color:#f0e9db">
        <div style="font-size:13px;font-weight:700;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">🏆 Битва отделов</div>
        ${scores.map((s,i)=>{
          const barW = Math.round(Math.abs(s.score)/maxAbs*100);
          const barColor = s.score>=0 ? '#7ec850' : '#e06666';
          return `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:14px;font-weight:600">${medals[i]||''} ${s.label}</span>
              <span style="font-size:15px;font-weight:700;color:${s.score>=0?'#a3e07a':'#ff9b9b'}">${s.score>0?'+':''}${s.score} балл.</span>
            </div>
            <div style="background:rgba(255,255,255,0.12);border-radius:6px;height:8px;overflow:hidden">
              <div style="width:${barW}%;height:100%;background:${barColor};border-radius:6px"></div>
            </div>
            <div style="font-size:11px;opacity:0.65;margin-top:3px">👍 ${s.pos} · 👎 ${s.neg} · всего ${s.total}</div>
          </div>`;
        }).join('')}
        <div style="font-size:11px;opacity:0.55;margin-top:4px">Балл = хорошие минус плохие отзывы. За всё время.</div>
      </div>`;
    }

    content.innerHTML = summary + reviews.map(r=>{
      const border = r.sentiment==='positive'?'#3B6D11':r.sentiment==='negative'?'#A32D2D':'var(--border)';
      return `<div class="card" style="border-left:3px solid ${border}">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:6px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span style="background:var(--surface-2);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600">${REVIEW_CATS[r.category]||'💬'}</span>
            <span style="background:var(--surface-2);border-radius:6px;padding:2px 8px;font-size:11px">${REVIEW_SENT[r.sentiment]||''} ${REVIEW_SENT_LABEL[r.sentiment]||''}</span>
          </div>
          ${canEditData()?`<button onclick="openReviewEdit(${r.id},'${escJsAttr(r.category)}','${escJsAttr(r.sentiment)}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px">✏️</button>`:''}
        </div>
        <div style="font-size:14px;color:var(--text-primary);line-height:1.5">${escapeHtml(r.text)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${r.guest_name?escapeHtml(r.guest_name)+' · ':''}${new Date(r.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}${r.created_by_name?' · записал '+escapeHtml(r.created_by_name):''}</div>
      </div>`;
    }).join('');
  } catch(e) { content.innerHTML = '<div class="card"><div class="empty"><div class="empty-text">Ошибка. Возможно, отзывы ещё не настроены в Supabase.</div></div></div>'; }
}

function setReviewFilter(f) { reviewFilter = f; loadReviews(); }

function openReviewEdit(id, category, sentiment) {
  if(!canEditData()) return;
  document.getElementById('review-edit-id').value = id;
  document.getElementById('review-edit-category').value = category;
  document.getElementById('review-edit-sentiment').value = sentiment;
  openModal('modal-review-edit');
}

async function saveReviewEdit() {
  const id = document.getElementById('review-edit-id').value;
  const category = document.getElementById('review-edit-category').value;
  const sentiment = document.getElementById('review-edit-sentiment').value;
  try {
    await sb.from('reviews').update({category, sentiment}).eq('id', id);
    closeModal('modal-review-edit');
    showToast('✅ Обновлено');
    loadReviews();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

async function deleteReview() {
  const id = document.getElementById('review-edit-id').value;
  if(!await confirmDialog('Удалить отзыв?')) return;
  try {
    await sb.from('reviews').delete().eq('id', id);
    closeModal('modal-review-edit');
    showToast('✅ Удалено');
    loadReviews();
  } catch(e) { showToast('Ошибка: '+e.message); }
}

