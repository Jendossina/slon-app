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
// Алиас t() для файлов, где переменная `t` уже занята (напр. tasks.js: taskHTML(t) — объект задачи).
function tr(key, vars) { return t(key, vars); }

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
    // Задачи
    'tasks.title': 'Задачи', 'tasks.viewReport': 'Смотреть отчёт', 'tasks.attachReport': 'Прикрепить отчёт', 'tasks.noPhotoReport': 'Без фотоотчёта',
    'tasks.due': 'до', 'tasks.mine': 'Моя', 'tasks.discuss': 'Обсудить',
    'tasks.today': 'Сегодня', 'tasks.tomorrow': 'Завтра', 'tasks.yesterday': 'Вчера', 'tasks.all': 'Все', 'tasks.allDays': 'все дни',
    'tasks.count': '{label}: {done} из {total} выполнено', 'tasks.none': 'На этот день задач нет',
    'tasks.onlyOwn': 'Можно отмечать только свои задачи — это чужая задача видна для контроля',
    'tasks.enterTask': 'Введите задачу', 'tasks.selectEmp': 'Выберите хотя бы одного сотрудника', 'tasks.assigned': '✅ Задача назначена: {n}',
    'tasks.forFilial': '📍 Задача для филиала: ', 'tasks.noEmpFilial': 'Нет сотрудников для филиала «{f}»',
    'tasks.reportSent': '✅ Отчёт отправлен!', 'tasks.done': '✅ Задача выполнена',
    'tasks.noMessages': 'Пока нет сообщений.<br>Начни обсуждение первым!', 'tasks.pinned': '📌 Закреплено',
    'tasks.newTask': 'Новая задача', 'tasks.taskLabel': 'Задача', 'tasks.titlePh': 'Заказать табак Adalya',
    'tasks.descLabel': 'Описание (необязательно)', 'tasks.descPh': 'Подробности задачи...', 'tasks.assignLabel': 'Назначить сотрудникам',
    'tasks.dueLabel': 'Срок', 'tasks.addBtn': 'Добавить задачу', 'tasks.reportTitle': '📎 Отчёт о выполнении',
    'tasks.uploadHint': 'Нажми чтобы прикрепить фото или видео', 'tasks.sendReport': 'Отправить отчёт', 'tasks.doneNoPhoto': 'Отметить выполненным без фото',
    'tasks.discussion': '💬 Обсуждение', 'tasks.commentPh': 'Написать комментарий...', 'tasks.reportEmp': '📋 Отчёт сотрудника',
    // График
    'sch.title': '📅 Расписание', 'sch.week': '📆 На неделю', 'sch.addShift': '+ Смена', 'sch.dayHeader': 'День',
    'sch.prevWeek': '← Пред. неделя', 'sch.nextWeek': 'След. неделя →', 'sch.dayOffShort': 'Вых',
    'sch.dayOffToday': 'Сегодня твой выходной', 'sch.noEmpInDept': 'В этом отделе нет сотрудников для филиала «{f}»',
    'sch.presetsLabel': 'Смены цеха «{dept}» — нажми, чтобы выбрать', 'sch.fullDay': 'весь день', 'sch.otherTime': '✏️ Другое время…', 'sch.dayOffOpt': '🌴 Выходной',
    'sch.selectEmp': 'Выберите сотрудника', 'sch.selectCell': 'Выберите ячейку в таблице', 'sch.weekFilled': '✅ Неделя заполнена', 'sch.saved': '✅ Сохранено', 'sch.deleted': '✅ Удалено',
    'sch.pickTitle': 'Кому назначить смену?', 'sch.weekFillTitle': '📆 Заполнить неделю', 'sch.employee': 'Сотрудник',
    'sch.start': 'Начало', 'sch.end': 'Конец', 'sch.allDaysBtn': 'Всем дням', 'sch.saveWeek': 'Сохранить неделю',
    'sch.assignTitle': '📅 Назначить смену', 'sch.dayOffCheck': 'Выходной день', 'sch.shiftStart': 'Начало смены', 'sch.shiftEnd': 'Конец смены',
    'sch.noteLabel': 'Заметка (необязательно)', 'sch.notePh': 'Например: двойная смена',
    // Чек-листы
    'cl.title': '☑️ Чек-листы', 'cl.noneForDept': 'Для отдела «{dept}» чек-листов пока нет', 'cl.loadErr': 'Ошибка загрузки чек-листов',
    'cl.notFound': 'Чек-лист не найден', 'cl.loadErrShort': 'Ошибка загрузки', 'cl.doneOf': '{done} из {total} выполнено',
    'cl.completed': '✅ Чек-лист выполнен!', 'cl.watch': 'Смотреть ({n})', 'cl.morePhoto': 'Ещё фото', 'cl.attachPhoto': 'Прикрепить фото',
    'cl.observerMarks': 'Режим наблюдателя — отметки недоступны', 'cl.selectFile': 'Выберите файл',
    'cl.photoAttached': '✅ Фото прикреплено', 'cl.photosAttached': '✅ Прикреплено фото: {n}', 'cl.saveErr': 'Ошибка сохранения: ',
    'cl.mediaTitle': '📎 Фото/видео к пункту', 'cl.mediaHint': 'Нажми чтобы прикрепить фото или видео', 'cl.mediaHintSub': 'можно выбрать несколько', 'cl.attachBtn': 'Прикрепить',
    // Общее
    'common.loading': 'Загрузка...', 'common.logout': 'Выйти', 'common.sum': 'сум', 'common.error': 'Ошибка: ',
    'common.observerMode': 'Режим наблюдателя — редактирование недоступно', 'common.allEmployees': '👥 Все сотрудники', 'common.byDept': 'по цехам ▾',
    'common.uploadErr': 'Ошибка загрузки: ', 'common.loadErrConn': 'Ошибка загрузки. Проверьте соединение.', 'common.uploadingFile': '⏳ Загружаю файл...',
    'common.loadErr': 'Ошибка загрузки', 'common.save': 'Сохранить',
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
    // Задачи
    'tasks.title': 'Вазифалар', 'tasks.viewReport': 'Ҳисоботни кўриш', 'tasks.attachReport': 'Ҳисобот бириктириш', 'tasks.noPhotoReport': 'Фотоҳисоботсиз',
    'tasks.due': 'гача', 'tasks.mine': 'Меники', 'tasks.discuss': 'Муҳокама',
    'tasks.today': 'Бугун', 'tasks.tomorrow': 'Эртага', 'tasks.yesterday': 'Кеча', 'tasks.all': 'Ҳаммаси', 'tasks.allDays': 'барча кунлар',
    'tasks.count': '{label}: {total} тадан {done} таси бажарилди', 'tasks.none': 'Бу кунга вазифа йўқ',
    'tasks.onlyOwn': 'Фақат ўз вазифаларингизни белгилаш мумкин — бу бошқа ходимнинг вазифаси, назорат учун кўрсатилган',
    'tasks.enterTask': 'Вазифани киритинг', 'tasks.selectEmp': 'Камида битта ходимни танланг', 'tasks.assigned': '✅ Вазифа берилди: {n}',
    'tasks.forFilial': '📍 Филиал учун вазифа: ', 'tasks.noEmpFilial': '«{f}» филиали учун ходимлар йўқ',
    'tasks.reportSent': '✅ Ҳисобот юборилди!', 'tasks.done': '✅ Вазифа бажарилди',
    'tasks.noMessages': 'Ҳали хабарлар йўқ.<br>Муҳокамани биринчи бўлиб бошланг!', 'tasks.pinned': '📌 Қадаланган',
    'tasks.newTask': 'Янги вазифа', 'tasks.taskLabel': 'Вазифа', 'tasks.titlePh': 'Adalya тамаки буюртма қилиш',
    'tasks.descLabel': 'Тавсиф (ихтиёрий)', 'tasks.descPh': 'Вазифа тафсилотлари...', 'tasks.assignLabel': 'Ходимларга бириктириш',
    'tasks.dueLabel': 'Муддат', 'tasks.addBtn': 'Вазифа қўшиш', 'tasks.reportTitle': '📎 Бажарилганлик ҳисоботи',
    'tasks.uploadHint': 'Фото ёки видео бириктириш учун босинг', 'tasks.sendReport': 'Ҳисоботни юбориш', 'tasks.doneNoPhoto': 'Фотосиз бажарилган деб белгилаш',
    'tasks.discussion': '💬 Муҳокама', 'tasks.commentPh': 'Шарҳ ёзиш...', 'tasks.reportEmp': '📋 Ходим ҳисоботи',
    // График
    'sch.title': '📅 Жадвал', 'sch.week': '📆 Ҳафтага', 'sch.addShift': '+ Смена', 'sch.dayHeader': 'Кун',
    'sch.prevWeek': '← Олдинги ҳафта', 'sch.nextWeek': 'Кейинги ҳафта →', 'sch.dayOffShort': 'Дам',
    'sch.dayOffToday': 'Бугун сенинг дам олиш кунинг', 'sch.noEmpInDept': '«{f}» филиали учун бу бўлимда ходимлар йўқ',
    'sch.presetsLabel': '«{dept}» цехи сменалари — танлаш учун босинг', 'sch.fullDay': 'бутун кун', 'sch.otherTime': '✏️ Бошқа вақт…', 'sch.dayOffOpt': '🌴 Дам олиш',
    'sch.selectEmp': 'Ходимни танланг', 'sch.selectCell': 'Жадвалдан катакчани танланг', 'sch.weekFilled': '✅ Ҳафта тўлдирилди', 'sch.saved': '✅ Сақланди', 'sch.deleted': '✅ Ўчирилди',
    'sch.pickTitle': 'Сменани кимга бириктириш?', 'sch.weekFillTitle': '📆 Ҳафтани тўлдириш', 'sch.employee': 'Ходим',
    'sch.start': 'Бошланиш', 'sch.end': 'Тугаш', 'sch.allDaysBtn': 'Барча кунларга', 'sch.saveWeek': 'Ҳафтани сақлаш',
    'sch.assignTitle': '📅 Смена белгилаш', 'sch.dayOffCheck': 'Дам олиш куни', 'sch.shiftStart': 'Смена бошланиши', 'sch.shiftEnd': 'Смена тугаши',
    'sch.noteLabel': 'Изоҳ (ихтиёрий)', 'sch.notePh': 'Масалан: икки карра смена',
    // Чек-листы
    'cl.title': '☑️ Назорат рўйхатлари', 'cl.noneForDept': '«{dept}» бўлими учун ҳали назорат рўйхати йўқ', 'cl.loadErr': 'Назорат рўйхатларини юклашда хато',
    'cl.notFound': 'Назорат рўйхати топилмади', 'cl.loadErrShort': 'Юклашда хато', 'cl.doneOf': '{total} тадан {done} таси бажарилди',
    'cl.completed': '✅ Назорат рўйхати бажарилди!', 'cl.watch': 'Кўриш ({n})', 'cl.morePhoto': 'Яна фото', 'cl.attachPhoto': 'Фото бириктириш',
    'cl.observerMarks': 'Кузатувчи режими — белгилаш мумкин эмас', 'cl.selectFile': 'Файл танланг',
    'cl.photoAttached': '✅ Фото бириктирилди', 'cl.photosAttached': '✅ Бириктирилган фото: {n}', 'cl.saveErr': 'Сақлашда хато: ',
    'cl.mediaTitle': '📎 Бандга фото/видео', 'cl.mediaHint': 'Фото ёки видео бириктириш учун босинг', 'cl.mediaHintSub': 'бир нечтасини танлаш мумкин', 'cl.attachBtn': 'Бириктириш',
    // Общее
    'common.loading': 'Юкланмоқда...', 'common.logout': 'Чиқиш', 'common.sum': 'сўм', 'common.error': 'Хато: ',
    'common.observerMode': 'Кузатувчи режими — таҳрирлаш мумкин эмас', 'common.allEmployees': '👥 Барча ходимлар', 'common.byDept': 'цехлар бўйича ▾',
    'common.uploadErr': 'Юклашда хато: ', 'common.loadErrConn': 'Юклашда хато. Уланишни текширинг.', 'common.uploadingFile': '⏳ Файл юкланмоқда...',
    'common.loadErr': 'Юклашда хато', 'common.save': 'Сақлаш',
  },
};
