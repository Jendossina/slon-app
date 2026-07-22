// ===== Локализация (RU / UZ-кириллица) =====
// Язык хранится в localStorage у каждого пользователя. t('key') возвращает строку
// на текущем языке (с откатом на русский, затем на сам ключ). Статический HTML
// переводится через атрибуты data-i18n / data-i18n-ph / data-i18n-html. Переключение
// языка = сохранить выбор и перезагрузить страницу — всё перерисуется на новом языке.

const I18N_LANGS = [
  { id: 'ru', label: 'Русский' },
  { id: 'uz', label: 'Ўзбекча' },
];

let _lang = localStorage.getItem('slon-lang') || 'ru';
function getLang() { return _lang; }
function setLang(lang) {
  if(lang !== 'ru' && lang !== 'uz') return;
  _lang = lang;
  localStorage.setItem('slon-lang', lang);
  location.reload(); // перерисуется всё на новом языке
}

// Перевод по ключу. Плейсхолдеры {name} подставляются из vars.
function t(key, vars) {
  const dict = I18N[_lang] || I18N.ru;
  let s = (dict && dict[key] != null) ? dict[key] : (I18N.ru[key] != null ? I18N.ru[key] : key);
  if(vars) for(const k in vars) s = s.replace(new RegExp('\\{'+k+'\\}','g'), vars[k]);
  return s;
}

// Применить перевод к статическому HTML (вызывается на старте и не требует повторного вызова
// при переключении — там перезагрузка). data-i18n → textContent, -ph → placeholder, -html → innerHTML.
function applyStaticI18n(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
  try { document.documentElement.setAttribute('lang', _lang); } catch(e) {}
}

// Кнопки-переключатели языка (для Личного кабинета)
function langSwitcherHTML() {
  return `<div style="display:flex;gap:8px">` + I18N_LANGS.map(l =>
    `<button onclick="setLang('${l.id}')" style="flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid ${l.id===_lang?'var(--gold-dark)':'var(--border)'};background:${l.id===_lang?'var(--gold-dark)':'var(--surface-2)'};color:${l.id===_lang?'#fff':'var(--text-primary)'}">${l.label}</button>`
  ).join('') + `</div>`;
}

const I18N = {
  ru: {
    // Нижняя навигация
    'nav.home': 'Главная', 'nav.tasks': 'Задачи', 'nav.shift': 'Смена', 'nav.schedule': 'График', 'nav.more': 'Ещё', 'nav.admin': 'Админ',
    // Меню «Ещё» — группы
    'more.group.personal': 'Личное', 'more.group.work': 'Работа', 'more.group.team': 'Команда', 'more.group.manage': 'Управление',
    // Меню «Ещё» — пункты
    'more.profile': 'Личный кабинет', 'more.mynotes': 'Мой задачник', 'more.help': 'Помощник',
    'more.knowledge': 'База знаний', 'more.supply': 'Хозчасть', 'more.dishware': 'Посуда', 'more.calendar': 'Календарь',
    'more.hr': 'Сотрудники', 'more.teamchat': 'Общий чат', 'more.feed': 'Лента', 'more.reviews': 'Отзывы',
    'more.finance': 'Финансы', 'more.dashboard': 'Дашборд', 'more.directory': 'Справочник', 'more.admin': 'Админ-панель',
    'more.title': 'Ещё',
    // Вход
    'login.title': 'Войти', 'login.login': 'Логин', 'login.password': 'Пароль', 'login.submit': 'Войти',
    'login.remember': 'Запомнить меня', 'login.error': 'Неверный логин или пароль',
    'login.subtitle': 'Система управления заведением',
    // Роли (приветствие на главной)
    'role.admin': '👑 Управляющий', 'role.manager': '📋 Менеджер', 'role.employee': '👤 Сотрудник', 'role.boss': '🦉 Владелец (наблюдатель)',
    // Личный кабинет
    'profile.language': 'Язык приложения',
    // Главная
    'home.welcomeDefault': 'Добро пожаловать!', 'home.welcome': 'Привет, {name}!',
    'home.stats.revenue': 'Выручка сегодня', 'home.stats.bookings': 'Брони', 'home.stats.forToday': 'на сегодня',
    'home.myTasks': 'Мои задачи', 'home.tasksToday': 'Задачи на сегодня',
    'home.noTasksToday': 'Задач на сегодня нет', 'home.tasksDone': '{done} из {total} выполнено',
    'home.dayOff': 'Сегодня выходной', 'home.shiftToday': 'ТВОЯ СМЕНА СЕГОДНЯ',
    'home.important': '📢 ВАЖНОЕ ОБЪЯВЛЕНИЕ',
    'home.tg.title': '🔔 Подключи Telegram-уведомления', 'home.tg.desc': 'Получай уведомления о новых задачах прямо в Telegram', 'home.tg.save': 'Сохранить',
    // Отметка на смену (явка)
    'att.title': 'Отметка на смену', 'att.startsAt': 'Смена начинается в {time}. Для отметки нужно снять короткое видео на месте.',
    'att.recordBtn': '🎥 Снять видео и отметить приход', 'att.arrivedAt': 'Пришёл в', 'att.late': 'Опоздание', 'att.onTime': 'Вовремя',
    'att.checkoutBtn': '🚪 Отметить уход', 'att.shiftDone': 'Смена завершена', 'att.came': 'Пришёл', 'att.left': 'Ушёл',
    'att.loadErr': 'Не удалось загрузить. Проверьте соединение и обновите страницу.',
    'att.needVideo': 'Нужно именно видео с камеры', 'att.checkGeo': '📍 Проверяю геопозицию...', 'att.uploadingVideo': '⏳ Загружаю видео...',
    'att.videoErr': 'Ошибка загрузки видео: ', 'att.lateToast': '⏰ Опоздание {min} мин · штраф {pen} сум', 'att.onTimeToast': '✅ Отмечено вовремя!',
    'att.checkoutToast': '✅ Уход отмечен',
    // Зарплата (карточка на главной)
    'salary.todayTitle': 'Моя зарплата · сегодня', 'salary.rate': 'Ставка', 'salary.notMarked': 'Смена сегодня ещё не отмечена', 'salary.penalty': 'Штраф',
    // Общее
    'common.loading': 'Загрузка...', 'common.logout': 'Выйти', 'common.sum': 'сум', 'common.error': 'Ошибка: ',
  },
  uz: {
    // Нижняя навигация
    'nav.home': 'Асосий', 'nav.tasks': 'Вазифалар', 'nav.shift': 'Смена', 'nav.schedule': 'Жадвал', 'nav.more': 'Яна', 'nav.admin': 'Админ',
    // Меню «Ещё» — группы
    'more.group.personal': 'Шахсий', 'more.group.work': 'Иш', 'more.group.team': 'Жамоа', 'more.group.manage': 'Бошқарув',
    // Меню «Ещё» — пункты
    'more.profile': 'Шахсий кабинет', 'more.mynotes': 'Менинг вазифаларим', 'more.help': 'Ёрдамчи',
    'more.knowledge': 'Билимлар базаси', 'more.supply': 'Хўжалик қисми', 'more.dishware': 'Идиш-товоқ', 'more.calendar': 'Тақвим',
    'more.hr': 'Ходимлар', 'more.teamchat': 'Умумий чат', 'more.feed': 'Лента', 'more.reviews': 'Фикрлар',
    'more.finance': 'Молия', 'more.dashboard': 'Дашборд', 'more.directory': 'Маълумотнома', 'more.admin': 'Админ-панел',
    'more.title': 'Яна',
    // Вход
    'login.title': 'Кириш', 'login.login': 'Логин', 'login.password': 'Парол', 'login.submit': 'Кириш',
    'login.remember': 'Мени эслаб қол', 'login.error': 'Логин ёки парол нотўғри',
    'login.subtitle': 'Муассасани бошқариш тизими',
    // Роли (приветствие на главной)
    'role.admin': '👑 Бошқарувчи', 'role.manager': '📋 Менежер', 'role.employee': '👤 Ходим', 'role.boss': '🦉 Эга (кузатувчи)',
    // Личный кабинет
    'profile.language': 'Илова тили',
    // Главная
    'home.welcomeDefault': 'Хуш келибсиз!', 'home.welcome': 'Салом, {name}!',
    'home.stats.revenue': 'Бугунги тушум', 'home.stats.bookings': 'Бронлар', 'home.stats.forToday': 'бугунга',
    'home.myTasks': 'Менинг вазифаларим', 'home.tasksToday': 'Бугунги вазифалар',
    'home.noTasksToday': 'Бугунга вазифа йўқ', 'home.tasksDone': '{total} тадан {done} таси бажарилди',
    'home.dayOff': 'Бугун дам олиш куни', 'home.shiftToday': 'БУГУНГИ СМЕНАНГ',
    'home.important': '📢 МУҲИМ ЭЪЛОН',
    'home.tg.title': '🔔 Telegram хабарномаларини улаш', 'home.tg.desc': 'Янги вазифалар ҳақида хабарларни тўғридан-тўғри Telegram да ол', 'home.tg.save': 'Сақлаш',
    // Отметка на смену (явка)
    'att.title': 'Сменага белги', 'att.startsAt': 'Смена {time} да бошланади. Белгилаш учун жойда қисқа видео олиш керак.',
    'att.recordBtn': '🎥 Видео олиб, келишни белгилаш', 'att.arrivedAt': 'Келди:', 'att.late': 'Кечикди', 'att.onTime': 'Ўз вақтида',
    'att.checkoutBtn': '🚪 Кетишни белгилаш', 'att.shiftDone': 'Смена тугади', 'att.came': 'Келди', 'att.left': 'Кетди',
    'att.loadErr': 'Юклаб бўлмади. Уланишни текширинг ва саҳифани янгиланг.',
    'att.needVideo': 'Айнан камерадан видео олиш керак', 'att.checkGeo': '📍 Геопозицияни текшираяпман...', 'att.uploadingVideo': '⏳ Видео юкланмоқда...',
    'att.videoErr': 'Видео юклашда хато: ', 'att.lateToast': '⏰ Кечикиш {min} дақиқа · жарима {pen} сўм', 'att.onTimeToast': '✅ Ўз вақтида белгиланди!',
    'att.checkoutToast': '✅ Кетиш белгиланди',
    // Зарплата (карточка на главной)
    'salary.todayTitle': 'Менинг маошим · бугун', 'salary.rate': 'Ставка', 'salary.notMarked': 'Бугунги смена ҳали белгиланмаган', 'salary.penalty': 'Жарима',
    // Общее
    'common.loading': 'Юкланмоқда...', 'common.logout': 'Чиқиш', 'common.sum': 'сўм', 'common.error': 'Хато: ',
  },
};
