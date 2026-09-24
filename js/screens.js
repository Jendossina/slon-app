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
  return location.origin + '/tv.html?code=' + encodeURIComponent(code);
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
  const screensHtml = screensList.length
    ? screensList.map(renderScreenCard).join('')
    : '<div class="empty">Экранов пока нет. Заведите первый — код появится сразу.</div>';
  const slidesHtml = screenSlides.length
    ? screenSlides.map(renderSlideCard).join('')
    : '<div class="empty">Врезок нет. Пока их нет, экран просто крутит ролик.</div>';
  box.innerHTML =
    '<div class="section-title" style="margin-top:0">Экраны</div>' + screensHtml +
    '<button onclick="createScreen()" class="screens-add">+ Добавить экран</button>' +
    '<div class="section-title">Врезки</div>' +
    '<div class="screens-hint">Показываются поверх ролика по очереди. Пустые поля «когда» — значит всегда.</div>' +
    slidesHtml +
    '<button onclick="createSlide()" class="screens-add">+ Добавить врезку</button>';
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
  const img = s.kind === 'image' && s.image_url
    ? '<img src="' + escJsAttr(s.image_url) + '" class="screens-thumb" alt="">'
    : '';
  return '<div class="card screens-card' + (s.is_active ? '' : ' off') + '">' +
    '<div class="screens-row">' +
      '<select class="screens-input screens-kind" onchange="saveSlide(' + s.id + ', {kind: this.value})">' +
        '<option value="card"' + (s.kind === 'card' ? ' selected' : '') + '>Карточка</option>' +
        '<option value="image"' + (s.kind === 'image' ? ' selected' : '') + '>Картинка</option>' +
      '</select>' +
      '<label class="screens-toggle"><input type="checkbox"' + (s.is_active ? ' checked' : '') +
        ' onchange="saveSlide(' + s.id + ', {is_active: this.checked})"> показывать</label>' +
    '</div>' +
    (s.kind === 'image'
      ? img + '<label class="screens-label">Картинка (jpg, png)</label>' +
        '<input class="screens-input" type="file" accept="image/*" onchange="uploadSlideImage(' + s.id + ', this)">'
      : '<label class="screens-label">Заголовок</label>' +
        '<input class="screens-input" value="' + escJsAttr(s.title || '') + '" placeholder="Кальян дня" ' +
          'onchange="saveSlide(' + s.id + ', {title: this.value})">' +
        '<label class="screens-label">Текст</label>' +
        '<textarea class="screens-input" rows="2" placeholder="Пара слов, не больше" ' +
          'onchange="saveSlide(' + s.id + ', {body: this.value})">' + escapeHtml(s.body || '') + '</textarea>' +
        '<label class="screens-label">Плашка снизу (цена и т.п.)</label>' +
        '<input class="screens-input" value="' + escJsAttr(s.note || '') + '" placeholder="90 000 сум" ' +
          'onchange="saveSlide(' + s.id + ', {note: this.value})">') +
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
async function createScreen() {
  const { error } = await sb.from('screens').insert({ name: 'Новый экран', filial: 'chekhov' });
  if (error) return showToast(t('common.error') + error.message);
  logActivity('Экраны', 'добавлен экран');
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

// Картинка для врезки. Кладём с приставкой screen/ — уборка медиа стирает всё
// старше двух недель, и без отдельной приставки акция пропала бы с экрана
// ровно через четырнадцать дней (см. media_expired в базе).
async function uploadSlideImage(id, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  showToast('Загружаю картинку...');
  try {
    const small = await compressImage(file, 1920, 0.85);
    const ext = (small.type && small.type.indexOf('png') >= 0) ? 'png' : 'jpg';
    const path = 'screen/slide-' + id + '-' + Date.now() + '.' + ext;
    const { error } = await sb.storage.from('task-reports').upload(path, small, { contentType: small.type, cacheControl: '31536000' });
    if (error) throw error;
    const url = sb.storage.from('task-reports').getPublicUrl(path).data.publicUrl;
    await saveSlide(id, { image_url: url });
    loadScreens();
  } catch (e) {
    showToast(t('common.uploadErr') + (e.message || ''));
  }
}
