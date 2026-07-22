// ============ ПОМОЩНИК (HELP) ============
// Быстрые вопросы-подсказки (двуязычные — язык фиксирован на загрузку страницы)
const HELP_SUGGESTIONS = (typeof getLang==='function' && getLang()==='uz') ? [
  'Келишни қаерда белгилайман?',
  'Идиш синишини қандай ёзаман?',
  'Маошимни қаердан кўраман?',
  'Меҳмон фикрини қандай киритаман?',
  'Чек-листлар қаерда?',
  'Паролни қандай ўзгартираман?'
] : [
  'Где отметить приход?',
  'Как записать бой посуды?',
  'Где посмотреть мою зарплату?',
  'Как внести отзыв гостя?',
  'Где чек-листы?',
  'Как сменить пароль?'
];

// Статичная карта разделов — показывается, если ИИ недоступен
const HELP_FALLBACK = (typeof getLang==='function' && getLang()==='uz') ? [
  { t:'🏠 Асосий', d:'Келиш-кетишни белгилаш, маош, бугунги вазифалар' },
  { t:'✅ Вазифалар', d:'Кунлар бўйича вазифаларинг, фотоҳисоботлар' },
  { t:'☑️ Смена', d:'Смена очиш ва ёпиш чек-листлари' },
  { t:'📅 Жадвал', d:'Ҳафталар бўйича смена жадвали' },
  { t:'📄 Шахсий кабинет', d:'Яна → маош, сменалар, ютуқлар, парол алмаштириш' },
  { t:'🍽️ Идиш-товоқ', d:'Яна → идиш ҳисоби ва синишни ёзиш' },
  { t:'🧴 Хўжалик қисми', d:'Яна → сарф материаллар: складдан олиш, кирим, ҳисобот' },
  { t:'⭐ Фикрлар', d:'Яна → меҳмон фикрлари, ИИ ўзи саралайди' },
  { t:'📚 Билимлар базаси', d:'Яна → регламент ва стандартлар, қидирув бор' },
  { t:'💬 Умумий чат', d:'Яна → бўлимлар бўйича чат' },
  { t:'📢 Лента', d:'Яна → эълонлар ва сўровлар' },
  { t:'📅 Тақвим', d:'Яна → етказиб беришлар, текширувлар, банкетлар' },
] : [
  { t:'🏠 Главная', d:'Отметка прихода и ухода, зарплата, задачи на сегодня' },
  { t:'✅ Задачи', d:'Твои задачи по дням, фото-отчёты' },
  { t:'☑️ Смена', d:'Чек-листы открытия и закрытия смены' },
  { t:'📅 График', d:'Расписание смен по неделям' },
  { t:'📄 Личный кабинет', d:'Ещё → зарплата, смены, достижения, смена пароля' },
  { t:'🍽️ Посуда', d:'Ещё → учёт посуды и запись боя' },
  { t:'🧴 Хозчасть', d:'Ещё → расходники: взять со склада, приход, отчёт' },
  { t:'⭐ Отзывы', d:'Ещё → отзывы гостей, ИИ сам сортирует' },
  { t:'📚 База знаний', d:'Ещё → регламенты и стандарты, есть поиск' },
  { t:'💬 Общий чат', d:'Ещё → чат по отделам' },
  { t:'📢 Лента', d:'Ещё → объявления и опросы' },
  { t:'📅 Календарь', d:'Ещё → доставки, проверки, банкеты' },
];

function helpBubble(text, isMine) {
  return `<div style="align-self:${isMine?'flex-end':'flex-start'};max-width:85%">
    <div style="background:${isMine?'var(--gold-dark)':'var(--surface-2)'};color:${isMine?'#fff':'var(--text-primary)'};border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.5;white-space:pre-wrap;${isMine?'border-bottom-right-radius:4px':'border-bottom-left-radius:4px'}">${escapeHtml(text)}</div>
  </div>`;
}

function loadHelp() {
  const chat = document.getElementById('help-chat');
  if(!chat) return;
  // Приветствие + быстрые вопросы (только при первом входе)
  if(chat.dataset.inited === '1') return;
  chat.dataset.inited = '1';
  chat.innerHTML = helpBubble(t('help.greeting'), false) +
    `<div id="help-suggestions" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
      ${HELP_SUGGESTIONS.map(q=>`<button onclick="askHelp('${q.replace(/'/g,"\\'")}')" style="background:var(--surface-2);border:1px solid var(--border);border-radius:16px;padding:7px 12px;font-size:12px;color:var(--text-primary);cursor:pointer">${q}</button>`).join('')}
    </div>`;
}

async function askHelp(preset) {
  const input = document.getElementById('help-input');
  const question = (preset || input.value).trim();
  if(!question) return;
  const chat = document.getElementById('help-chat');
  input.value = '';
  // Убираем подсказки после первого вопроса
  const sug = document.getElementById('help-suggestions');
  if(sug) sug.remove();

  chat.insertAdjacentHTML('beforeend', helpBubble(question, true));
  chat.insertAdjacentHTML('beforeend', `<div id="help-typing" style="align-self:flex-start;color:var(--text-muted);font-size:13px;padding:6px 4px">${t('help.thinking')}</div>`);
  chat.scrollTop = chat.scrollHeight;

  try {
    const { data: sessionData } = await sb.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const roleLabels = { admin:'Управляющий', manager:'Менеджер', employee:'Сотрудник', boss:'Владелец (наблюдатель)' };
    const res = await fetch('https://omeomdkurvtvirhfkffu.supabase.co/functions/v1/ask-slon', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_KEY, 'Authorization':'Bearer '+(accessToken||SUPABASE_KEY) },
      body: JSON.stringify({ question, role: roleLabels[currentRole()] || '' })
    });
    const result = await res.json();
    document.getElementById('help-typing')?.remove();

    if(result.answer) {
      chat.insertAdjacentHTML('beforeend', helpBubble(result.answer, false));
    } else {
      showHelpFallback(chat);
    }
  } catch(e) {
    document.getElementById('help-typing')?.remove();
    showHelpFallback(chat);
  }
  chat.scrollTop = chat.scrollHeight;
}

// Если ИИ недоступен — показываем обычный справочник разделов
function showHelpFallback(chat) {
  chat.insertAdjacentHTML('beforeend', `<div style="align-self:flex-start;max-width:95%">
    <div style="background:var(--surface-2);border-radius:14px;padding:12px 14px;font-size:13px;color:var(--text-primary);border-bottom-left-radius:4px">
      <div style="margin-bottom:10px;color:var(--text-muted)">${t('help.fallbackIntro')}</div>
      ${HELP_FALLBACK.map(s=>`<div style="padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:600">${s.t}</div>
        <div style="font-size:12px;color:var(--text-muted)">${s.d}</div>
      </div>`).join('')}
    </div>
  </div>`);
}

