// ============ ЭКРАНЫ В ГОСТЕВОЙ ЗОНЕ ============
//
// Вкладка управления телевизорами в зале. Сам экран показывает страница
// /tv.html (js/tv.js): фоном ролик с YouTube, раз в несколько минут врезка с
// акцией во весь экран.
//
// Экран здесь — это ПЛЕЕР, а не панель. В Чехове один бокс раздаёт картинку по
// HDMI на два телевизора и проектор: это одна строка, а не три.
//
// Пока вкладку видит только владелец (см. canSeeScreens в core.js): функция
// обкатывается на живом зале, и показывать её всем рано.

let screensList = [];
let screenSlides = [];

const SCREEN_FILIALS = [
  { id: '', name: 'Все филиалы' },
  { id: 'chekhov', name: 'Чехов' },
  { id: 'istikbol', name: 'Истикбол' },
];

const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function tvPageUrl(code) {
  return location.origin + '/tv?code=' + encodeURIComponent(code);
}

// «На связи» считаем по последнему пульсу: страница отмечается раз в минуту,
// поэтому пять минут молчания — это уже не сеть моргнула, а экран не работает.
function screenAlive(s) {
  if (!s.last_seen_at) return false;
  return Date.now() - new Date(s.last_seen_at).getTime() < 5 * 60000;
}

function screenSeenText(s) {
  if (!s.last_seen_at) return 'ни разу не выходил на связь';
  const mins = Math.round((Date.now() - new Date(s.last_seen_at).getTime()) / 60000);
  if (mins < 2) return 'на связи';
  if (mins < 60) return 'молчит ' + mins + ' мин';
  const hours = Math.round(mins / 60);
  if (hours < 24) return 'молчит ' + hours + ' ч';
  return 'молчит с ' + new Date(s.last_seen_at).toLocaleDateString('ru-RU');
}

async function loadScreens() {
  const box = document.getElementById('screens-content');
  if (!canSeeScreens()) { box.innerHTML = '<div class="empty">Раздел недоступен</div>'; return; }
  box.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const [{ data: scr, error: e1 }, { data: sl, error: e2 }] = await Promise.all([
      sb.from('screens').select('*').order('id'),
      sb.from('screen_slides').select('*').order('sort').order('id'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    screensList = scr || [];
    screenSlides = sl || [];
    renderScreens();
  } catch (e) {
    box.innerHTML = '<div class="empty">Не удалось загрузить: ' + escapeHtml(e.message || '') + '</div>';
  }
}

function renderScreens() {
  const box = document.getElementById('screens-content');
  // Экраны, которые заявились сами и ждут, пока ими займутся, — наверх:
  // человек стоит у телевизора и ждёт, пока код появится в телефоне.
  const pending = screensList.filter(function (s) { return s.pending; });
  const ready = screensList.filter(function (s) { return !s.pending; });
  const pendingHtml = pending.length
    ? '<div class="section-title" style="margin-top:0">Ждут привязки</div>' +
      pending.map(renderPendingCard).join('')
    : '';
  const screensHtml = ready.length
    ? ready.map(renderScreenCard).join('')
    : '<div class="empty">Экранов пока нет. Откройте на боксе <b>slon-app.vercel.app/tv</b> — ' +
      'экран появится здесь сам, со своим кодом.</div>';
  const slidesHtml = screenSlides.length
    ? screenSlides.map(renderSlideCard).join('')
    : '<div class="empty">Врезок нет. Пока их нет, экран просто крутит ролик.</div>';
  box.innerHTML = pendingHtml +
    '<div class="section-title"' + (pendingHtml ? '' : ' style="margin-top:0"') + '>Экраны</div>' + screensHtml +
    '<div class="screens-hint">Новый телевизор: откройте на боксе <b>slon-app.vercel.app/tv</b>. Он покажет свой код и появится здесь сам — набирать длинный адрес не нужно.</div>' +
    '<div class="section-title">Врезки</div>' +
    '<div class="screens-hint">Показываются поверх ролика по очереди. Пустые поля «когда» — значит всегда.</div>' +
    slidesHtml +
    '<button onclick="createSlide()" class="screens-add">+ Добавить врезку</button>';
}

// Экран заявился сам: показываем его код, чтобы человек у телевизора
// убедился, что это именно тот ящик, а не соседний.
function renderPendingCard(s) {
  return '<div class="card screens-card">' +
    '<div class="screens-row"><b>Код ' + escapeHtml(s.code) + '</b>' +
      '<span class="screens-dot" style="background:' + (screenAlive(s) ? '#2f6a2f' : '#a13c3c') + '"></span></div>' +
    '<div class="screens-sub">' + escapeHtml(screenSeenText(s)) + '</div>' +
    '<label class="screens-label">Где висит</label>' +
    '<input class="screens-input" id="pair-name-' + s.id + '" placeholder="Чехов, бокс" value="">' +
    '<label class="screens-label">Филиал</label>' +
    '<select class="screens-input" id="pair-filial-' + s.id + '">' +
      '<option value="chekhov">Чехов</option><option value="istikbol">Истикбол</option></select>' +
    '<div class="screens-actions">' +
      '<button onclick="pairScreen(' + s.id + ')">Привязать</button>' +
      '<button class="danger" onclick="deleteScreen(' + s.id + ')">Это не мой</button>' +
    '</div>' +
  '</div>';
}

function renderScreenCard(s) {
  const alive = screenAlive(s);
  const filialOpts = SCREEN_FILIALS.map(function (f) {
    return '<option value="' + f.id + '"' + (f.id === (s.filial || '') ? ' selected' : '') + '>' + f.name + '</option>';
  }).join('');
  return '<div class="card screens-card">' +
    '<div class="screens-row">' +
      '<input class="screens-input screens-name" value="' + escJsAttr(s.name || '') + '" ' +
        'onchange="saveScreen(' + s.id + ', {name: this.value})" placeholder="Где висит">' +
      '<span class="screens-dot" style="background:' + (alive ? '#2f6a2f' : '#a13c3c') + '"></span>' +
    '</div>' +
    '<div class="screens-sub">' + escapeHtml(screenSeenText(s)) +
      (s.last_slide ? ' · последняя врезка: ' + escapeHtml(s.last_slide) : '') + '</div>' +
    '<label class="screens-label">Филиал</label>' +
    '<select class="screens-input" onchange="saveScreen(' + s.id + ', {filial: this.value || null})">' + filialOpts + '</select>' +
    '<label class="screens-label">Ссылка на ролик YouTube</label>' +
    '<input class="screens-input" value="' + escJsAttr(s.youtube_url || '') + '" placeholder="https://youtube.com/watch?v=..." ' +
      'onchange="saveScreen(' + s.id + ', {youtube_url: this.value.trim() || null})">' +
    '<div class="screens-grid3">' +
      '<div><label class="screens-label">Врезка раз в, мин</label>' +
        '<input class="screens-input" type="number" min="1" value="' + (s.insert_every_min || 15) + '" ' +
        'onchange="saveScreen(' + s.id + ', {insert_every_min: Math.max(1, +this.value || 15)})"></div>' +
      '<div><label class="screens-label">Держать, сек</label>' +
        '<input class="screens-input" type="number" min="3" value="' + (s.slide_seconds || 20) + '" ' +
        'onchange="saveScreen(' + s.id + ', {slide_seconds: Math.max(3, +this.value || 20)})"></div>' +
      '<div><label class="screens-label">Штук за раз</label>' +
        '<input class="screens-input" type="number" min="1" value="' + (s.slides_per_break || 1) + '" ' +
        'onchange="saveScreen(' + s.id + ', {slides_per_break: Math.max(1, +this.value || 1)})"></div>' +
    '</div>' +
    '<label class="screens-label">Открыть на боксе</label>' +
    '<div class="screens-addr" onclick="copyScreenUrl(' + s.id + ')">' + escapeHtml(tvPageUrl(s.code)) + '</div>' +
    '<div class="screens-actions">' +
      '<button onclick="openScreenPage(' + s.id + ')">Посмотреть</button>' +
      '<button class="danger" onclick="deleteScreen(' + s.id + ')">Удалить</button>' +
    '</div>' +
  '</div>';
}

function renderSlideCard(s) {
  const screenOpts = ['<option value="">На всех экранах</option>'].concat(screensList.map(function (sc) {
    return '<option value="' + sc.id + '"' + (sc.id === s.screen_id ? ' selected' : '') + '>' + escapeHtml(sc.name) + '</option>';
  })).join('');
  const days = Array.isArray(s.weekdays) ? s.weekdays : [];
  const daysHtml = WEEKDAY_NAMES.map(function (n, i) {
    const on = days.indexOf(i) >= 0;
    return '<button class="screens-day' + (on ? ' on' : '') + '" onclick="toggleSlideDay(' + s.id + ',' + i + ')">' + n + '</button>';
  }).join('');
  const preview = !s.image_url ? ''
    : s.kind === 'video'
      ? '<video src="' + escJsAttr(s.image_url) + '" class="screens-thumb" muted playsinline controls></video>'
      : s.kind === 'image'
        ? '<img src="' + escJsAttr(s.image_url) + '" class="screens-thumb" alt="">'
        : '';
  return '<div class="card screens-card' + (s.is_active ? '' : ' off') + '">' +
    '<div class="screens-row">' +
      '<select class="screens-input screens-kind" onchange="saveSlide(' + s.id + ', {kind: this.value})">' +
        '<option value="card"' + (s.kind === 'card' ? ' selected' : '') + '>Текст</option>' +
        '<option value="image"' + (s.kind === 'image' ? ' selected' : '') + '>Фото</option>' +
        '<option value="video"' + (s.kind === 'video' ? ' selected' : '') + '>Видео</option>' +
      '</select>' +
      '<label class="screens-toggle"><input type="checkbox"' + (s.is_active ? ' checked' : '') +
        ' onchange="saveSlide(' + s.id + ', {is_active: this.checked})"> показывать</label>' +
    '</div>' +
    (s.kind === 'image' || s.kind === 'video'
      ? preview + '<label class="screens-label">' +
        (s.kind === 'video' ? 'Ролик (mp4, до 25 МБ — это секунд 20 съёмки с телефона)' : 'Фото (jpg, png)') + '</label>' +
        '<input class="screens-input" type="file" accept="' + (s.kind === 'video' ? 'video/*' : 'image/*') +
        '" onchange="uploadSlideMedia(' + s.id + ', this)">'
      : '<label class="screens-label">Заголовок</label>' +
        '<input class="screens-input" value="' + escJsAttr(s.title || '') + '" placeholder="Кальян дня" ' +
          'onchange="saveSlide(' + s.id + ', {title: this.value})">' +
        '<label class="screens-label">Текст</label>' +
        '<textarea class="screens-input" rows="2" placeholder="Пара слов, не больше" ' +
          'onchange="saveSlide(' + s.id + ', {body: this.value})">' + escapeHtml(s.body || '') + '</textarea>' +
        '<label class="screens-label">Плашка снизу (цена и т.п.)</label>' +
        '<input class="screens-input" value="' + escJsAttr(s.note || '') + '" placeholder="90 000 сум" ' +
          'onchange="saveSlide(' + s.id + ', {note: this.value})">') +
    (s.kind === 'video'
      ? '<div class="screens-hint" style="margin:10px 0 0">Ролик доигрывается до конца, поле «держать» на него не влияет.</div>'
      : '') +
    '<label class="screens-label">Где показывать</label>' +
    '<select class="screens-input" onchange="saveSlide(' + s.id + ', {screen_id: this.value ? +this.value : null})">' + screenOpts + '</select>' +
    '<label class="screens-label">Когда: даты</label>' +
    '<div class="screens-grid2">' +
      '<input class="screens-input" type="date" value="' + (s.date_from || '') + '" onchange="saveSlide(' + s.id + ', {date_from: this.value || null})">' +
      '<input class="screens-input" type="date" value="' + (s.date_to || '') + '" onchange="saveSlide(' + s.id + ', {date_to: this.value || null})">' +
    '</div>' +
    '<label class="screens-label">Часы (можно через полночь: с 18 до 3)</label>' +
    '<div class="screens-grid2">' +
      '<input class="screens-input" type="number" min="0" max="23" placeholder="с" value="' + (s.hour_from == null ? '' : s.hour_from) + '" onchange="saveSlide(' + s.id + ', {hour_from: this.value === &quot;&quot; ? null : +this.value})">' +
      '<input class="screens-input" type="number" min="0" max="23" placeholder="по" value="' + (s.hour_to == null ? '' : s.hour_to) + '" onchange="saveSlide(' + s.id + ', {hour_to: this.value === &quot;&quot; ? null : +this.value})">' +
    '</div>' +
    '<label class="screens-label">Дни недели</label>' +
    '<div class="screens-days">' + daysHtml + '</div>' +
    '<div class="screens-actions">' +
      '<button onclick="saveSlide(' + s.id + ', {sort: ' + (Number(s.sort) - 10) + '})">Выше</button>' +
      '<button onclick="saveSlide(' + s.id + ', {sort: ' + (Number(s.sort) + 10) + '})">Ниже</button>' +
      '<button class="danger" onclick="deleteSlide(' + s.id + ')">Удалить</button>' +
    '</div>' +
  '</div>';
}

// ===== Экраны =====
async function pairScreen(id) {
  const name = (document.getElementById('pair-name-' + id) || {}).value;
  const filial = (document.getElementById('pair-filial-' + id) || {}).value;
  const { error } = await sb.from('screens')
    .update({ pending: false, name: (name || '').trim() || ('Экран ' + id), filial: filial || 'chekhov' })
    .eq('id', id);
  if (error) return showToast(t('common.error') + error.message);
  logActivity('Экраны', 'привязан экран');
  showToast('Экран привязан');
  loadScreens();
}

async function saveScreen(id, patch) {
  const { error } = await sb.from('screens').update(patch).eq('id', id);
  if (error) return showToast(t('common.error') + error.message);
  const row = screensList.find(function (s) { return s.id === id; });
  if (row) Object.assign(row, patch);
  showToast('Сохранено');
}

async function deleteScreen(id) {
  const ok = await confirmDialog('Экран удалится вместе со своими врезками. Бокс покажет «экран не найден».');
  if (!ok) return;
  const { error } = await sb.from('screens').delete().eq('id', id);
  if (error) return showToast(t('common.error') + error.message);
  loadScreens();
}

function openScreenPage(id) {
  const row = screensList.find(function (s) { return s.id === id; });
  if (row) window.open(tvPageUrl(row.code), '_blank');
}

function copyScreenUrl(id) {
  const row = screensList.find(function (s) { return s.id === id; });
  if (!row) return;
  const url = tvPageUrl(row.code);
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { showToast('Адрес скопирован'); });
  else showToast(url);
}

// ===== Врезки =====
async function createSlide() {
  const maxSort = screenSlides.reduce(function (m, s) { return Math.max(m, Number(s.sort) || 0); }, 0);
  const { error } = await sb.from('screen_slides').insert({ kind: 'card', title: 'Новая врезка', sort: maxSort + 10 });
  if (error) return showToast(t('common.error') + error.message);
  loadScreens();
}

async function saveSlide(id, patch) {
  const { error } = await sb.from('screen_slides').update(patch).eq('id', id);
  if (error) return showToast(t('common.error') + error.message);
  const row = screenSlides.find(function (s) { return s.id === id; });
  if (row) Object.assign(row, patch);
  // Порядок и вид меняют разметку карточки — перерисовываем, остальное нет:
  // иначе поле теряет фокус на каждом введённом слове.
  if ('sort' in patch || 'kind' in patch || 'is_active' in patch) loadScreens();
  else showToast('Сохранено');
}

async function deleteSlide(id) {
  const ok = await confirmDialog('Удалить врезку?');
  if (!ok) return;
  const { error } = await sb.from('screen_slides').delete().eq('id', id);
  if (error) return showToast(t('common.error') + error.message);
  loadScreens();
}

function toggleSlideDay(id, day) {
  const row = screenSlides.find(function (s) { return s.id === id; });
  if (!row) return;
  const days = Array.isArray(row.weekdays) ? row.weekdays.slice() : [];
  const at = days.indexOf(day);
  if (at >= 0) days.splice(at, 1); else days.push(day);
  days.sort();
  saveSlide(id, { weekdays: days.length ? days : null }).then(loadScreens);
}

// Фото и ролики для врезок. Кладём с приставкой screen/ — уборка медиа
// стирает всё старше двух недель, и без отдельной приставки акция пропала бы
// с экрана ровно через четырнадцать дней (см. media_expired в базе).
//
// Потолок на ролик — 25 МБ. Бесплатного места в хранилище чуть меньше
// гигабайта, и половина уже занята фото чек-листов: десяток роликов по
// двадцать пять мегабайт съест оставшееся за месяц.
const SCREEN_VIDEO_MAX_MB = 25;

async function uploadSlideMedia(id, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const isVideo = (file.type || '').indexOf('video') === 0;
  if (isVideo && file.size > SCREEN_VIDEO_MAX_MB * 1048576) {
    showToast('Ролик тяжелее ' + SCREEN_VIDEO_MAX_MB + ' МБ — обрежьте его покороче');
    input.value = '';
    return;
  }
  showToast(isVideo ? 'Загружаю ролик, это дольше...' : 'Загружаю фото...');
  try {
    // Видео в браузере не пережимаем: ролик короткий, а перекодирование на
    // телефоне занимает минуты и часто срывается.
    const body = isVideo ? file : await compressImage(file, 1920, 0.85);
    const ext = isVideo ? 'mp4' : ((body.type && body.type.indexOf('png') >= 0) ? 'png' : 'jpg');
    const path = 'screen/slide-' + id + '-' + Date.now() + '.' + ext;
    const { error } = await sb.storage.from('task-reports').upload(path, body, { contentType: body.type || 'video/mp4', cacheControl: '31536000' });
    if (error) throw error;
    const url = sb.storage.from('task-reports').getPublicUrl(path).data.publicUrl;
    await saveSlide(id, { image_url: url });
    loadScreens();
  } catch (e) {
    showToast(t('common.uploadErr') + (e.message || ''));
  }
}
