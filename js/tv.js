// ============ ЭКРАН В ГОСТЕВОЙ ЗОНЕ ============
//
// Страница открывается на ТВ-боксе в режиме киоска: slon-app.vercel.app/tv
// Фоном крутится ролик с YouTube (обычно двухчасовой), раз в несколько минут
// он встаёт на паузу, во весь экран показывается карточка с акцией, потом
// ролик продолжается С ТОЙ ЖЕ СЕКУНДЫ — пауза позицию не теряет.
//
// Почему пауза, а не плашка поверх: звук с телевизоров в зал не идёт (музыка
// играет отдельно, через колонки), поэтому остановка картинки ничего не рвёт,
// а карточку во весь экран видно от любого стола.
//
// Логина здесь нет и быть не может: бокс висит на стене. Читаем анонимно —
// в таблицах только то, что и так показано гостям.

const TV_URL = 'https://omeomdkurvtvirhfkffu.supabase.co';
const TV_KEY = 'sb_publishable_h7pdCQTKnGIlIR9SaswShw_ur8eauw6';
const sb = supabase.createClient(TV_URL, TV_KEY, { auth: { persistSession: false } });

// Код экрана. Раньше его набирали пультом в адресной строке — пять минут
// мучений по экранной клавиатуре. Теперь страница придумывает код сама,
// запоминает его на боксе и показывает крупно: в приложении экран появится
// сам. Код из адреса по-прежнему уважаем — так удобнее перенести уже
// настроенный экран на другой бокс.
const CODE_KEY = 'slon_tv_code';
// Буквы и цифры, которые не спутаешь с другого конца зала: ни нуля с
// буквой O, ни единицы с I.
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';

function makeCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

function resolveCode() {
  const fromUrl = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
  if (fromUrl) {
    try { localStorage.setItem(CODE_KEY, fromUrl); } catch (e) {}
    return fromUrl;
  }
  let saved = null;
  try { saved = localStorage.getItem(CODE_KEY); } catch (e) {}
  if (saved) return saved;
  const fresh = makeCode();
  try { localStorage.setItem(CODE_KEY, fresh); } catch (e) {}
  return fresh;
}

const CODE = resolveCode();
const CACHE_KEY = 'slon_tv_payload_' + CODE;
const REFRESH_MS = 60000;      // как часто перечитываем настройки и врезки
const NIGHT_RELOAD_HOUR = 5;   // тихая перезагрузка страницы под утро

let screenRow = null;
let slides = [];
let player = null;
let playerReady = false;
let slidePointer = 0;
let showingCard = false;
let playerFailed = false;   // ролик не заиграл — зал занимают карточки

// ===== Служебное окно =====
// Видно только когда показывать нечего: экран не привязан, нет связи, ролик
// запрещён к встраиванию. Человеку у стены должно быть понятно, что делать.
function showNotice(html, corner) {
  const el = document.getElementById('status');
  el.classList.remove('corner');
  if (!html) { el.classList.remove('on'); el.innerHTML = ''; return; }
  el.innerHTML = html;
  el.classList.add('on');
  if (corner) el.classList.add('corner');
}

// ===== Разбор ссылки на YouTube =====
// Принимаем её в любом виде, как люди копируют: watch?v=, youtu.be, /embed/,
// плейлист или просто идентификатор ролика.
function parseYoutube(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const ID = /^[A-Za-z0-9_-]{11}$/;
  let u;
  try { u = new URL(s); } catch (e) { return ID.test(s) ? { videoId: s } : null; }
  const list = u.searchParams.get('list');
  const v = u.searchParams.get('v');
  if (v) return { videoId: v, listId: list };
  if (u.hostname.indexOf('youtu.be') >= 0) return { videoId: u.pathname.slice(1).split('/')[0], listId: list };
  const parts = u.pathname.split('/').filter(Boolean);
  const emb = parts.indexOf('embed');
  if (emb >= 0 && parts[emb + 1]) return { videoId: parts[emb + 1], listId: list };
  if (list) return { listId: list };
  return null;
}

// ===== Данные =====
// Ответ кладём в память браузера: свет мигнул, сети ещё нет, а экран уже
// должен что-то показывать. Ролик без сети всё равно не пойдёт, но карточки
// крутиться будут.
async function loadData() {
  const { data: scr, error } = await sb.from('screens').select('*').eq('code', CODE).maybeSingle();
  if (error) throw error;
  if (!scr) throw new Error('нет такого экрана');
  const { data: sl } = await sb.from('screen_slides').select('*').eq('is_active', true).order('sort').order('id');
  screenRow = scr;
  slides = (sl || []).filter(function (s) {
    return (!s.screen_id || s.screen_id === scr.id) && (!s.filial || s.filial === scr.filial);
  });
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ screenRow: screenRow, slides: slides, at: Date.now() })); } catch (e) {}
}

function loadCached() {
  try {
    const p = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!p || !p.screenRow) return false;
    screenRow = p.screenRow;
    slides = p.slides || [];
    return true;
  } catch (e) { return false; }
}

// ===== Когда врезку показывать можно =====
// Всё считаем по часам самого бокса: он стоит в зале, его время и есть местное.
function slideDue(s, now) {
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const ymd = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  if (s.date_from && ymd < s.date_from) return false;
  if (s.date_to && ymd > s.date_to) return false;
  if (Array.isArray(s.weekdays) && s.weekdays.length && s.weekdays.indexOf(now.getDay()) < 0) return false;
  const h = now.getHours();
  const from = s.hour_from;
  const to = s.hour_to;
  if (from != null && to != null) {
    // Окно через полночь (22–4) для вечернего заведения — норма, а не ошибка
    const inside = from <= to ? (h >= from && h <= to) : (h >= from || h <= to);
    if (!inside) return false;
  } else if (from != null && h < from) return false;
  else if (to != null && h > to) return false;
  return true;
}

function dueSlides() {
  const now = new Date();
  return slides.filter(function (s) { return slideDue(s, now); });
}

// ===== Показ карточки =====
function renderCard(s) {
  const box = document.getElementById('card');
  const inner = box.querySelector('.inner');
  const esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  const old = box.querySelectorAll('img.full, video.full');
  for (let i = 0; i < old.length; i++) { try { old[i].pause(); } catch (e) {} old[i].remove(); }
  if (s.kind === 'video' && s.image_url) {
    inner.innerHTML = '';
    const vid = document.createElement('video');
    vid.className = 'full';
    vid.src = s.image_url;
    vid.muted = true;             // звук в зал идёт с колонок, а не отсюда
    vid.autoplay = true;
    vid.playsInline = true;
    box.appendChild(vid);
    return vid;
  }
  if (s.kind === 'image' && s.image_url) {
    inner.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'full';
    img.src = s.image_url;
    box.appendChild(img);
    return;
  }
  inner.innerHTML =
    (s.title ? '<h1>' + esc(s.title) + '</h1>' : '') +
    (s.body ? '<p>' + esc(s.body) + '</p>' : '') +
    (s.note ? '<div class="note">' + esc(s.note) + '</div>' : '');
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function slideSeconds(s) {
  return Math.max(3, Number(s.duration_sec) || Number(screenRow && screenRow.slide_seconds) || 20);
}

async function showCard(s) {
  const box = document.getElementById('card');
  const media = renderCard(s);
  box.classList.add('on');
  await wait(600);                       // даём затемнению дойти до конца
  // Ролик доигрываем до конца, а не по таймеру: обрубленная на полуслове
  // вставка заметнее, чем лишние пять секунд. Длительность из настроек
  // остаётся только потолком на случай, если видео зависнет.
  if (s.kind === 'video' && media) {
    await Promise.race([
      new Promise(function (ok) { media.addEventListener('ended', ok, { once: true }); }),
      wait(Math.max(slideSeconds(s), 120) * 1000),
    ]);
  } else {
    await wait(slideSeconds(s) * 1000);
  }
  box.classList.remove('on');
  await wait(600);
}

// ===== Врезка =====
async function runBreak() {
  if (showingCard) return;
  const due = dueSlides();
  if (!due.length) return;
  showingCard = true;
  try {
    const count = Math.max(1, Math.min(Number(screenRow.slides_per_break) || 1, due.length));
    if (player && playerReady) { try { player.pauseVideo(); } catch (e) {} }
    for (let i = 0; i < count; i++) {
      const s = due[slidePointer % due.length];
      slidePointer++;
      ping(s.title || s.kind);
      await showCard(s);
    }
    if (player && playerReady) { try { player.playVideo(); } catch (e) {} }
  } finally { showingCard = false; }
}

// Включаем карусель карточек, если она ещё не идёт: ролика нет вовсе или он
// отвалился уже на ходу.
let cardsLoopStarted = false;
function startCardsFallback() {
  if (cardsLoopStarted) return;
  cardsLoopStarted = true;
  cardsOnlyLoop();
}

// Ролика нет — карточки крутятся сами по себе, без пауз между ними
async function cardsOnlyLoop() {
  const box = document.getElementById('card');
  while (true) {
    const due = dueSlides();
    if (!due.length) {
      // Если ролик отвалился, его объяснение в углу важнее — не затираем
      if (!playerFailed) showNotice('<b>Экран привязан</b>Добавьте врезки в приложении — они появятся здесь сами.');
      box.classList.remove('on');
      await wait(15000);
      continue;
    }
    if (!playerFailed) showNotice('');
    const s = due[slidePointer % due.length];
    slidePointer++;
    ping(s.title || s.kind);
    renderCard(s);
    box.classList.add('on');
    await wait(slideSeconds(s) * 1000);
  }
}

// ===== Заявка о себе =====
// Экран сам сообщает базе, что он существует. В приложении он появляется
// строкой «ждёт привязки», и остаётся только назвать его и вставить ссылку.
async function announce() {
  try {
    await sb.rpc('screen_announce', { p_code: CODE, p_agent: String(navigator.userAgent || '').slice(0, 300) });
    return true;
  } catch (e) { return false; }
}

// Пока экраном не занялись, показываем только его код: чужие акции на
// неизвестном телевизоре хуже, чем пустой экран.
function showPairing() {
  showNotice('<b>Экран готов к привязке</b>' +
    'Откройте приложение: «Ещё» → «Экраны». Там уже появился этот экран — ' +
    'назовите его и вставьте ссылку на ролик.<br><br>Код экрана <code>' + CODE + '</code>');
}

// ===== Пульс =====
// Через функцию в базе, а не обычным update: страница открыта в зале без
// логина, и переписывать ей ссылку на ролик или настройки нельзя.
async function ping(slide) {
  try { await sb.rpc('screen_ping', { p_code: CODE, p_slide: slide || null }); } catch (e) {}
}

// ===== YouTube =====
function startPlayer(parsed) {
  const vars = {
    autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0,
    modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3,
  };
  if (parsed.listId) {
    vars.list = parsed.listId;
    vars.listType = 'playlist';
  } else {
    // Зацикливание одного ролика ютуб понимает только так: loop без playlist
    // молча ничего не делает, и под утро экран гаснет на стоп-кадре.
    vars.playlist = parsed.videoId;
    vars.loop = 1;
  }
  player = new YT.Player('player', {
    videoId: parsed.videoId,
    playerVars: vars,
    events: {
      onReady: function (e) { playerReady = true; e.target.mute(); e.target.playVideo(); showNotice(''); },
      onStateChange: function (e) {
        // Пошло воспроизведение — прошлые попытки больше не в счёт: следующая
        // поломка, если она случится, получит свои три захода.
        if (e.data === YT.PlayerState.PLAYING) { try { sessionStorage.removeItem(RETRY_KEY); } catch (x) {} }
        if (e.data === YT.PlayerState.ENDED && !showingCard) { try { player.playVideo(); } catch (x) {} }
      },
      onError: function (e) {
        // 101 и 150 — владелец запретил встраивать ролик на чужих сайтах.
        // Экран висит на виду у гостей, поэтому объяснение уходит в угол
        // мелким шрифтом, а зал занимают карточки: пустая стена с сообщением
        // об ошибке хуже, чем стена с акциями.
        const why = (e.data === 101 || e.data === 150)
          ? 'Этот ролик владелец запретил встраивать на других сайтах. Возьмите другую ссылку.'
          : 'Ролик не открылся. Проверьте ссылку и интернет на боксе.';
        console.warn('плеер ютуба вернул ошибку', e.data);
        showNotice('<b>Ролик не играет</b>' + why, true);
        playerFailed = true;
        playerReady = false;
        startCardsFallback();
        retryVideoLater();
      },
    },
  });
}

// Одна ошибка плеера — ещё не приговор ролику: мог моргнуть интернет или
// подавиться сам ютуб. Через десять минут пробуем заново, перезагрузив
// страницу: это дешевле и надёжнее, чем пересобирать плеер на ходу. Сколько
// раз уже пробовали, помним до перезагрузки бокса — после отключения света
// счётчик обнулится, и это правильно, там обстановка уже другая.
const RETRY_KEY = 'slon_tv_video_retries';
const MAX_VIDEO_RETRIES = 3;

function retryVideoLater() {
  let done = 0;
  try { done = Number(sessionStorage.getItem(RETRY_KEY)) || 0; } catch (e) {}
  if (done >= MAX_VIDEO_RETRIES) return;          // ролик правда сломан — остаёмся на карточках
  try { sessionStorage.setItem(RETRY_KEY, String(done + 1)); } catch (e) {}
  setTimeout(function () { if (!showingCard) location.reload(); }, 10 * 60000);
}

function loadYoutubeApi() {
  return new Promise(function (ok) {
    if (window.YT && window.YT.Player) return ok();
    window.onYouTubeIframeAPIReady = ok;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
}

// Что из настроек нельзя применить на ходу: плеер ютуба не переделать под
// новую ссылку, а ритм врезок живёт в setInterval. Проще перезагрузить
// страницу — для телевизора это полсекунды черноты.
function settingsChanged(row, startedWith, startedEvery) {
  if (!row) return false;
  if (row.pending) return true;                         // экран отвязали
  if ((row.youtube_url || null) !== startedWith) return true;
  if ((Number(row.insert_every_min) || 15) !== startedEvery) return true;
  return false;
}

// ===== Ночная перезагрузка =====
// Экран не выключают месяцами, а браузер за это время течёт и начинает
// заикаться. Дешевле перезагрузить страницу под утро, когда зал пуст.
function scheduleNightReload() {
  setInterval(function () {
    const now = new Date();
    if (now.getHours() === NIGHT_RELOAD_HOUR && now.getMinutes() < 5 && !showingCard) location.reload();
  }, 4 * 60000);
}

// ===== Запуск =====
async function startTv() {
  showNotice('<b>Загружаю…</b><code>' + CODE + '</code>');
  await announce();
  try {
    await loadData();
  } catch (e) {
    if (!loadCached()) {
      showNotice('<b>Нет связи</b>Бокс не видит интернет. Код экрана <code>' + CODE + '</code>');
      setTimeout(function () { location.reload(); }, 60000);
      return;
    }
  }

  // Экраном ещё не занялись — стоим на заставке с кодом и ждём
  while (screenRow && screenRow.pending) {
    showPairing();
    await wait(10000);
    await loadData().catch(function () {});
  }
  showNotice('');
  ping('запуск');

  // Ссылку на ролик и настройки врезок правят в телефоне уже после того,
  // как экран повесили. Плеер ютуба на ходу не переделать, поэтому при
  // смене ссылки просто перезагружаем страницу — для телевизора это
  // полсекунды черноты, зато настройка из приложения доезжает сразу, а не
  // «когда-нибудь под утро». Первая же настройка идёт именно этим путём:
  // экран привязали, ссылку вставили следом.
  const startedWith = screenRow.youtube_url || null;
  const startedEvery = Number(screenRow.insert_every_min) || 15;
  setInterval(function () {
    loadData().then(function () {
      if (showingCard) return;                          // не рвём врезку на полуслове
      if (settingsChanged(screenRow, startedWith, startedEvery)) location.reload();
    }).catch(function () {});
  }, REFRESH_MS);
  setInterval(function () { ping(); }, REFRESH_MS);
  scheduleNightReload();

  const parsed = parseYoutube(startedWith);
  if (!parsed) { startCardsFallback(); return; }
  await loadYoutubeApi();
  startPlayer(parsed);
  setInterval(runBreak, startedEvery * 60000);
}

if (typeof window !== 'undefined' && !window.__TV_NO_AUTOSTART) startTv();
