// ============ KNOWLEDGE BASE ============
let kbCurrentBookId = null;
let kbCurrentBook = null;   // книга, открытая сейчас: нужна, чтобы знать, кому её можно править

// Книги заводит и удаляет только админ: это скелет базы, на ней держится поиск
// и ответы Помощника.
function kbCanEditBooks() { return currentRole() === 'admin'; }

// Статьи внутри книги: админ — везде, управляющий — только там, где книге
// проставлено edit_role='manager' (например, регламент по оборудованию,
// который ведут управляющие филиалов), старший цеха — в книге своего цеха
// (edit_dept). То же правило продублировано в RLS.
function kbCanEdit(book) {
  const b = book || kbCurrentBook;
  const r = currentRole();
  if(r === 'admin') return true;
  if(r === 'manager' && b?.edit_role === 'manager') return true;
  // Именно старший этого цеха: управляющему книга цеха сама по себе прав не даёт
  return !!b?.edit_dept && typeof myLeadDept === 'function' && myLeadDept() === b.edit_dept;
}

function escapeHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Для вставки пользовательских строк внутрь одинарных кавычек JS-аргумента в onclick="fn('...')"
function escJsAttr(s) {
  return escapeHtml(s).replace(/'/g,"\\'");
}

async function loadKnowledgeBase() {
  kbCurrentBookId = null;
  kbCurrentBook = null;
  const searchEl = document.getElementById('kb-search');
  if(searchEl && document.activeElement !== searchEl) searchEl.value = '';
  document.getElementById('kb-title').textContent = t('kb.title');
  document.getElementById('kb-subtitle').textContent = t('kb.subtitle');
  const addBtn = document.getElementById('kb-add-book-btn');
  if(addBtn) { addBtn.style.display = kbCanEditBooks() ? 'block' : 'none'; addBtn.onclick = openKbBookModal; addBtn.textContent = t('kb.addBook'); }

  const content = document.getElementById('kb-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data: books } = await sb.from('kb_books').select('*').order('sort_order').order('created_at');
    if(!books || books.length===0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">📚</div><div class="empty-text">${t('kb.noBooks')}${kbCanEditBooks()?t('kb.noBooksHint'):''}</div></div></div>`;
      return;
    }
    // Count articles per book
    const { data: allArticles } = await sb.from('kb_articles').select('book_id');
    const counts = {};
    (allArticles||[]).forEach(a=>{ counts[a.book_id]=(counts[a.book_id]||0)+1; });

    content.innerHTML = books.map(b=>`
      <div class="card" style="cursor:pointer;display:flex;align-items:center;gap:14px" onclick="openKbBook(${b.id})">
        <div style="font-size:32px">${b.icon||'📖'}</div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:600;color:var(--text-primary)">${escapeHtml(b.title)}</div>
          <div style="font-size:13px;color:var(--text-muted)">${counts[b.id]||0} ${t('kb.articlesWord')}</div>
        </div>
        <div style="font-size:20px;color:var(--text-muted)">›</div>
      </div>`).join('');
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('kb.errNotSetup')}</div></div></div>`; }
}

function pluralArticles(n) {
  const n10 = n%10, n100 = n%100;
  if(n10===1 && n100!==11) return 'статья';
  if(n10>=2 && n10<=4 && (n100<10||n100>=20)) return 'статьи';
  return 'статей';
}

// Поиск по базе знаний (по заголовкам и тексту всех статей)
let kbSearchTimer = null;
function kbSearch(q) {
  clearTimeout(kbSearchTimer);
  kbSearchTimer = setTimeout(()=>runKbSearch(q), 300);
}

async function runKbSearch(q) {
  q = (q||'').trim().toLowerCase();
  const content = document.getElementById('kb-content');
  if(q.length < 2) { loadKnowledgeBase(); return; }
  document.getElementById('kb-title').textContent = t('kb.search');
  document.getElementById('kb-subtitle').textContent = t('kb.searchResults',{q});
  const addBtn = document.getElementById('kb-add-book-btn');
  if(addBtn) addBtn.style.display = 'none';
  content.innerHTML = `<div class="loading">${t('kb.searching')}</div>`;
  try {
    const { data: books } = await sb.from('kb_books').select('id,title,icon');
    const bookMap = {}; (books||[]).forEach(b=>bookMap[b.id]=b);
    const { data: articles } = await sb.from('kb_articles').select('*');
    const results = (articles||[]).filter(a=>
      (a.title||'').toLowerCase().includes(q) || (a.content||'').toLowerCase().includes(q)
    );
    if(results.length===0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">${t('kb.nothingFound')}</div></div></div>`;
      return;
    }
    content.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${t('kb.found',{n:results.length})}</div>` +
      results.map(a=>{
        const book = bookMap[a.book_id] || {};
        // короткий фрагмент вокруг найденного слова
        const body = kbStripRefs(a.content);
        const lc = body.toLowerCase();
        const pos = lc.indexOf(q);
        let snippet = '';
        if(pos>=0) {
          const start = Math.max(0, pos-40);
          snippet = (start>0?'…':'') + body.slice(start, pos+q.length+60) + '…';
        } else {
          snippet = body.slice(0,100);
        }
        return `<div class="card" style="cursor:pointer" onclick="openKbArticle(${a.id})">
          <div style="font-size:11px;color:var(--gold-dark);margin-bottom:2px">${book.icon||'📖'} ${escapeHtml(book.title||'')}</div>
          <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(a.title)}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">${escapeHtml(snippet)}</div>
        </div>`;
      }).join('');
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('kb.searchErr')}</div></div></div>`; }
}

async function openKbBook(bookId) {
  kbCurrentBookId = bookId;
  const content = document.getElementById('kb-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data: book } = await sb.from('kb_books').select('*').eq('id', bookId).single();
    kbCurrentBook = book || null;
    document.getElementById('kb-title').textContent = (book?.icon||'📖') + ' ' + (book?.title||'Книга');
    document.getElementById('kb-subtitle').textContent = t('kb.tapArticle');
    const addBtn = document.getElementById('kb-add-book-btn');
    if(addBtn) {
      addBtn.style.display = kbCanEdit(book) ? 'block' : 'none';
      addBtn.textContent = t('kb.addArticle');
      addBtn.onclick = () => openKbArticleModal(bookId);
    }

    const { data: articles } = await sb.from('kb_articles').select('*').eq('book_id', bookId).order('sort_order').order('created_at');

    let html = `<div style="margin-bottom:12px"><button onclick="loadKnowledgeBase()" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${t('kb.allBooks')}</button>`;
    if(kbCanEditBooks()) html += ` <button onclick="openKbBookModal(${book.id})" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${t('kb.editBook')}</button>`;
    html += `</div>`;

    kbBookArticles = articles || [];
    if(!articles || articles.length===0) {
      html += `<div class="card"><div class="empty"><div class="empty-icon">📄</div><div class="empty-text">${t('kb.noArticles')}${kbCanEdit(book)?t('kb.noArticlesHint'):''}</div></div></div>`;
    } else {
      html += `<div id="kb-dept-tabs"></div><div id="kb-book-list"></div>`;
    }
    content.innerHTML = html;
    if(articles && articles.length) kbRenderBookList();
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('kb.loadErr')}</div></div></div>`; }
}

// ===== Вкладки цехов внутри книги =====
// В «Стандартах» статьи адресованы цехам, и одним списком их стало много:
// зал, бар, кальянная, кухня, менеджеры вперемешку. Вкладки появляются в
// книге, где хоть у одной статьи проставлены отделы; в остальных книгах
// список как был. Статья для двух цехов видна в обеих вкладках.
const KB_DEPT_TABS = [
  { dept: 'Официанты', key: 'kb.tabHall' },
  { dept: 'Бармены', key: 'kb.tabBar' },
  { dept: 'Кальянные мастера', key: 'kb.tabHookah' },
  { dept: 'Повара', key: 'kb.tabKitchen' },
  { dept: 'Менеджеры', key: 'kb.tabManagers' },
];
const KB_TAB_COMMON = '*';           // статьи без отдела — видны всем
let kbBookArticles = [];
const kbDeptTabByBook = {};          // выбранная вкладка, чтобы «Назад» из статьи вернул туда же

function kbArticleDepts(a) { return Array.isArray(a.depts) ? a.depts.filter(Boolean) : []; }

function kbTabArticles(tab) {
  return kbBookArticles.filter(a => {
    const d = kbArticleDepts(a);
    return tab === KB_TAB_COMMON ? !d.length : d.includes(tab);
  });
}

function kbArticleCard(a) {
  const body = kbStripRefs(a.content);
  return `<div class="card" style="cursor:pointer" onclick="openKbArticle(${a.id})">
      <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${kbMediaBadge(a)}${escapeHtml(a.title)}</div>${kbDeptsLine(a)}
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px">${escapeHtml(body.slice(0,80))}${body.length>80?'…':''}</div>
    </div>`;
}

function kbRenderBookList() {
  const tabsBox = document.getElementById('kb-dept-tabs');
  const list = document.getElementById('kb-book-list');
  if(!tabsBox || !list) return;
  const withTabs = kbBookArticles.some(a => kbArticleDepts(a).length);
  if(!withTabs) { tabsBox.innerHTML = ''; list.innerHTML = kbBookArticles.map(kbArticleCard).join(''); return; }

  // Руководство видит все цеха, даже пустые — чтобы было видно, куда добавлять.
  // Сотруднику база и так отдаёт только его стандарты: показываем непустые.
  const lead = canEditData() || canSeeAdminPanel();
  let tabs = KB_DEPT_TABS.map(x => ({ id: x.dept, label: t(x.key), icon: DEPT_ICONS[x.dept] || '', n: kbTabArticles(x.dept).length }));
  const common = kbTabArticles(KB_TAB_COMMON).length;
  if(common) tabs.push({ id: KB_TAB_COMMON, label: t('kb.tabCommon'), icon: '📌', n: common });
  if(!lead) tabs = tabs.filter(x => x.n);

  const bookId = kbCurrentBook?.id;
  let cur = kbDeptTabByBook[bookId];
  if(!tabs.some(x => x.id === cur)) {
    const mine = currentEmployee?.department;
    cur = (tabs.find(x => x.id === mine && x.n) || tabs.find(x => x.n) || tabs[0] || {}).id;
  }
  kbDeptTabByBook[bookId] = cur;

  tabsBox.innerHTML = tabs.length > 1 ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">` +
    tabs.map(x => {
      const on = x.id === cur;
      return `<button type="button" data-tab="${escapeHtml(x.id)}" onclick="kbSelectDeptTab(this.dataset.tab)" style="flex:0 0 auto;border-radius:20px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;border:1px solid ${on ? 'var(--gold-dark)' : 'var(--border)'};background:${on ? 'var(--gold-dark)' : 'var(--surface-2)'};color:${on ? '#fff' : 'var(--text-primary)'};opacity:${x.n || on ? 1 : 0.55}">${x.icon} ${escapeHtml(x.label)}${x.n ? ` · ${x.n}` : ''}</button>`;
    }).join('') + `</div>` : '';

  const items = cur ? kbTabArticles(cur) : kbBookArticles;
  list.innerHTML = items.length ? items.map(kbArticleCard).join('')
    : `<div class="card"><div class="empty"><div class="empty-icon">📄</div><div class="empty-text">${t('kb.tabEmpty')}</div></div></div>`;
}

function kbSelectDeptTab(tab) {
  if(kbCurrentBook) kbDeptTabByBook[kbCurrentBook.id] = tab;
  kbRenderBookList();
}

async function openKbArticle(articleId) {
  const content = document.getElementById('kb-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data: a } = await sb.from('kb_articles').select('*').eq('id', articleId).single();
    // Статью можно открыть и из поиска, минуя список книг, — тогда права на
    // правку ещё не известны, дочитываем их у книги
    if(!kbCurrentBook || kbCurrentBook.id !== a.book_id) {
      const { data: b } = await sb.from('kb_books').select('*').eq('id', a.book_id).single();
      kbCurrentBook = b || null;
    }
    document.getElementById('kb-title').textContent = escapeHtml(a.title);
    document.getElementById('kb-subtitle').textContent = '';
    const addBtn = document.getElementById('kb-add-book-btn');
    if(addBtn) addBtn.style.display = 'none';

    let html = `<div style="margin-bottom:12px"><button onclick="openKbBook(${a.book_id})" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${t('kb.back')}</button>`;
    if(kbCanEdit()) html += ` <button onclick="openKbArticleModal(${a.book_id}, ${a.id})" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${t('kb.edit')}</button>`;
    html += `</div>`;
    html += `<div class="card"><div style="font-size:20px;font-weight:700;color:var(--text-primary);margin-bottom:12px">${escapeHtml(a.title)}</div>${kbDeptsLine(a)}
      ${kbMediaHtml(kbUnreferencedMedia(a))}
      ${kbContentHtml(a)}</div>`;
    kbCurrentArticle = a;
    content.innerHTML = html;
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('kb.loadErr')}</div></div></div>`; }
}

// --- Book create/edit ---
function openKbBookModal(bookId) {
  if(!kbCanEditBooks()) return;
  document.getElementById('kb-book-id').value = bookId || '';
  const delBtn = document.getElementById('kb-book-delete-btn');
  if(bookId) {
    document.getElementById('kb-book-modal-title').textContent = t('kb.editBookTitle');
    delBtn.style.display = 'block';
    sb.from('kb_books').select('*').eq('id', bookId).single().then(({data})=>{
      document.getElementById('kb-book-icon').value = data?.icon || '';
      document.getElementById('kb-book-title').value = data?.title || '';
      document.getElementById('kb-book-edit-role').value = data?.edit_role || 'admin';
    });
  } else {
    document.getElementById('kb-book-modal-title').textContent = t('kb.newBook');
    document.getElementById('kb-book-icon').value = '';
    document.getElementById('kb-book-title').value = '';
    document.getElementById('kb-book-edit-role').value = 'admin';
    delBtn.style.display = 'none';
  }
  openModal('modal-kb-book');
}

async function saveKbBook() {
  if(!kbCanEditBooks()) return showToast(t('common.observerMode'));
  const id = document.getElementById('kb-book-id').value;
  const icon = document.getElementById('kb-book-icon').value.trim() || '📖';
  const title = document.getElementById('kb-book-title').value.trim();
  const editRole = document.getElementById('kb-book-edit-role').value === 'manager' ? 'manager' : 'admin';
  if(!title) return showToast(t('inv.enterName'));
  try {
    if(id) {
      await sb.from('kb_books').update({icon, title, edit_role: editRole}).eq('id', id);
    } else {
      await sb.from('kb_books').insert({icon, title, edit_role: editRole});
    }
    closeModal('modal-kb-book');
    showToast(t('sch.saved'));
    loadKnowledgeBase();
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function deleteKbBook() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const id = document.getElementById('kb-book-id').value;
  if(!id) return;
  if(!await confirmDialog(t('kb.delBookConfirm'))) return;
  try {
    await sb.from('kb_books').delete().eq('id', id);
    closeModal('modal-kb-book');
    showToast(t('kb.bookDeleted'));
    loadKnowledgeBase();
  } catch(e) { showToast(t('common.error')+e.message); }
}

// --- Article create/edit ---
function openKbArticleModal(bookId, articleId) {
  if(!kbCanEdit()) return;
  document.getElementById('kb-article-book-id').value = bookId || '';
  document.getElementById('kb-article-id').value = articleId || '';
  const delBtn = document.getElementById('kb-article-delete-btn');
  kbEditMedia = []; kbRemovedMedia = []; kbLastCaret = null;
  const ta = document.getElementById('kb-article-content');
  if(ta) ta.onblur = () => { kbLastCaret = ta.selectionStart; };
  kbRenderEditMedia(); kbRenderDepts([]);
  kbSetProgress('');
  if(articleId) {
    document.getElementById('kb-article-modal-title').textContent = t('kb.editArticleTitle');
    delBtn.style.display = 'block';
    sb.from('kb_articles').select('*').eq('id', articleId).single().then(({data})=>{
      document.getElementById('kb-article-title').value = data?.title || '';
      document.getElementById('kb-article-content').value = data?.content || '';
      kbEditMedia = Array.isArray(data?.media) ? data.media.slice() : [];
      kbRenderEditMedia(); kbRenderDepts(data?.depts || []);
    });
  } else {
    document.getElementById('kb-article-modal-title').textContent = t('kb.newArticle');
    document.getElementById('kb-article-title').value = '';
    document.getElementById('kb-article-content').value = '';
    delBtn.style.display = 'none';
    // Добавляют из вкладки «Бар» — значит, стандарт для бара: отмечаем сразу
    const tab = kbDeptTabByBook[bookId];
    if(tab && tab !== KB_TAB_COMMON && kbBookArticles.some(a => kbArticleDepts(a).length)) kbRenderDepts([tab]);
  }
  openModal('modal-kb-article');
}

// Одна отправка за раз: сжатие видео идёт минутами, и второе нажатие
// положило бы второй комплект роликов.
let kbSaveBusy = false;

async function saveKbArticle() {
  if(!kbCanEdit()) return showToast(t('common.observerMode'));
  if(kbSaveBusy) return;
  const id = document.getElementById('kb-article-id').value;
  const bookId = document.getElementById('kb-article-book-id').value;
  const title = document.getElementById('kb-article-title').value.trim();
  const contentText = document.getElementById('kb-article-content').value;
  if(!title) return showToast(t('feed.enterTitle'));
  // Звук ролика забираем через AudioContext, а браузер даёт его завести только
  // прямо в нажатии — до первого await, иначе пережатое видео выйдет немым.
  const ac = kbEditMedia.some(m => m.file && kbIsVideo(m.file)) ? kbAudioContext() : null;
  const saveBtn = document.getElementById('kb-article-save-btn');
  kbSaveBusy = true;
  if(saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.55'; }
  try {
    const media = await kbUploadPendingMedia(ac);
    if(!media) return;                                  // ошибку уже показали
    const depts = kbCheckedDepts();
    const row = { title, content: contentText, media, depts: depts.length ? depts : null };
    let error;
    if(id) {
      ({ error } = await sb.from('kb_articles').update(Object.assign(row, { updated_at: new Date().toISOString() })).eq('id', id));
    } else {
      ({ error } = await sb.from('kb_articles').insert(Object.assign(row, { book_id: parseInt(bookId) })));
    }
    if(error) throw error;
    // Убранные из статьи файлы — из хранилища тоже: видео стандартов уборка не трогает
    const gone = kbRemovedMedia.map(m => m.path).filter(Boolean);
    if(gone.length) sb.storage.from('task-reports').remove(gone).catch(() => {});
    kbEditMedia = []; kbRemovedMedia = [];
    closeModal('modal-kb-article');
    showToast(t('sch.saved'));
    openKbBook(parseInt(bookId));
  } catch(e) { showToast(t('common.error')+e.message); }
  finally {
    kbSaveBusy = false;
    kbSetProgress('');
    if(saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = ''; }
    if(ac) ac.close().catch(() => {});
  }
}

async function deleteKbArticle() {
  if(!kbCanEdit()) return showToast(t('common.observerMode'));
  const id = document.getElementById('kb-article-id').value;
  const bookId = document.getElementById('kb-article-book-id').value;
  if(!id) return;
  if(!await confirmDialog(t('kb.delArticleConfirm'))) return;
  try {
    // Видео и фото статьи уборка не трогает (kb/) — убираем их сами
    const { data: old } = await sb.from('kb_articles').select('media').eq('id', id).single();
    await sb.from('kb_articles').delete().eq('id', id);
    const gone = (Array.isArray(old?.media) ? old.media : []).map(m => m.path).filter(Boolean);
    if(gone.length) sb.storage.from('task-reports').remove(gone).catch(() => {});
    closeModal('modal-kb-article');
    showToast(t('kb.articleDeleted'));
    openKbBook(parseInt(bookId));
  } catch(e) { showToast(t('common.error')+e.message); }
}


// ===== Видео и фото к статье (стандарты, 01.11.2026) =====
// Стандарт — это «как протереть стол», «как выглядит менажный набор»: видео
// и пара фото «как должно быть». Ролики живут у нас в хранилище под kb/ (их
// не трогает уборка через 14 дней), поэтому перед загрузкой их пережимаем:
// 960 px по длинной стороне и ~0,7 Мбит/с — около 5 МБ на минуту вместо
// 20-30 у ролика из Telegram, а на экране телефона разницы не видно.
const KB_VIDEO_SIDE = 960;
const KB_VIDEO_BITRATE = 700000;
const KB_AUDIO_BITRATE = 64000;
// Больше 50 МБ хранилище на бесплатном тарифе не принимает одним файлом
const KB_MAX_UPLOAD_MB = 50;
// Отделы, которым можно адресовать стандарт
const KB_DEPTS = ['Официанты', 'Бармены', 'Кальянные мастера', 'Повара', 'Менеджеры'];

let kbEditMedia = [];     // что сейчас в статье: {type,url,path} или {type,file} — ещё не загружено
let kbRemovedMedia = [];  // убранное при правке — удалить из хранилища после сохранения

function kbIsVideo(f) { return !!(f && f.type && f.type.startsWith('video')); }

function kbAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return null;
  try { const ac = new AC(); if(ac.resume) ac.resume().catch(() => {}); return ac; }
  catch(e) { return null; }
}

function kbMediaBadge(a) {
  const m = Array.isArray(a.media) ? a.media : [];
  if(m.some(x => x.type === 'video')) return '🎥 ';
  if(m.length) return '🖼 ';
  return '';
}

// Кому адресован стандарт — видно только руководству: рядовой и так видит
// лишь своё, ему эта строка ничего не скажет.
function kbDeptsLine(a) {
  if(!canSeeAdminPanel() && !canEditData()) return '';
  const d = Array.isArray(a.depts) ? a.depts.filter(Boolean) : [];
  if(!d.length) return '';
  return `<div style="font-size:12px;color:var(--gold-dark);margin-top:3px">${escapeHtml(t('kb.forDepts', { list: d.join(', ') }))}</div>`;
}

function kbMediaHtml(media) {
  const arr = Array.isArray(media) ? media : [];
  if(!arr.length) return '';
  return `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">` + arr.map(m =>
    m.type === 'video'
      ? `<video src="${escapeHtml(m.url)}" controls playsinline preload="metadata" style="width:100%;border-radius:12px;background:#000"></video>`
      : `<img src="${escapeHtml(m.url)}" loading="lazy" decoding="async" style="width:100%;border-radius:12px;cursor:pointer" onclick="kbShowMedia('${escJsAttr(m.url)}','image',kbCurrentArticle?.title)">`
  ).join('') + `</div>`;
}

function kbAddMedia(input) {
  const files = Array.from(input.files || []).filter(f => f.type && (f.type.startsWith('video') || f.type.startsWith('image')));
  input.value = '';
  files.forEach(f => kbEditMedia.push({ type: kbIsVideo(f) ? 'video' : 'image', file: f }));
  kbRenderEditMedia();
}

// ===== Пункт стандарта открывает своё видео или фото =====
// В тексте стоит метка «[видео 2]» / «[фото 3]» — номер файла в списке
// вложений статьи. Строка с меткой становится кликабельной: тап по пункту
// «Столы протёрты…» открывает ролик, как раньше ссылка на пост в Telegram.
// Номер, а не скрытый id — чтобы метку можно было прочитать и поправить
// руками прямо в тексте.
const KB_REF_RE = /\[(?:видео|фото|video|photo|расм)\s*(\d+)\]/gi;

function kbMediaRefs(text) {
  const out = [];
  String(text || '').replace(KB_REF_RE, (_, n) => { out.push(parseInt(n, 10) - 1); return ''; });
  return out;
}

// Файлы без метки в тексте показываем над текстом, как раньше
function kbUnreferencedMedia(a) {
  const arr = Array.isArray(a.media) ? a.media : [];
  const used = new Set(kbMediaRefs(a.content));
  return arr.filter((m, i) => !used.has(i));
}

// Для превью в списке и поиске: метки там ни к чему
function kbStripRefs(text) {
  return String(text || '').replace(KB_REF_RE, '').replace(/[ \t]+$/gm, '');
}

let kbCurrentArticle = null;

// ===== Пункт с подробностями =====
// Пункт стандарта — строка текста. К нему можно приложить сколько угодно
// фото и видео (метки «[фото N]» в той же строке) и пояснение «как делать»:
// строки с тире сразу под пунктом. В списке пояснение скрыто, чтобы стандарт
// читался как короткий чек-лист; тап по пункту открывает окно, где все его
// файлы подряд и пояснение под ними.
//
// Правило «строки с тире — пояснение» включается только в статьях, где есть
// хоть одна метка: в Food/Bar Book тире — обычные списки, их прятать нельзя.
const KB_DETAIL_RE = /^\s*[-–—•]\s?/;

function kbParseItems(a) {
  const media = Array.isArray(a.media) ? a.media : [];
  const lines = String(a.content || '').split('\n');
  const enabled = kbMediaRefs(a.content).some(i => media[i]);
  const items = [];
  for(let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const item = { li, text: line.replace(KB_REF_RE, '').replace(/\s+$/, ''), refs: kbMediaRefs(line).filter(i => media[i]), detail: [] };
    if(enabled && !KB_DETAIL_RE.test(line) && line.trim()) {
      while(li + 1 < lines.length && KB_DETAIL_RE.test(lines[li + 1])) {
        li++;
        item.refs.push(...kbMediaRefs(lines[li]).filter(i => media[i]));
        item.detail.push(lines[li].replace(KB_REF_RE, '').replace(KB_DETAIL_RE, '').trim());
      }
    }
    items.push(item);
  }
  return items;
}

// Заголовок окна — сам пункт («6. Столы протёрты…»), а не общее «Отчёт
// сотрудника»: окно просмотра отчётов здесь не подходит по смыслу.
function kbOpenItem(li) {
  const a = kbCurrentArticle;
  if(!a) return;
  const item = kbParseItems(a).find(x => x.li === li);
  if(!item) return;
  const media = a.media || [];
  const refs = [...new Set(item.refs)];
  // Один ролик — сразу играет; несколько — пусть человек выбирает сам
  const autoplay = refs.length === 1 ? ' autoplay' : '';
  const files = refs.map(i => media[i].type === 'video'
    ? `<video src="${escapeHtml(media[i].url)}" controls${autoplay} playsinline preload="metadata" style="width:100%;border-radius:12px;background:#000"></video>`
    : `<img src="${escapeHtml(media[i].url)}" loading="lazy" style="width:100%;border-radius:12px">`).join('');
  // Строка с двоеточием на конце — подзаголовок («Комплектация (минимум):»),
  // а не очередной пункт: без точки и жирным, с отступом сверху
  const detail = item.detail.filter(Boolean).map((d, k) => /:\s*$/.test(d)
    ? `<div style="font-weight:700;margin-top:${k ? 10 : 0}px">${escapeHtml(d.replace(/:\s*$/, ''))}</div>`
    : `<div style="display:flex;gap:8px"><span style="color:var(--gold-dark)">•</span><span>${escapeHtml(d)}</span></div>`).join('');
  document.getElementById('kb-media-title').textContent = kbStripRefs(item.text).trim() || a.title || '';
  document.getElementById('kb-media-content').innerHTML =
    `<div style="display:flex;flex-direction:column;gap:10px">${files}</div>` +
    (detail ? `<div style="margin-top:${files ? 14 : 0}px;font-size:15px;line-height:1.6;color:var(--text-primary);display:flex;flex-direction:column;gap:6px">${detail}</div>` : '');
  openModal('modal-kb-media');
}

function kbShowMedia(url, type, title) {
  document.getElementById('kb-media-title').textContent = title || '';
  document.getElementById('kb-media-content').innerHTML = type === 'video'
    ? `<video src="${escapeHtml(url)}" controls autoplay playsinline style="width:100%;border-radius:12px;background:#000"></video>`
    : `<img src="${escapeHtml(url)}" style="width:100%;border-radius:12px">`;
  openModal('modal-kb-media');
}

function kbContentHtml(a) {
  const media = Array.isArray(a.media) ? a.media : [];
  const html = kbParseItems(a).map(item => {
    const text = escapeHtml(item.text);
    const refs = [...new Set(item.refs)];
    if(!refs.length && !item.detail.length) return `<div style="min-height:1.7em">${text}</div>`;
    // Значок один на пункт: что внутри и сколько. 🎥 — есть видео, 📷 — только
    // фото, 📝 — только пояснение.
    const videos = refs.filter(i => media[i].type === 'video').length;
    const icon = refs.length ? (videos ? '🎥' : '📷') + (refs.length > 1 ? ' ' + refs.length : '') : '📝';
    const badge = `<span style="display:inline-block;margin-left:6px;padding:0 8px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border);font-size:13px;line-height:1.6;color:var(--text-primary)">${icon}${refs.length && item.detail.length ? ' 📝' : ''}</span>`;
    return `<div class="kb-ref-line" onclick="kbOpenItem(${item.li})" style="cursor:pointer;color:var(--gold-dark);text-decoration:underline;text-decoration-color:rgba(127,127,127,.4);text-underline-offset:3px">${text}${badge}</div>`;
  }).join('');
  return `<div style="font-size:15px;color:var(--text-primary);line-height:1.7;white-space:pre-wrap">${html}</div>`;
}

// Кнопка «в текст»: метка встаёт в конец строки, где стоял курсор, — то есть
// в конец пункта. Курсор запоминаем при уходе из поля: на телефоне нажатие
// кнопки уводит фокус раньше, чем она сработает.
let kbLastCaret = null;

function kbInsertMediaRef(i) {
  const ta = document.getElementById('kb-article-content');
  const m = kbEditMedia[i];
  if(!ta || !m) return;
  const tag = `[${m.type === 'video' ? 'видео' : 'фото'} ${i + 1}]`;
  const caret = document.activeElement === ta ? ta.selectionStart : kbLastCaret;
  let at = typeof caret === 'number' ? caret : ta.value.length;
  const eol = ta.value.indexOf('\n', at);
  at = eol < 0 ? ta.value.length : eol;
  const before = ta.value.slice(0, at).replace(/[ \t]+$/, ''), after = ta.value.slice(at);
  ta.value = before + (before ? ' ' : '') + tag + after;
  kbLastCaret = (before + (before ? ' ' : '') + tag).length;
  ta.focus();
  try { ta.setSelectionRange(kbLastCaret, kbLastCaret); } catch(e) {}
}

// Убрали файл — метки на него из текста уходят, а номера следующих сдвигаются,
// иначе «[видео 3]» стала бы показывать чужой ролик.
function kbRemoveMedia(i) {
  const [m] = kbEditMedia.splice(i, 1);
  if(m && !m.file) kbRemovedMedia.push(m);
  const ta = document.getElementById('kb-article-content');
  if(ta) {
    ta.value = ta.value.replace(/[ \t]?\[(видео|фото|video|photo|расм)\s*(\d+)\]/gi, (all, word, n) => {
      const k = parseInt(n, 10) - 1;
      if(k === i) return '';
      if(k > i) return all.replace(/\d+/, String(k));
      return all;
    });
  }
  kbRenderEditMedia();
}

function kbRenderEditMedia() {
  const box = document.getElementById('kb-article-media');
  if(!box) return;
  box.innerHTML = kbEditMedia.map((m, i) => {
    const name = m.file ? (m.file.name || '') : (m.path || '').split('/').pop();
    const size = m.file ? ` · ${(m.file.size / 1048576).toFixed(1)} МБ · ${t('kb.mediaNew')}` : '';
    // mousedown гасим, чтобы textarea не теряла курсор до нажатия «в текст»
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;border:1px solid var(--border);border-radius:10px;font-size:13px">
      <span style="font-weight:700;color:var(--text-muted)">${i + 1}</span>
      <span>${m.type === 'video' ? '🎥' : '🖼'}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">${escapeHtml(name)}<span style="color:var(--text-muted)">${size}</span></span>
      <button type="button" onmousedown="event.preventDefault()" onclick="kbInsertMediaRef(${i})" style="background:none;border:1px solid var(--border);border-radius:8px;color:var(--gold-dark);font-size:12px;font-weight:600;cursor:pointer;padding:3px 8px">${t('kb.mediaToText')}</button>
      <button type="button" onclick="kbRemoveMedia(${i})" style="background:none;border:none;color:#A32D2D;font-size:12px;font-weight:600;cursor:pointer">${t('kb.mediaRemove')}</button>
    </div>`;
  }).join('') + (kbEditMedia.length ? `<div style="font-size:12px;color:var(--text-muted);margin:2px 0 8px">${t('kb.mediaToTextHint')}</div>` : '');
}

function kbRenderDepts(selected) {
  const box = document.getElementById('kb-article-depts');
  if(!box) return;
  const sel = new Set(selected || []);
  box.innerHTML = KB_DEPTS.map(d => `<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:20px;font-size:13px;cursor:pointer;color:var(--text-primary)">
      <input type="checkbox" value="${escapeHtml(d)}" ${sel.has(d) ? 'checked' : ''}> ${DEPT_ICONS[d] || ''} ${escapeHtml(d)}</label>`).join('');
}

function kbCheckedDepts() {
  return Array.from(document.querySelectorAll('#kb-article-depts input:checked')).map(x => x.value);
}

function kbSetProgress(msg) {
  const el = document.getElementById('kb-article-progress');
  if(!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// Сжимает и загружает новое; уже загруженное оставляет как есть. Возвращает
// итоговый список для записи в статью или null, если что-то не вышло.
async function kbUploadPendingMedia(ac) {
  const total = kbEditMedia.filter(m => m.file).length;
  const out = [];
  let n = 0;
  for(const m of kbEditMedia) {
    if(!m.file) { out.push({ type: m.type, url: m.url, path: m.path }); continue; }
    n++;
    let file = m.file;
    if(m.type === 'video') {
      kbSetProgress(t('kb.shrinking', { i: n, n: total, p: 0 }));
      file = await shrinkTrainingVideo(file, ac, p => kbSetProgress(p >= 0
        ? t('kb.shrinking', { i: n, n: total, p })
        : t('kb.shrinkingSec', { i: n, n: total, s: -p })));
      if(file.size > KB_MAX_UPLOAD_MB * 1048576) {
        showToast(t('kb.tooBig', { name: m.file.name || '', mb: Math.round(file.size / 1048576) }));
        return null;
      }
    } else {
      file = await compressImage(file, 1600, 0.8);
    }
    kbSetProgress(t('kb.uploading', { i: n, n: total }));
    const ext = m.type === 'video' ? ((file.type || '').includes('webm') ? 'webm' : 'mp4') : 'jpg';
    const path = `kb/${Date.now()}-${n}.${ext}`;
    const { error } = await sb.storage.from('task-reports')
      .upload(path, file, { contentType: file.type || undefined, cacheControl: '31536000' });
    if(error) { showToast(t('kb.uploadErr') + error.message); return null; }
    const url = sb.storage.from('task-reports').getPublicUrl(path).data.publicUrl;
    // Загруженное запоминаем на месте: если дальше что-то упадёт, повторное
    // сохранение не будет слать этот файл заново
    delete m.file; m.url = url; m.path = path;
    out.push({ type: m.type, url, path });
  }
  return out;
}

// Для mp4 просим кодек вместе со звуком: без явного аудиокодека браузер
// пишет ролик немым. H.264 — чтобы играло и на айфонах (см. pickRecorderMime).
function pickTrainingMime() {
  const types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for(const ty of types) { if(MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(ty)) return ty; }
  return '';
}

// Пережимает ролик прямо в браузере: проигрывает его в невидимый холст и
// записывает заново, поэтому идёт столько, сколько длится видео. Не вышло
// (старый браузер, кодек, звук не захватился) — возвращает оригинал: проверку
// размера делает вызывающий.
async function shrinkTrainingVideo(file, ac, onProgress) {
  if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return file;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    video.src = url; video.playsInline = true; video.preload = 'auto';
    await new Promise((ok, fail) => {
      video.onloadedmetadata = ok;
      video.onerror = () => fail(new Error('metadata'));
      setTimeout(() => fail(new Error('timeout')), 15000);
    });
    const w = video.videoWidth || KB_VIDEO_SIDE, h = video.videoHeight || KB_VIDEO_SIDE;
    const dur = video.duration;
    // Уже лёгкий ролик пережимать незачем: только потеряем качество и время
    if(isFinite(dur) && dur > 0 && file.size * 8 / dur <= KB_VIDEO_BITRATE * 1.5 && Math.max(w, h) <= KB_VIDEO_SIDE * 1.2) return file;

    const scale = Math.min(1, KB_VIDEO_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    // чётные стороны: H.264 нечётные не любит
    canvas.width = Math.max(2, Math.round(w * scale / 2) * 2);
    canvas.height = Math.max(2, Math.round(h * scale / 2) * 2);
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    // Звук — через AudioContext: в динамик он не идёт (выход никуда не
    // подключён), только в запись. Без него голос в обучалке пропал бы.
    if(!ac) return file;
    try {
      const src = ac.createMediaElementSource(video);
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
    } catch(e) { return file; }

    const mime = pickTrainingMime();
    const opts = { videoBitsPerSecond: KB_VIDEO_BITRATE, audioBitsPerSecond: KB_AUDIO_BITRATE };
    if(mime) opts.mimeType = mime;
    const rec = new MediaRecorder(stream, opts);
    const chunks = [];
    rec.ondataavailable = ev => { if(ev.data && ev.data.size) chunks.push(ev.data); };
    const stopped = new Promise(ok => { rec.onstop = ok; });
    rec.start(1000);
    try { await video.play(); }
    catch(e) { rec.stop(); await stopped; return file; }

    // Ждём конца ролика. Если кадры перестали идти (экран погас, вкладку
    // свернули) дольше 20 секунд — бросаем и отдаём оригинал.
    const ok = await new Promise(done => {
      let lastT = -1, lastMove = Date.now(), lastP = -1;
      const tick = () => {
        try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch(e) {}
        if(video.ended) return done(true);
        if(video.currentTime !== lastT) { lastT = video.currentTime; lastMove = Date.now(); }
        else if(Date.now() - lastMove > 20000) return done(false);
        // Длительность бывает неизвестна (webm из записи экрана) — тогда
        // показываем пройденные секунды вместо процентов
        if(onProgress) {
          const known = isFinite(dur) && dur > 0;
          const p = known ? Math.min(99, Math.floor(video.currentTime / dur * 100)) : -Math.floor(video.currentTime);
          if(p !== lastP) { lastP = p; onProgress(p); }
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
    rec.stop();
    await stopped;
    if(!ok) return file;
    const type = (chunks[0] && chunks[0].type) || mime || 'video/webm';
    const blob = new Blob(chunks, { type });
    if(!blob.size || blob.size >= file.size) return file;
    const name = (file.name || 'video').replace(/\.[^.]+$/, '') + (type.includes('mp4') ? '.mp4' : '.webm');
    try { return new File([blob], name, { type }); }
    catch(e) { blob.name = name; return blob; }
  } catch(e) {
    console.error('shrinkTrainingVideo failed', e);
    return file;
  } finally {
    try { video.pause(); } catch(e) {}
    URL.revokeObjectURL(url);
  }
}
