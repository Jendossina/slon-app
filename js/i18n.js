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
  root.querySelectorAll('[data-i18n-label]').forEach(el => { el.setAttribute('label', t(el.getAttribute('data-i18n-label'))); }); // <optgroup label>
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
    // HR / сотрудники / зарплата
    'hr.title': 'Сотрудники', 'hr.searchPh': '🔍 Поиск по имени, должности...',
    'hr.found': 'Найдено: {n}', 'hr.allStaff': '{n} человек в штате (все филиалы)', 'hr.onFilial': '{n} на филиале «{f}» · всего {total}',
    'hr.dailyPayrollBtn': '💵 Ведомость на сегодня · {f}', 'hr.monthPayrollBtn': '💰 Зарплата за месяц · {f}',
    'hr.showThisFilial': '📍 Показать только этот филиал', 'hr.showAll': '👥 Показать всех сотрудников',
    'hr.geoBtn': '📍 Гео-отметка прихода · {f}', 'hr.nobodyFound': 'Никто не найден', 'hr.noEmpFilial': 'Нет сотрудников для этого филиала', 'hr.loadErr': 'Ошибка',
    'hr.unavailableObserver': 'Недоступно в режиме наблюдателя', 'hr.unavailable': 'Недоступно',
    'hr.gpsDetecting': '📍 Определяю координаты...', 'hr.gpsFail': 'Не удалось получить GPS. Включите геолокацию и разрешите доступ сайту.',
    'hr.newPoint': 'Новая точка: ', 'hr.gpsAccuracy': 'точность GPS ±{n} м · нажмите «Сохранить»', 'hr.coordsCaught': '✅ Координаты пойманы — нажмите «Сохранить»',
    'hr.setPointFirst': 'Сначала поставьте точку кнопкой «Поставить точку здесь»', 'hr.pointSaved': '✅ Точка «{f}» сохранена (радиус {r} м)', 'hr.geoOff': 'Гео-проверка отключена для этого филиала',
    'hr.pointSet': '✅ Точка задана: ', 'hr.radius': 'радиус {r} м', 'hr.updatedBy': 'обновил: ', 'hr.pointNotSet': 'Точка ещё не задана — гео-проверка отключена. Встаньте внутри филиала и нажмите «Поставить точку здесь».',
    'hr.calculating': 'Считаю...', 'hr.monthLedgerTitle': '💰 Ведомость · {month} · {f}',
    'hr.monthLedgerHint': 'Оплата по сменам (с учётом вида смены и «один в баре») − штрафы за опоздания. Данные по филиалу «{f}».',
    'hr.shiftsRate': '{n} смен · ставка {r} = {e}', 'hr.penalty': 'штраф −{p}', 'hr.totalFund': 'ИТОГО фонд оплаты', 'hr.noMonthData': 'Нет данных за месяц',
    'hr.dailyLedgerTitle': '💵 Ведомость на сегодня · {date} · {f}', 'hr.nobodyToday': 'На сегодня в смене никого нет',
    'hr.dailyHint': 'Оплата по смене − штрафы + премии. По графику на сегодня, филиал «{f}».',
    'hr.notCheckedIn': 'не отметился', 'hr.arrivedLate': 'пришёл <b>{time}</b> · <span style="color:#A13C3C">опоздал {m}м</span>', 'hr.arrivedOnTime': 'пришёл <b>{time}</b> · <span style="color:#3B6D11">вовремя</span>',
    'hr.rate': 'Ставка {r}', 'hr.premiumPlus': 'премия +{s}', 'hr.premiumFallback': 'премия', 'hr.addPremiumBtn': '+ Премия', 'hr.toPay': 'К выплате: {t}', 'hr.totalToday': 'ИТОГО к выплате за сегодня',
    'hr.premiumOnlyMgr': 'Премии может давать менеджер или управляющий', 'hr.enterPremium': 'Введите сумму премии', 'hr.premiumAdded': '✅ Премия добавлена', 'hr.removePremium': 'Убрать эту премию?',
    'hr.premiumTitle': '➕ Премия', 'hr.premiumSum': 'Сумма премии (сум)', 'hr.premiumFor': 'За что (необязательно)', 'hr.premiumForPh': 'Например: помог на кухне', 'hr.addPremiumSubmit': 'Добавить премию',
    'hr.enterName': 'Введите имя', 'hr.enterEmailPass': 'Введите email и пароль', 'hr.empAdded': '✅ Сотрудник добавлен',
    'hr.newEmp': 'Новый сотрудник', 'hr.fullName': 'Имя и фамилия', 'hr.role': 'Должность', 'hr.deptForSchedule': 'Отдел (для графика)', 'hr.noDept': '— Без отдела (не в графике) —',
    'hr.phone': 'Телефон', 'hr.salaryPerShift': 'Ставка за смену (сум)', 'hr.login': 'Логин (без @slon.uz)', 'hr.password': 'Пароль', 'hr.systemRole': 'Роль в системе',
    'hr.roleEmployee': 'Сотрудник', 'hr.roleManager': 'Менеджер', 'hr.roleAdmin': 'Управляющий', 'hr.roleBoss': 'Владелец (наблюдатель)',
    'hr.filialsCanWork': 'На каких филиалах может работать', 'hr.addEmpSubmit': 'Добавить сотрудника',
    'hr.grpHall': 'Зал', 'hr.grpBar': 'Бар', 'hr.grpHookah': 'Кальянная', 'hr.grpKitchen': 'Кухня', 'hr.grpMgmt': 'Руководство', 'hr.grpOther': 'Прочее',
    // Финансы
    'fin.title': 'Финансы', 'fin.income': 'Доходы', 'fin.expenses': 'Расходы', 'fin.sumPerMonth': 'сум за месяц',
    'fin.profitMonth': 'Прибыль за месяц', 'fin.monthDefault': 'Месяц', 'fin.dayDefault': 'День', 'fin.opsMonth': 'Операции за месяц',
    'fin.guestsMonth': 'Гостей за месяц', 'fin.avgCheck': 'Средний чек', 'fin.revByType': 'Выручка по типам оплат · за месяц', 'fin.noOps': 'За этот месяц операций нет.',
    'fin.kassa': 'Касса', 'fin.payTypes': 'Типы оплат', 'fin.deposits': 'внесения', 'fin.withdrawals': 'изъятия', 'fin.inCash': 'в кассе', 'fin.guests': 'Гостей',
    'fin.noKassaDay': 'Касса за этот день не внесена.', 'fin.dayExpenses': 'Расходы дня', 'fin.expenseFallback': 'Расход',
    'fin.editKassa': '✏️ Редактировать кассу', 'fin.enterKassa': '💵 Внести кассу', 'fin.expenseBtn': '➖ Расход',
    'fin.kassaTitle': '💵 Касса дня', 'fin.forDate': 'За число:', 'fin.bizDayHint': 'Кассовый день = день начала смены. Ночью (до 8:00) по умолчанию ставится вчерашнее число — как и должно быть для смены 12:00–03:00.',
    'fin.scanReceipt': '📷 Считать с чека', 'fin.scanHint': 'Сфотографируйте Z-отчёт или выберите фото из галереи — суммы подставятся сами, останется сверить.',
    'fin.breakdownLabel': 'Разбивка по типам оплат', 'fin.addLine': '+ Добавить строку', 'fin.totalRevenue': 'Итого выручка (идёт в дашборд и ФОТ)', 'fin.sumFromLines': '↻ Итог = сумма строк',
    'fin.cashMovement': 'Движение наличных (по желанию):', 'fin.depositsL': 'Внесения', 'fin.withdrawalsL': 'Изъятия', 'fin.inCashL': 'В кассе',
    'fin.attendance': 'Посещаемость:', 'fin.guestsPerDay': 'Гостей за день', 'fin.saveKassa': 'Сохранить кассу',
    'fin.scanLoading': '⏳ Загружаю фото...', 'fin.scanRecognizing': '🔍 Распознаю чек...', 'fin.scanFail': '⚠️ Не удалось распознать. Добавьте строки вручную.', 'fin.scanDone': '✅ Распознано — сверьте цифры и поправьте, если нужно.',
    'fin.enterRevenue': 'Введите итоговую выручку', 'fin.kassaSaved': '✅ Касса сохранена', 'fin.kassaDefault': 'Касса дня',
    'fin.kassaExists': 'Касса за {d} уже внесена: {n} сум. Сохранение перезапишет её.', 'fin.scanOrManual': 'Считайте с чека или добавьте строки вручную.',
    'fin.expenseTitle': '➖ Расход', 'fin.amountSum': 'Сумма (сум)', 'fin.category': 'Категория', 'fin.comment': 'Комментарий', 'fin.addExpense': 'Добавить расход', 'fin.enterAmount': 'Введите сумму', 'fin.expenseAdded': '✅ Расход добавлен',
    'fin.newOp': 'Новая операция', 'fin.type': 'Тип', 'fin.incomeOpt': 'Доход', 'fin.expenseOpt': 'Расход', 'fin.desc': 'Описание', 'fin.add': 'Добавить', 'fin.opAdded': '✅ Операция добавлена', 'fin.deleteOp': 'Удалить эту операцию?',
    // Личный кабинет — тело
    'pf.title': '📄 Личный кабинет',
    'pf.salaryTitle': 'Зарплата · {month}', 'pf.earnedNow': 'Заработано сейчас', 'pf.forecast': 'Прогноз к концу месяца',
    'pf.workedInfo': 'Отработано {worked} смен · впереди по графику {planned}', 'pf.withheld': ' · удержано {p}',
    'pf.upcomingShifts': 'Ближайшие смены', 'pf.today': 'сегодня', 'pf.dayOff': '🌴 Выходной',
    'pf.myActiveTasks': 'Мои активные задачи ({n})', 'pf.noOverview': 'Пока нет данных для обзора', 'pf.taskStats': 'Статистика задач',
    'pf.withholdings': 'Удержания за месяц', 'pf.totalWithheld': 'Всего: −{p} сум', 'pf.lateByMin': 'Опоздание на {min} мин',
    'pf.shiftHistory': 'История смен (14 дней)', 'pf.noShifts': 'Смен пока нет', 'pf.notLinked': 'Профиль сотрудника не привязан',
    'pf.allControl': '✅ Всё под контролем · {f}', 'pf.allControlSub': 'Нет просроченных задач, опозданий и жалоб сегодня',
    'pf.needAttention': '⚠️ Требует внимания · {f}', 'pf.overdueTasks': '⏰ Просроченные задачи', 'pf.latesToday': '🚶 Опоздания сегодня', 'pf.badReviews': '👎 Плохие отзывы сегодня',
    'pf.teamToday': 'Команда сегодня · {f}', 'pf.notCheckedIn': 'не отметился', 'pf.wasLate': 'опоздал {m}м', 'pf.onShift': 'на смене', 'pf.noTeamData': 'Нет данных по команде',
    'pf.achievements': 'Достижения ({e}/{total})', 'pf.received': '✓ получено',
    'pf.b.shifts': 'смен', 'pf.b.clean': 'чисто!', 'pf.b.lateCount': '{n} опозд.', 'pf.b.none': 'ни одной!', 'pf.b.breakCount': '{n} боя',
    'pf.b.perfectWeek': 'Идеальная неделя', 'pf.b.perfectWeekD': '7 смен подряд без опозданий',
    'pf.b.punctual': 'Пунктуальность', 'pf.b.punctualD': '20 смен подряд без опозданий',
    'pf.b.discipline': 'Железная дисциплина', 'pf.b.disciplineD': 'Месяц без опозданий',
    'pf.b.performer': 'Исполнитель', 'pf.b.performerD': '50 выполненных задач',
    'pf.b.taskMaster': 'Мастер задач', 'pf.b.taskMasterD': '100 выполненных задач',
    'pf.b.careful': 'Аккуратные руки', 'pf.b.carefulD': 'Месяц без боя посуды',
    'pf.b.menuPassed': 'Меню сдано', 'pf.b.attPassed': 'Аттестация сдана',
    'pf.b.menuDesc': 'Сдай меню — ставка станет 250 000', 'pf.b.attDesc': 'Сдай аттестации — ставка станет 250 000',
    'pf.b.rateSet': 'ставка 250 000 ✓', 'pf.b.rateWill': 'сейчас 200 000 → будет 250 000',
    'pf.bioDisable': '🔓 Отключить вход по биометрии', 'pf.bioOnHint': 'Вход по Face ID / отпечатку включён на этом устройстве',
    'pf.bioEnable': '👆 Включить вход по Face ID / отпечатку', 'pf.bioOffHint': 'Открывать приложение по биометрии, без пароля (на этом устройстве)',
    'pf.security': 'Безопасность', 'pf.changePassword': '🔑 Сменить мой пароль',
    'pf.notifTitle': 'Уведомления в Telegram', 'pf.notifDesc': 'Что присылать вам в Telegram. Настройка только для вашего аккаунта.',
    'pf.n.late': '⏰ Опоздания', 'pf.n.lateD': 'Кто-то опоздал на смену',
    'pf.n.checklist': '☑️ Выполнение чек-листов', 'pf.n.checklistD': 'Чек-лист смены выполнен',
    'pf.n.review': '⭐ Плохие отзывы', 'pf.n.reviewD': 'Негативный отзыв гостя',
    'pf.n.checkin': '🎥 Отметки прихода', 'pf.n.checkinD': 'Приход подчинённых по цеху',
    'pf.n.taskNew': '🔔 Новые задачи', 'pf.n.taskNewD': 'Вам назначили задачу',
    'pf.n.taskComment': '💬 Комментарии к задачам', 'pf.n.taskCommentD': 'Новое сообщение в обсуждении',
    'pf.n.schedule': '📅 Изменения графика', 'pf.n.scheduleD': 'Ваша смена изменилась',
    'pf.tab.overview': 'Обзор', 'pf.tab.achievements': '🏅 Достижения', 'pf.tab.history': 'История', 'pf.tab.team': '👥 Команда',
    'pf.passMin': 'Пароль минимум 6 символов', 'pf.passMismatch': 'Пароли не совпадают', 'pf.passChanged': '✅ Пароль изменён', 'pf.notifSaved': '✅ Настройки уведомлений сохранены',
    'pf.passModalTitle': 'Смена пароля', 'pf.passNew': 'Новый пароль', 'pf.passNewPh': 'минимум 6 символов', 'pf.passRepeat': 'Повторите пароль', 'pf.passRepeatPh': 'ещё раз',
    // Общий чат
    'chat.title': '💬 Чат команды', 'chat.noMessages': 'Пока нет сообщений.<br>Начни общение первым!',
    'chat.onlyAdminPin': 'Только управляющий может закреплять', 'chat.observerRead': 'Режим наблюдателя — вы можете только читать чат',
    'chat.inputPh': 'Написать сообщение...', 'chat.pinned': '📌 Закреплённые',
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
    // HR / сотрудники / зарплата
    'hr.title': 'Ходимлар', 'hr.searchPh': '🔍 Исм, лавозим бўйича қидириш...',
    'hr.found': 'Топилди: {n}', 'hr.allStaff': 'Штатда {n} киши (барча филиаллар)', 'hr.onFilial': '«{f}» филиалида {n} · жами {total}',
    'hr.dailyPayrollBtn': '💵 Бугунги ведомость · {f}', 'hr.monthPayrollBtn': '💰 Ойлик маош · {f}',
    'hr.showThisFilial': '📍 Фақат шу филиални кўрсатиш', 'hr.showAll': '👥 Барча ходимларни кўрсатиш',
    'hr.geoBtn': '📍 Келишни гео-белгилаш · {f}', 'hr.nobodyFound': 'Ҳеч ким топилмади', 'hr.noEmpFilial': 'Бу филиал учун ходимлар йўқ', 'hr.loadErr': 'Хато',
    'hr.unavailableObserver': 'Кузатувчи режимида мавжуд эмас', 'hr.unavailable': 'Мавжуд эмас',
    'hr.gpsDetecting': '📍 Координаталар аниқланмоқда...', 'hr.gpsFail': 'GPS олиб бўлмади. Геолокацияни ёқинг ва сайтга рухсат беринг.',
    'hr.newPoint': 'Янги нуқта: ', 'hr.gpsAccuracy': 'GPS аниқлиги ±{n} м · «Сақлаш» ни босинг', 'hr.coordsCaught': '✅ Координаталар олинди — «Сақлаш» ни босинг',
    'hr.setPointFirst': 'Аввал «Шу ерга нуқта қўйиш» тугмаси билан нуқта қўйинг', 'hr.pointSaved': '✅ «{f}» нуқтаси сақланди (радиус {r} м)', 'hr.geoOff': 'Бу филиал учун гео-текширув ўчирилди',
    'hr.pointSet': '✅ Нуқта белгиланган: ', 'hr.radius': 'радиус {r} м', 'hr.updatedBy': 'янгилади: ', 'hr.pointNotSet': 'Нуқта ҳали белгиланмаган — гео-текширув ўчирилган. Филиал ичида туриб «Шу ерга нуқта қўйиш» ни босинг.',
    'hr.calculating': 'Ҳисобланмоқда...', 'hr.monthLedgerTitle': '💰 Ведомость · {month} · {f}',
    'hr.monthLedgerHint': 'Сменалар бўйича тўлов (смена тури ва «барда ёлғиз» ҳисобга олинган) − кечикиш жарималари. «{f}» филиали маълумотлари.',
    'hr.shiftsRate': '{n} смена · ставка {r} = {e}', 'hr.penalty': 'жарима −{p}', 'hr.totalFund': 'ЖАМИ тўлов фонди', 'hr.noMonthData': 'Ой учун маълумот йўқ',
    'hr.dailyLedgerTitle': '💵 Бугунги ведомость · {date} · {f}', 'hr.nobodyToday': 'Бугунга сменада ҳеч ким йўқ',
    'hr.dailyHint': 'Смена бўйича тўлов − жарималар + мукофотлар. Бугунги график, «{f}» филиали.',
    'hr.notCheckedIn': 'белгиламади', 'hr.arrivedLate': 'келди <b>{time}</b> · <span style="color:#A13C3C">{m}д кечикди</span>', 'hr.arrivedOnTime': 'келди <b>{time}</b> · <span style="color:#3B6D11">ўз вақтида</span>',
    'hr.rate': 'Ставка {r}', 'hr.premiumPlus': 'мукофот +{s}', 'hr.premiumFallback': 'мукофот', 'hr.addPremiumBtn': '+ Мукофот', 'hr.toPay': 'Тўлашга: {t}', 'hr.totalToday': 'ЖАМИ бугунга тўлашга',
    'hr.premiumOnlyMgr': 'Мукофотни менежер ёки бошқарувчи бера олади', 'hr.enterPremium': 'Мукофот суммасини киритинг', 'hr.premiumAdded': '✅ Мукофот қўшилди', 'hr.removePremium': 'Бу мукофотни олиб ташлайсизми?',
    'hr.premiumTitle': '➕ Мукофот', 'hr.premiumSum': 'Мукофот суммаси (сўм)', 'hr.premiumFor': 'Нима учун (ихтиёрий)', 'hr.premiumForPh': 'Масалан: ошхонада ёрдам берди', 'hr.addPremiumSubmit': 'Мукофот қўшиш',
    'hr.enterName': 'Исмни киритинг', 'hr.enterEmailPass': 'Email ва паролни киритинг', 'hr.empAdded': '✅ Ходим қўшилди',
    'hr.newEmp': 'Янги ходим', 'hr.fullName': 'Исм ва фамилия', 'hr.role': 'Лавозим', 'hr.deptForSchedule': 'Бўлим (график учун)', 'hr.noDept': '— Бўлимсиз (графикда эмас) —',
    'hr.phone': 'Телефон', 'hr.salaryPerShift': 'Смена ставкаси (сўм)', 'hr.login': 'Логин (@slon.uz сиз)', 'hr.password': 'Парол', 'hr.systemRole': 'Тизимдаги роль',
    'hr.roleEmployee': 'Ходим', 'hr.roleManager': 'Менежер', 'hr.roleAdmin': 'Бошқарувчи', 'hr.roleBoss': 'Эга (кузатувчи)',
    'hr.filialsCanWork': 'Қайси филиалларда ишлай олади', 'hr.addEmpSubmit': 'Ходим қўшиш',
    'hr.grpHall': 'Зал', 'hr.grpBar': 'Бар', 'hr.grpHookah': 'Кальянхона', 'hr.grpKitchen': 'Ошхона', 'hr.grpMgmt': 'Раҳбарият', 'hr.grpOther': 'Бошқа',
    // Финансы
    'fin.title': 'Молия', 'fin.income': 'Даромадлар', 'fin.expenses': 'Харажатлар', 'fin.sumPerMonth': 'ой учун сўм',
    'fin.profitMonth': 'Ой фойдаси', 'fin.monthDefault': 'Ой', 'fin.dayDefault': 'Кун', 'fin.opsMonth': 'Ой операциялари',
    'fin.guestsMonth': 'Ой давомида меҳмонлар', 'fin.avgCheck': 'Ўртача чек', 'fin.revByType': 'Тўлов турлари бўйича тушум · ой учун', 'fin.noOps': 'Бу ойда операциялар йўқ.',
    'fin.kassa': 'Касса', 'fin.payTypes': 'Тўлов турлари', 'fin.deposits': 'киритишлар', 'fin.withdrawals': 'олишлар', 'fin.inCash': 'кассада', 'fin.guests': 'Меҳмонлар',
    'fin.noKassaDay': 'Бу кунга касса киритилмаган.', 'fin.dayExpenses': 'Кун харажатлари', 'fin.expenseFallback': 'Харажат',
    'fin.editKassa': '✏️ Кассани таҳрирлаш', 'fin.enterKassa': '💵 Касса киритиш', 'fin.expenseBtn': '➖ Харажат',
    'fin.kassaTitle': '💵 Кун кассаси', 'fin.forDate': 'Сана учун:', 'fin.bizDayHint': 'Касса куни = смена бошланган кун. Кечаси (8:00 гача) стандарт бўйича кечаги сана қўйилади — 12:00–03:00 сменаси учун шундай бўлиши керак.',
    'fin.scanReceipt': '📷 Чекдан ўқиш', 'fin.scanHint': 'Z-ҳисоботни суратга олинг ёки галереядан танланг — суммалар ўзи қўйилади, фақат солиштириш қолади.',
    'fin.breakdownLabel': 'Тўлов турлари бўйича тақсимот', 'fin.addLine': '+ Қатор қўшиш', 'fin.totalRevenue': 'Жами тушум (дашборд ва ФОТга киради)', 'fin.sumFromLines': '↻ Жами = қаторлар йиғиндиси',
    'fin.cashMovement': 'Нақд пул ҳаракати (ихтиёрий):', 'fin.depositsL': 'Киритишлар', 'fin.withdrawalsL': 'Олишлар', 'fin.inCashL': 'Кассада',
    'fin.attendance': 'Ташриф:', 'fin.guestsPerDay': 'Кунлик меҳмонлар', 'fin.saveKassa': 'Кассани сақлаш',
    'fin.scanLoading': '⏳ Сурат юкланмоқда...', 'fin.scanRecognizing': '🔍 Чек ўқилмоқда...', 'fin.scanFail': '⚠️ Ўқиб бўлмади. Қаторларни қўлда қўшинг.', 'fin.scanDone': '✅ Ўқилди — рақамларни солиштиринг ва керак бўлса тузатинг.',
    'fin.enterRevenue': 'Жами тушумни киритинг', 'fin.kassaSaved': '✅ Касса сақланди', 'fin.kassaDefault': 'Кун кассаси',
    'fin.kassaExists': '{d} учун касса аллақачон киритилган: {n} сўм. Сақлаш уни қайта ёзади.', 'fin.scanOrManual': 'Чекдан ўқинг ёки қаторларни қўлда қўшинг.',
    'fin.expenseTitle': '➖ Харажат', 'fin.amountSum': 'Сумма (сўм)', 'fin.category': 'Категория', 'fin.comment': 'Изоҳ', 'fin.addExpense': 'Харажат қўшиш', 'fin.enterAmount': 'Суммани киритинг', 'fin.expenseAdded': '✅ Харажат қўшилди',
    'fin.newOp': 'Янги операция', 'fin.type': 'Тури', 'fin.incomeOpt': 'Даромад', 'fin.expenseOpt': 'Харажат', 'fin.desc': 'Тавсиф', 'fin.add': 'Қўшиш', 'fin.opAdded': '✅ Операция қўшилди', 'fin.deleteOp': 'Бу операцияни ўчирасизми?',
    // Личный кабинет — тело
    'pf.title': '📄 Шахсий кабинет',
    'pf.salaryTitle': 'Маош · {month}', 'pf.earnedNow': 'Ҳозиргача ишлаб топилди', 'pf.forecast': 'Ой охирига прогноз',
    'pf.workedInfo': '{worked} смена ишланди · графикда олдинда {planned}', 'pf.withheld': ' · ушлаб қолинди {p}',
    'pf.upcomingShifts': 'Яқин сменалар', 'pf.today': 'бугун', 'pf.dayOff': '🌴 Дам олиш',
    'pf.myActiveTasks': 'Менинг фаол вазифаларим ({n})', 'pf.noOverview': 'Ҳозирча кўрсаткичлар йўқ', 'pf.taskStats': 'Вазифалар статистикаси',
    'pf.withholdings': 'Ой давомида ушланмалар', 'pf.totalWithheld': 'Жами: −{p} сўм', 'pf.lateByMin': '{min} дақиқа кечикиш',
    'pf.shiftHistory': 'Сменалар тарихи (14 кун)', 'pf.noShifts': 'Ҳали сменалар йўқ', 'pf.notLinked': 'Ходим профили боғланмаган',
    'pf.allControl': '✅ Ҳаммаси назоратда · {f}', 'pf.allControlSub': 'Бугун муддати ўтган вазифалар, кечикишлар ва шикоятлар йўқ',
    'pf.needAttention': '⚠️ Эътибор талаб қилади · {f}', 'pf.overdueTasks': '⏰ Муддати ўтган вазифалар', 'pf.latesToday': '🚶 Бугунги кечикишлар', 'pf.badReviews': '👎 Бугунги ёмон фикрлар',
    'pf.teamToday': 'Бугунги жамоа · {f}', 'pf.notCheckedIn': 'белгиламади', 'pf.wasLate': '{m}д кечикди', 'pf.onShift': 'сменада', 'pf.noTeamData': 'Жамоа бўйича маълумот йўқ',
    'pf.achievements': 'Ютуқлар ({e}/{total})', 'pf.received': '✓ олинди',
    'pf.b.shifts': 'смена', 'pf.b.clean': 'тоза!', 'pf.b.lateCount': '{n} кечикиш', 'pf.b.none': 'биттаям йўқ!', 'pf.b.breakCount': '{n} синган',
    'pf.b.perfectWeek': 'Мукаммал ҳафта', 'pf.b.perfectWeekD': 'Кетма-кет 7 смена кечикишсиз',
    'pf.b.punctual': 'Аниқлик', 'pf.b.punctualD': 'Кетма-кет 20 смена кечикишсиз',
    'pf.b.discipline': 'Темир интизом', 'pf.b.disciplineD': 'Бир ой кечикишсиз',
    'pf.b.performer': 'Ижрочи', 'pf.b.performerD': '50 та бажарилган вазифа',
    'pf.b.taskMaster': 'Вазифалар устаси', 'pf.b.taskMasterD': '100 та бажарилган вазифа',
    'pf.b.careful': 'Эҳтиёткор қўллар', 'pf.b.carefulD': 'Бир ой идиш синдирмасдан',
    'pf.b.menuPassed': 'Меню топширилди', 'pf.b.attPassed': 'Аттестация топширилди',
    'pf.b.menuDesc': 'Менюни топшир — ставка 250 000 бўлади', 'pf.b.attDesc': 'Аттестацияни топшир — ставка 250 000 бўлади',
    'pf.b.rateSet': 'ставка 250 000 ✓', 'pf.b.rateWill': 'ҳозир 200 000 → 250 000 бўлади',
    'pf.bioDisable': '🔓 Биометрия орқали киришни ўчириш', 'pf.bioOnHint': 'Бу қурилмада Face ID / бармоқ изи орқали кириш ёқилган',
    'pf.bioEnable': '👆 Face ID / бармоқ изи орқали киришни ёқиш', 'pf.bioOffHint': 'Иловани биометрия орқали, паролсиз очиш (шу қурилмада)',
    'pf.security': 'Хавфсизлик', 'pf.changePassword': '🔑 Паролимни ўзгартириш',
    'pf.notifTitle': 'Telegram хабарномалари', 'pf.notifDesc': 'Telegram да сизга нима юборилсин. Созлама фақат сизнинг аккаунтингиз учун.',
    'pf.n.late': '⏰ Кечикишлар', 'pf.n.lateD': 'Кимдир сменага кечикди',
    'pf.n.checklist': '☑️ Чек-листлар бажарилиши', 'pf.n.checklistD': 'Смена чек-листи бажарилди',
    'pf.n.review': '⭐ Ёмон фикрлар', 'pf.n.reviewD': 'Меҳмоннинг салбий фикри',
    'pf.n.checkin': '🎥 Келиш белгилари', 'pf.n.checkinD': 'Цех бўйича қўл остидагиларнинг келиши',
    'pf.n.taskNew': '🔔 Янги вазифалар', 'pf.n.taskNewD': 'Сизга вазифа берилди',
    'pf.n.taskComment': '💬 Вазифа шарҳлари', 'pf.n.taskCommentD': 'Муҳокамада янги хабар',
    'pf.n.schedule': '📅 График ўзгаришлари', 'pf.n.scheduleD': 'Сменангиз ўзгарди',
    'pf.tab.overview': 'Кўриб чиқиш', 'pf.tab.achievements': '🏅 Ютуқлар', 'pf.tab.history': 'Тарих', 'pf.tab.team': '👥 Жамоа',
    'pf.passMin': 'Парол камида 6 белги', 'pf.passMismatch': 'Пароллар мос эмас', 'pf.passChanged': '✅ Парол ўзгартирилди', 'pf.notifSaved': '✅ Хабарнома созламалари сақланди',
    'pf.passModalTitle': 'Паролни ўзгартириш', 'pf.passNew': 'Янги парол', 'pf.passNewPh': 'камида 6 белги', 'pf.passRepeat': 'Паролни такрорланг', 'pf.passRepeatPh': 'яна бир бор',
    // Общий чат
    'chat.title': '💬 Жамоа чати', 'chat.noMessages': 'Ҳали хабарлар йўқ.<br>Мулоқотни биринчи бўлиб бошланг!',
    'chat.onlyAdminPin': 'Фақат бошқарувчи қадай олади', 'chat.observerRead': 'Кузатувчи режими — чатни фақат ўқий оласиз',
    'chat.inputPh': 'Хабар ёзиш...', 'chat.pinned': '📌 Қадалганлар',
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
