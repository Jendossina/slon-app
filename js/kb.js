// ============ KNOWLEDGE BASE ============
let kbCurrentBookId = null;

function kbCanEdit() { return currentRole() === 'admin'; }

function escapeHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Для вставки пользовательских строк внутрь одинарных кавычек JS-аргумента в onclick="fn('...')"
function escJsAttr(s) {
  return escapeHtml(s).replace(/'/g,"\\'");
}

async function loadKnowledgeBase() {
  kbCurrentBookId = null;
  const searchEl = document.getElementById('kb-search');
  if(searchEl && document.activeElement !== searchEl) searchEl.value = '';
  document.getElementById('kb-title').textContent = t('kb.title');
  document.getElementById('kb-subtitle').textContent = t('kb.subtitle');
  const addBtn = document.getElementById('kb-add-book-btn');
  if(addBtn) { addBtn.style.display = kbCanEdit() ? 'block' : 'none'; addBtn.onclick = openKbBookModal; addBtn.textContent = t('kb.addBook'); }

  const content = document.getElementById('kb-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data: books } = await sb.from('kb_books').select('*').order('sort_order').order('created_at');
    if(!books || books.length===0) {
      content.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">📚</div><div class="empty-text">${t('kb.noBooks')}${kbCanEdit()?t('kb.noBooksHint'):''}</div></div></div>`;
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
        const lc = (a.content||'').toLowerCase();
        const pos = lc.indexOf(q);
        let snippet = '';
        if(pos>=0) {
          const start = Math.max(0, pos-40);
          snippet = (start>0?'…':'') + (a.content||'').slice(start, pos+q.length+60) + '…';
        } else {
          snippet = (a.content||'').slice(0,100);
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
    document.getElementById('kb-title').textContent = (book?.icon||'📖') + ' ' + (book?.title||'Книга');
    document.getElementById('kb-subtitle').textContent = t('kb.tapArticle');
    const addBtn = document.getElementById('kb-add-book-btn');
    if(addBtn) {
      addBtn.style.display = kbCanEdit() ? 'block' : 'none';
      addBtn.textContent = t('kb.addArticle');
      addBtn.onclick = () => openKbArticleModal(bookId);
    }

    const { data: articles } = await sb.from('kb_articles').select('*').eq('book_id', bookId).order('sort_order').order('created_at');

    let html = `<div style="margin-bottom:12px"><button onclick="loadKnowledgeBase()" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${t('kb.allBooks')}</button>`;
    if(kbCanEdit()) html += ` <button onclick="openKbBookModal(${book.id})" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${t('kb.editBook')}</button>`;
    html += `</div>`;

    if(!articles || articles.length===0) {
      html += `<div class="card"><div class="empty"><div class="empty-icon">📄</div><div class="empty-text">${t('kb.noArticles')}${kbCanEdit()?t('kb.noArticlesHint'):''}</div></div></div>`;
    } else {
      html += articles.map(a=>`
        <div class="card" style="cursor:pointer" onclick="openKbArticle(${a.id})">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary)">${escapeHtml(a.title)}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">${escapeHtml((a.content||'').slice(0,80))}${(a.content||'').length>80?'…':''}</div>
        </div>`).join('');
    }
    content.innerHTML = html;
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('kb.loadErr')}</div></div></div>`; }
}

async function openKbArticle(articleId) {
  const content = document.getElementById('kb-content');
  content.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const { data: a } = await sb.from('kb_articles').select('*').eq('id', articleId).single();
    document.getElementById('kb-title').textContent = escapeHtml(a.title);
    document.getElementById('kb-subtitle').textContent = '';
    const addBtn = document.getElementById('kb-add-book-btn');
    if(addBtn) addBtn.style.display = 'none';

    let html = `<div style="margin-bottom:12px"><button onclick="openKbBook(${a.book_id})" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${t('kb.back')}</button>`;
    if(kbCanEdit()) html += ` <button onclick="openKbArticleModal(${a.book_id}, ${a.id})" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">${t('kb.edit')}</button>`;
    html += `</div>`;
    html += `<div class="card"><div style="font-size:20px;font-weight:700;color:var(--text-primary);margin-bottom:12px">${escapeHtml(a.title)}</div>
      <div style="font-size:15px;color:var(--text-primary);line-height:1.7;white-space:pre-wrap">${escapeHtml(a.content||'')}</div></div>`;
    content.innerHTML = html;
  } catch(e) { content.innerHTML = `<div class="card"><div class="empty"><div class="empty-text">${t('kb.loadErr')}</div></div></div>`; }
}

// --- Book create/edit ---
function openKbBookModal(bookId) {
  if(!kbCanEdit()) return;
  document.getElementById('kb-book-id').value = bookId || '';
  const delBtn = document.getElementById('kb-book-delete-btn');
  if(bookId) {
    document.getElementById('kb-book-modal-title').textContent = t('kb.editBookTitle');
    delBtn.style.display = 'block';
    sb.from('kb_books').select('*').eq('id', bookId).single().then(({data})=>{
      document.getElementById('kb-book-icon').value = data?.icon || '';
      document.getElementById('kb-book-title').value = data?.title || '';
    });
  } else {
    document.getElementById('kb-book-modal-title').textContent = t('kb.newBook');
    document.getElementById('kb-book-icon').value = '';
    document.getElementById('kb-book-title').value = '';
    delBtn.style.display = 'none';
  }
  openModal('modal-kb-book');
}

async function saveKbBook() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const id = document.getElementById('kb-book-id').value;
  const icon = document.getElementById('kb-book-icon').value.trim() || '📖';
  const title = document.getElementById('kb-book-title').value.trim();
  if(!title) return showToast(t('inv.enterName'));
  try {
    if(id) {
      await sb.from('kb_books').update({icon, title}).eq('id', id);
    } else {
      await sb.from('kb_books').insert({icon, title});
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
  if(articleId) {
    document.getElementById('kb-article-modal-title').textContent = t('kb.editArticleTitle');
    delBtn.style.display = 'block';
    sb.from('kb_articles').select('*').eq('id', articleId).single().then(({data})=>{
      document.getElementById('kb-article-title').value = data?.title || '';
      document.getElementById('kb-article-content').value = data?.content || '';
    });
  } else {
    document.getElementById('kb-article-modal-title').textContent = t('kb.newArticle');
    document.getElementById('kb-article-title').value = '';
    document.getElementById('kb-article-content').value = '';
    delBtn.style.display = 'none';
  }
  openModal('modal-kb-article');
}

async function saveKbArticle() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const id = document.getElementById('kb-article-id').value;
  const bookId = document.getElementById('kb-article-book-id').value;
  const title = document.getElementById('kb-article-title').value.trim();
  const contentText = document.getElementById('kb-article-content').value;
  if(!title) return showToast(t('feed.enterTitle'));
  try {
    if(id) {
      await sb.from('kb_articles').update({title, content: contentText, updated_at: new Date().toISOString()}).eq('id', id);
    } else {
      await sb.from('kb_articles').insert({book_id: parseInt(bookId), title, content: contentText});
    }
    closeModal('modal-kb-article');
    showToast(t('sch.saved'));
    openKbBook(parseInt(bookId));
  } catch(e) { showToast(t('common.error')+e.message); }
}

async function deleteKbArticle() {
  if(!canEditData()) return showToast(t('common.observerMode'));
  const id = document.getElementById('kb-article-id').value;
  const bookId = document.getElementById('kb-article-book-id').value;
  if(!id) return;
  if(!await confirmDialog(t('kb.delArticleConfirm'))) return;
  try {
    await sb.from('kb_articles').delete().eq('id', id);
    closeModal('modal-kb-article');
    showToast(t('kb.articleDeleted'));
    openKbBook(parseInt(bookId));
  } catch(e) { showToast(t('common.error')+e.message); }
}

