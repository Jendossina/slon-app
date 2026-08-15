const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');

// Лёгкие дымовые тесты без логина: проверяют, что оболочка приложения
// (HTML + все 21 js-модуля + service worker) грузится и работает без
// ошибок. Экраны за логином (задачи, HR и т.д.) тут не проверяются —
// для этого нужен тестовый аккаунт, см. README при желании расширить.

test('страница логина открывается без ошибок консоли', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page).toHaveTitle(/Slon Shisha/);
  await expect(page.locator('#login-page')).toBeVisible();
  await expect(page.locator('#login-email')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();

  expect(errors).toEqual([]);
});

test('все js-модули загрузились и объявили свои функции', async ({ page }) => {
  await page.goto('/');
  const names = [
    'showScreen', 'loadHome', 'loadTasks', 'loadHR', 'loadFinance', 'loadCRM',
    'loadAdmin', 'loadSchedule', 'loadChecklist', 'loadKnowledgeBase', 'loadSupply',
    'loadDishware', 'loadBonus', 'openQuiz', 'loadDirectory', 'loadHelp', 'loadMyNotes', 'loadDashboard',
    'loadCalendar', 'loadFeed', 'loadReviews', 'initTeamChat',
    'escapeHtml', 'escJsAttr', 'doLogin', 'showApp',
  ];
  const missing = await page.evaluate((ns) => ns.filter((n) => typeof window[n] !== 'function'), names);
  expect(missing).toEqual([]);
});

// Кнопка «Обновить» в личном кабинете: должна дотянуться до service worker,
// а если новой версии нет — честно сказать, что и так последняя.
test('кнопка обновления сообщает, что версия уже последняя', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => typeof window.renderUpdateCard === 'function');

  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

  const res = await page.evaluate(async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="update-card"></div>');
    await renderUpdateCard();
    const card = document.getElementById('update-card').innerText;
    await forceWebUpdate();
    return { card, status: document.getElementById('update-status').textContent, shell: await appShellVersion() };
  });

  expect(res.shell).toMatch(/^v\d+$/);              // версия содержимого видна
  expect(res.card).toContain('версия содержимого');
  expect(res.status).toContain('последняя версия'); // нового sw.js нет — обновлять нечего
  expect(navigations).toBe(0);                      // и страницу зря не перезагружаем
});

// Старший цеха: полный хозяин внутри своего отдела и никто за его пределами.
// Права даёт должность, а не роль в системе, поэтому легко случайно раздать
// лишнее — тест держит границу.
test('старший цеха ведёт свой отдел и не лезет в чужие', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.canLeadDept === 'function');

  const res = await page.evaluate(() => {
    const as = (role, job, dept) => {
      currentProfile = { role, name: 'Тест', employee_id: 1 };
      currentEmployee = dept ? { id: 1, name: 'Тест', role: job, department: dept } : null;
    };
    const out = {};

    // шеф кальянной станции — обычный сотрудник по системной роли
    as('employee', 'Шеф кальянной станции', 'Кальянные мастера');
    out.lead = {
      isLead: isDeptLead(), dept: myLeadDept(),
      ownDept: canLeadDept('Кальянные мастера'), otherDept: canLeadDept('Повара'),
      ownSchedule: canEditScheduleDept('Кальянные мастера'), otherSchedule: canEditScheduleDept('Повара'),
      salary: canSeeSalaryRole(), finance: canSeeFinance(), adminPanel: canOpenAdminPanel(),
      fullStaff: canManageStaffFully(), editData: canEditData(),
      kbOwnBook: kbCanEdit({ edit_dept: 'Кальянные мастера' }),
      kbBarBook: kbCanEdit({ edit_role: 'admin' }),
      kbEquipment: kbCanEdit({ edit_role: 'manager' }),
      kbBooks: kbCanEditBooks(),
    };

    // рядовой кальянщик — прав цеха не получает
    as('employee', 'Кальянный мастер', 'Кальянные мастера');
    out.plain = { isLead: isDeptLead(), ownDept: canLeadDept('Кальянные мастера') };

    // управляющий ведёт любой отдел и правит любую книгу — как раньше
    as('admin', null, null);
    out.admin = { anyDept: canLeadDept('Повара'), kbOwnBook: kbCanEdit({ edit_dept: 'Кальянные мастера' }) };

    // менеджер ведёт отделы, но книга цеха сама по себе прав ему не даёт
    as('manager', null, null);
    out.manager = { anyDept: canLeadDept('Повара'), kbOwnBook: kbCanEdit({ edit_dept: 'Кальянные мастера' }) };

    // владелец только смотрит
    as('boss', 'Шеф кальянной станции', 'Кальянные мастера');
    out.boss = { isLead: isDeptLead(), ownDept: canLeadDept('Кальянные мастера') };
    return out;
  });

  // что старшему можно
  expect(res.lead.isLead).toBe(true);
  expect(res.lead.dept).toBe('Кальянные мастера');
  expect(res.lead.ownDept).toBe(true);
  expect(res.lead.ownSchedule).toBe(true);
  expect(res.lead.kbOwnBook).toBe(true);
  // и чего нельзя
  expect(res.lead.otherDept).toBe(false);
  expect(res.lead.otherSchedule).toBe(false);
  expect(res.lead.salary).toBe(false);
  expect(res.lead.finance).toBe(false);
  expect(res.lead.adminPanel).toBe(false);
  expect(res.lead.fullStaff).toBe(false);
  expect(res.lead.editData).toBe(false);
  expect(res.lead.kbBarBook).toBe(false);
  expect(res.lead.kbEquipment).toBe(false);
  expect(res.lead.kbBooks).toBe(false);

  expect(res.plain).toEqual({ isLead: false, ownDept: false });
  expect(res.admin.anyDept).toBe(true);
  expect(res.admin.kbOwnBook).toBe(true);      // админ правит любую книгу, как и раньше
  expect(res.manager.anyDept).toBe(true);
  expect(res.manager.kbOwnBook).toBe(false);   // а книга цеха — только старшему этого цеха
  expect(res.boss).toEqual({ isLead: false, ownDept: false });
});

// Отчёт по кальянам: вносит станция, сводку видит руководство и старший
// станции — и только свою вкладку, без денег заведения.
test('кальяны: кто вносит отчёт и кто видит сводку', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.hookahCanReport === 'function');

  const res = await page.evaluate(() => {
    const as = (role, job, dept) => {
      currentProfile = { role, name: 'Тест', employee_id: 1 };
      currentEmployee = dept ? { id: 1, name: 'Тест', role: job, department: dept } : null;
    };
    const out = {};
    as('employee', 'Кальянный мастер', 'Кальянные мастера');
    out.master = { report: hookahCanReport(), stats: hookahCanSeeStats(), tabs: dashTabList().map(x=>x.id) };

    as('employee', 'Шеф кальянной станции', 'Кальянные мастера');
    out.lead = { report: hookahCanReport(), stats: hookahCanSeeStats(), tabs: dashTabList().map(x=>x.id) };

    as('employee', 'Повар', 'Повара');
    out.cook = { report: hookahCanReport(), stats: hookahCanSeeStats() };

    as('admin', null, null);
    out.admin = { report: hookahCanReport(), tabs: dashTabList().map(x=>x.id) };

    as('boss', null, null);
    out.boss = { tabs: dashTabList().map(x=>x.id) };
    return out;
  });

  // мастер вносит отчёт, но дашборд не открывает
  expect(res.master.report).toBe(true);
  expect(res.master.stats).toBe(false);
  // старший станции: вносит и видит сводку — но ТОЛЬКО вкладку кальянов
  expect(res.lead.report).toBe(true);
  expect(res.lead.stats).toBe(true);
  expect(res.lead.tabs).toEqual(['hookah']);
  // повар — мимо
  expect(res.cook.report).toBe(false);
  expect(res.cook.stats).toBe(false);
  // руководство видит всё, включая новую вкладку
  expect(res.admin.report).toBe(true);
  expect(res.admin.tabs).toContain('hookah');
  expect(res.admin.tabs).toContain('overview');
  // владелец — обзор и кальяны
  expect(res.boss.tabs).toEqual(['overview', 'hookah']);
});

// Полоска «доступна новая версия». Главное правило: она предлагает, а не
// перезагружает сама — однажды самовольная перезагрузка пришлась ровно на
// съёмку видео прихода и съела отметку.
test('полоска обновления предлагает, но не перезагружает сама', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.showUpdateBanner === 'function');

  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

  // 1) во время съёмки видео прихода полоска не лезет поверх камеры
  const duringRecording = await page.evaluate(() => {
    document.getElementById('checkin-recorder').style.display = 'flex';
    showUpdateBanner('web');
    const shown = getComputedStyle(document.getElementById('update-banner')).display !== 'none';
    document.getElementById('checkin-recorder').style.display = 'none';
    return shown;
  });
  expect(duringRecording).toBe(false);

  // 2) в обычной ситуации — показывается и ждёт нажатия
  const banner = await page.evaluate(() => {
    updateBannerShown = false;
    showUpdateBanner('web');
    const el = document.getElementById('update-banner');
    return { visible: getComputedStyle(el).display !== 'none', text: el.innerText };
  });
  expect(banner.visible).toBe(true);
  expect(banner.text).toContain('Доступна новая версия');
  expect(navigations).toBe(0);

  // 3) закрыли крестиком — исчезла
  const afterHide = await page.evaluate(() => {
    hideUpdateBanner();
    return getComputedStyle(document.getElementById('update-banner')).display !== 'none';
  });
  expect(afterHide).toBe(false);
});

// Го/стоп-лист: позиции берутся из меню кухни, ставятся кнопкой, а не руками.
test('го/стоп: поиск по меню и постановка одной кнопкой', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.renderStopPickerList === 'function');

  const result = await page.evaluate(async () => {
    // права повара по кухне
    currentProfile = { name: 'Повар', role: 'employee', employee_id: 1 };
    currentEmployee = { id: 1, name: 'Повар', role: 'Повар', department: 'Повара' };
    currentUser = { id: 'u1', email: 'cook@slon.uz' };
    stopListActive = [];
    stopPickerArea = 'kitchen';

    const list = document.getElementById('stop-picker-list');
    stopPickerQuery = '';
    renderStopPickerList();
    const allRows = list.querySelectorAll('button').length;

    stopPickerQuery = 'цезарь';
    renderStopPickerList();
    const found = list.innerText;

    stopPickerQuery = 'такого блюда нет';
    renderStopPickerList();
    const empty = list.innerText;

    // позиция уже в листе — вместо кнопок «стоп/го» показываем «вернуть»
    stopListActive = [{ id: 7, area: 'kitchen', name: 'Греческий салат', state: 'stop' }];
    stopPickerQuery = 'греческий';
    renderStopPickerList();
    const withActive = list.innerText;

    return {
      allRows,
      caesarHasBoth: found.includes('Цезарь с курицей') && found.includes('Цезарь с креветками'),
      caesarNoOthers: !found.includes('Греческий салат'),
      emptyText: empty,
      activeShowsReturn: withActive.includes('Вернуть'),
      menuCount: kitchenMenuFlat().length,
    };
  });

  expect(result.menuCount).toBeGreaterThan(70);   // всё меню на месте
  expect(result.allRows).toBeGreaterThan(140);    // по две кнопки на позицию
  expect(result.caesarHasBoth).toBe(true);
  expect(result.caesarNoOthers).toBe(true);
  expect(result.emptyText).toContain('ничего не нашлось');
  expect(result.activeShowsReturn).toBe(true);
});

// Регресс-тест на жалобу «опять выкинуло на экран входа».
// Экран входа был виден по умолчанию, и пока приложение выясняло, кто вошёл,
// человек смотрел на форму пароля. С мгновенной загрузкой это стало особенно
// заметно. Теперь до ответа висит заставка, а форма входа появляется, только
// если сохранённого входа действительно нет.
test('вошедшему человеку форма входа не показывается (регресс-тест)', async ({ page }) => {
  // Ответ про профиль приходит с задержкой — имитируем мобильный интернет
  await page.route('**/rest/v1/profiles**', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ user_id: 'u1', name: 'Тест', role: 'employee', employee_id: null }]) });
  });
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.addInitScript(() => {
    // как будто человек уже вошёл: сессия лежит в хранилище
    const session = {
      access_token: 'test-token', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
      user: { id: 'u1', email: 'test@slon.uz', aud: 'authenticated', role: 'authenticated' },
    };
    localStorage.setItem('sb-omeomdkurvtvirhfkffu-auth-token', JSON.stringify(session));
  });

  await page.goto('/');
  // пока грузится профиль — заставка, а не форма пароля
  await expect(page.locator('#app-splash')).toBeVisible();
  await expect(page.locator('#login-page')).toBeHidden();
  await page.waitForTimeout(1500);
  await expect(page.locator('#login-page')).toBeHidden();

  // как только профиль пришёл — приложение
  await expect(page.locator('#app-page')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#login-page')).toBeHidden();
  await expect(page.locator('#app-splash')).toBeHidden();
});

// Установка версии качает только ядро — иначе на слабой связи она не доходит
// до конца, браузер её отменяет, и телефон навсегда остаётся на старой версии
// (ровно это случилось у сотрудников). Остальное кеш добирает на ходу.
test('service worker ставится малой кровью и добирает остальное на ходу', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const afterInstall = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    return { registered: !!reg.active, files: (await cache.keys()).length, caches: keys.length };
  });
  expect(afterInstall.registered).toBe(true);
  expect(afterInstall.caches).toBe(1);            // ровно одна версия, без смеси
  expect(afterInstall.files).toBeGreaterThan(5);  // ядро на месте
  expect(afterInstall.files).toBeLessThan(15);    // но не вся оболочка разом

  // Второй запуск идёт уже через service worker — он и добирает остальные файлы
  const page2 = await page.context().newPage();
  await page2.goto('/');
  await page2.waitForTimeout(1500);
  const afterSecond = await page2.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    return (await cache.keys()).length;
  });
  expect(afterSecond).toBeGreaterThan(20);
});

// Ради этого всё и затевалось: на телефоне приложение не должно ждать сеть
// на каждом запуске. Прогретый кеш обязан поднимать приложение и без интернета.
test('приложение поднимается из кеша, а не из сети (регресс-тест)', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const warm = await context.newPage();          // прогреваем кеш вторым запуском
  await warm.goto('/');
  await warm.waitForTimeout(1500);

  await context.setOffline(true);
  const page2 = await context.newPage();
  const errors = [];
  page2.on('pageerror', (e) => errors.push(e.message));
  await page2.goto('/');
  await expect(page2.locator('#login-page')).toBeVisible();
  const ready = await page2.evaluate(() => typeof window.showApp === 'function' && typeof window.loadHome === 'function');
  // ресурсы, отданные service worker: пришли без сети, но с телом
  const fromCache = await page2.evaluate(() => performance.getEntriesByType('resource')
    .filter((r) => r.transferSize === 0 && r.decodedBodySize > 0).length);
  await context.setOffline(false);

  expect(ready).toBe(true);
  expect(fromCache).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('неверный пароль показывает ошибку, а не тишину', async ({ page }) => {
  await page.goto('/');
  await page.fill('#login-email', 'no-such-user@slon.uz');
  await page.fill('#login-password', 'definitely-wrong-password');
  await page.click('button:has-text("Войти")');
  await expect(page.locator('#login-error')).toHaveText(/Неверный логин или пароль/, { timeout: 10000 });
});

test('страница логина проходит проверку доступности (axe-core)', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

// Регресс-тест: локальная переменная с именем `t` затеняла функцию перевода t(),
// из-за чего openKassaModal падал с "t is not a function" ДО открытия модалки —
// кнопка «Внести кассу» выглядела мёртвой, без единого видимого признака ошибки.
test('кнопка «Внести кассу» открывает модалку, а не падает (регресс-тест)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => typeof window.openKassaModal === 'function');

  const threw = await page.evaluate(async () => {
    try { await window.openKassaModal('2026-01-01'); return null; }
    catch (e) { return String(e && e.message || e); }
  });

  expect(threw, 'openKassaModal бросил исключение').toBeNull();
  await expect(page.locator('#modal-kassa')).toHaveClass(/open/);
  expect(errors.filter((e) => /is not a function/.test(e)), JSON.stringify(errors)).toEqual([]);
});

// Проверяет контракт: фото с EXIF «показывать зеркально» после сжатия должно
// выйти РАЗвёрнутым, потому что canvas.toBlob() EXIF не сохраняет.
// ВАЖНО: Chromium применяет EXIF к <img> сам, поэтому здесь проходит и старый
// код тоже — этот тест не воспроизводит жалобу, а сторожит поведение. Реально
// ориентацию теряют WebView/Samsung Internet, где drawImage берёт сырые пиксели.
test('compressImage применяет EXIF-ориентацию, а не зеркалит фото (регресс-тест)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.compressImage === 'function');

  const r = await page.evaluate(async () => {
    // Картинка: левая половина красная, правая синяя
    const c = document.createElement('canvas');
    c.width = 800; c.height = 400;
    const cx = c.getContext('2d');
    cx.fillStyle = '#ff0000'; cx.fillRect(0, 0, 400, 400);
    cx.fillStyle = '#0000ff'; cx.fillRect(400, 0, 400, 400);
    const plain = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await plain.arrayBuffer());

    // APP1 с Orientation = 2 («показывать зеркально по горизонтали»)
    const exif = new Uint8Array([
      0xFF,0xE1,0x00,0x22, 0x45,0x78,0x69,0x66,0x00,0x00,
      0x49,0x49,0x2A,0x00, 0x08,0x00,0x00,0x00,
      0x01,0x00,
      0x12,0x01,0x03,0x00, 0x01,0x00,0x00,0x00, 0x02,0x00,0x00,0x00,
      0x00,0x00,0x00,0x00,
    ]);
    const withExif = new Uint8Array(bytes.length + exif.length);
    withExif.set(bytes.subarray(0, 2), 0);             // SOI
    withExif.set(exif, 2);                             // APP1
    withExif.set(bytes.subarray(2), 2 + exif.length);  // остальное
    const file = new File([withExif], 'photo.jpg', { type: 'image/jpeg' });

    const out = await window.compressImage(file, 400, 0.7);
    const compressed = out !== file && out.size < file.size;

    // Читаем СЫРЫЕ пиксели результата (EXIF в нём уже нет)
    const bmp = await createImageBitmap(out, { imageOrientation: 'none' });
    const c2 = document.createElement('canvas');
    c2.width = bmp.width; c2.height = bmp.height;
    c2.getContext('2d').drawImage(bmp, 0, 0);
    const px = (x) => Array.from(c2.getContext('2d').getImageData(x, Math.round(bmp.height / 2), 1, 1).data);
    return { compressed, left: px(Math.round(bmp.width * 0.1)), right: px(Math.round(bmp.width * 0.9)) };
  });

  expect(r.compressed, 'сжатие не сработало — сравнение пикселей не показательно').toBe(true);
  // Orientation=2 => хранится [красный, синий], показывать надо [синий, красный]
  expect(r.left[2], `слева должно стать синим, получено rgb(${r.left.slice(0,3)})`).toBeGreaterThan(r.left[0]);
  expect(r.right[0], `справа должно стать красным, получено rgb(${r.right.slice(0,3)})`).toBeGreaterThan(r.right[2]);
});

// Математика разворота — то, чем приложение доворачивает фото в браузерах,
// которые не применяют EXIF сами (их в этом наборе тестов не воспроизвести).
test('applyOrientationTransform разворачивает верно (зеркало и поворот)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.applyOrientationTransform === 'function');

  const r = await page.evaluate(() => {
    // Источник: слева красный, справа синий; 80×40
    const s = document.createElement('canvas'); s.width = 80; s.height = 40;
    const sx = s.getContext('2d');
    sx.fillStyle = '#ff0000'; sx.fillRect(0, 0, 40, 40);
    sx.fillStyle = '#0000ff'; sx.fillRect(40, 0, 40, 40);

    const run = (o) => {
      const swap = window.orientationSwapsSides(o);
      const c = document.createElement('canvas');
      c.width = swap ? 40 : 80; c.height = swap ? 80 : 40;
      const cx = c.getContext('2d');
      window.applyOrientationTransform(cx, o, 80, 40);
      cx.drawImage(s, 0, 0, 80, 40);
      const at = (x, y) => Array.from(cx.getImageData(x, y, 1, 1).data);
      return { w: c.width, h: c.height, at };
    };

    const m = run(2);                                   // зеркало по горизонтали
    const mirrored = m.at(4, 20)[2] > m.at(4, 20)[0];   // слева должен стать синий
    const r6 = run(6);                                  // поворот на 90°
    return { mirrored, swapped: r6.w === 40 && r6.h === 80 };
  });

  expect(r.mirrored, 'ориентация 2 должна отзеркалить фото').toBe(true);
  expect(r.swapped, 'ориентация 6 должна поменять стороны местами').toBe(true);
});

// Регресс-тест: при обрыве связи показывали «Неверный логин или пароль», и человек
// на мобильном интернете перебирал пароли вместо того, чтобы чинить сеть.
test('при обрыве связи вход сообщает о сети, а не о пароле', async ({ page }) => {
  await page.route('**/auth/v1/token**', (route) => route.abort('failed'));

  await page.goto('/');
  await page.fill('#login-email', 'someone@slon.uz');
  await page.fill('#login-password', 'whatever');
  await page.click('button:has-text("Войти")');

  await expect(page.locator('#login-error')).toHaveText(/Нет связи с сервером/, { timeout: 15000 });
});

// Регресс-тест на жалобу «отметил приход — выкинуло на экран входа».
// Профиль не загрузился из-за связи, а код считал это «аккаунт не найден»
// и делал signOut. Обрыв связи не должен выводить человека из системы.
test('обрыв связи при загрузке профиля не выкидывает из аккаунта (регресс-тест)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.loadProfile === 'function');
  await page.route('**/rest/v1/profiles**', (route) => route.abort('failed'));

  const res = await page.evaluate(async () => {
    // currentUser объявлен через let — это не свойство window, присваиваем напрямую
    currentUser = { id: '00000000-0000-0000-0000-000000000001', email: 'x@slon.uz' };
    let signedOut = false;
    const realSignOut = sb.auth.signOut.bind(sb.auth);
    sb.auth.signOut = async () => { signedOut = true; return realSignOut(); };
    const out = await loadProfile();
    return { ok: out.ok, reason: out.reason, signedOut };
  });

  expect(res.ok).toBe(false);
  expect(res.reason).toBe('network');
  expect(res.signedOut).toBe(false);
});

// Проверка связи должна отличать «интернета нет» от «интернет есть, но до базы
// не доходит» — это разные причины, и чинят их по-разному.
test('проверка связи различает отсутствие интернета и недоступность базы', async ({ page }) => {
  // Сайт открывается, а база — нет: имитируем ограниченный тариф / блокировку
  await page.route('**/auth/v1/health**', (route) => route.abort('failed'));

  await page.goto('/');
  await page.waitForFunction(() => typeof window.runLoginDiagnostics === 'function');
  await page.evaluate(() => window.runLoginDiagnostics());

  await expect(page.locator('#login-diag')).toContainText(/до базы телефон не доходит/, { timeout: 20000 });
});

// Регресс-тест на реальную жалобу: «отметил все, а стало 52%».
// Пока шла запись в базу, отметки, сделанные в этот момент, затирались
// состоянием, собранным ДО её начала. Подменяем ответы PostgREST, чтобы
// запись была заметно медленной, и отмечаем пункты прямо во время неё.
test('галочки, поставленные во время сохранения, не теряются (регресс-тест)', async ({ page }) => {
  let server = [];                       // «состояние базы»
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await page.route('**/rest/v1/checklist_logs**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      await sleep(150);
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 10, items_done: server.slice(), items_by: {} }),
      });
    }
    if (req.method() === 'PATCH') {
      const patch = JSON.parse(req.postData() || '{}');
      await sleep(300);                  // медленная запись — окно для потери отметок
      server = (patch.items_done || []).slice();
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{ id: 10 }]),
      });
    }
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '[]' });
  });

  await page.goto('/');
  await page.waitForFunction(() => typeof window.toggleChecklistItem === 'function');

  const local = await page.evaluate(async () => {
    // Переменные объявлены через let — снаружи через window их не задать, только так
    eval(`
      currentUser = { id: 'u1', email: 't@slon.uz' };
      currentProfile = { name: 'Тест', role: 'employee' };
      currentChecklistTemplate = { id: 1, items: [1,2,3,4,5].map(id => ({ id, text: 'п'+id, section: 'с' })) };
      currentChecklistLog = { id: 10, items_done: [], items_by: {} };
      clBaseline = [];
    `);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    window.toggleChecklistItem(1, 1, '2026-07-27');
    await wait(600);                                   // запись началась
    [2, 3, 4, 5].forEach((id) => window.toggleChecklistItem(id, 1, '2026-07-27'));
    await wait(4000);                                  // даём досохраниться
    return eval('(currentChecklistLog.items_done || []).slice().sort((a,b)=>a-b)');
  });

  expect(local, 'в приложении должны остаться все 5 отметок').toEqual([1, 2, 3, 4, 5]);
  expect(server.slice().sort((a, b) => a - b), 'в базу должны уйти все 5 отметок').toEqual([1, 2, 3, 4, 5]);
});

// Права на график по должности: старший цеха правит только свой цех.
test('график: кто может править, а кто нет', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.canEditScheduleDept === 'function');

  const r = await page.evaluate(() => {
    const check = (role, empRole, empDept, dept) => {
      eval(`
        currentProfile = { role: ${JSON.stringify(role)}, employee_id: 1 };
        currentEmployee = ${empRole ? `{ id:1, role: ${JSON.stringify(empRole)}, department: ${JSON.stringify(empDept)} }` : 'null'};
      `);
      return window.canEditScheduleDept(dept);
    };
    return {
      adminAnyDept:      check('admin', null, null, 'Бармены'),
      managerAnyDept:    check('manager', null, null, 'Повара'),
      bossDenied:        check('boss', null, null, 'Бармены'),
      seniorBarOwnDept:  check('employee', 'Старший бармен', 'Бармены', 'Бармены'),
      seniorBarOther:    check('employee', 'Старший бармен', 'Бармены', 'Повара'),
      barManagerOwn:     check('employee', 'Бар менеджер', 'Бармены', 'Бармены'),
      sousChefOwn:       check('employee', 'Су-шеф', 'Повара', 'Повара'),
      headChefOwn:       check('employee', 'Шеф повар', 'Повара', 'Повара'),
      seniorHookahOwn:   check('employee', 'Старший кальянный мастер', 'Кальянные мастера', 'Кальянные мастера'),
      hookahChefOwn:     check('employee', 'Шеф кальянной станции', 'Кальянные мастера', 'Кальянные мастера'),
      lineBartender:     check('employee', 'Бармен', 'Бармены', 'Бармены'),
      lineCook:          check('employee', 'Повар', 'Повара', 'Повара'),
      waiterOwn:         check('employee', 'Официант', 'Официанты', 'Официанты'),
    };
  });

  // Кто ДОЛЖЕН мочь
  for (const k of ['adminAnyDept','managerAnyDept','seniorBarOwnDept','barManagerOwn','sousChefOwn','headChefOwn','seniorHookahOwn','hookahChefOwn']) {
    expect(r[k], `${k} должен иметь право`).toBe(true);
  }
  // Кто НЕ должен
  for (const k of ['bossDenied','seniorBarOther','lineBartender','lineCook','waiterOwn']) {
    expect(r[k], `${k} НЕ должен иметь право`).toBe(false);
  }
});

// Регресс-тест: красная точка о новом сообщении горела каждый день, хотя никто
// не писал. Непрочитанным считалось всё с 2000 года, а отметка «просмотрено»
// живёт только в этом браузере — на новом устройстве вся история становилась
// непрочитанной навсегда.
test('точка о непрочитанном не горит от старых сообщений (регресс-тест)', async ({ page }) => {
  let rows = [];
  // Заглушка обязана уважать фильтр created_at=gt.<дата>, иначе тест ничего не проверяет:
  // отбор по дате делает сервер, и именно его вычисляет исправленный код.
  await page.route('**/rest/v1/team_chat**', (route) => {
    const url = new URL(route.request().url());
    const gt = (url.searchParams.get('created_at') || '').replace(/^gt\./, '');
    const out = gt ? rows.filter((r) => r.created_at > gt) : rows;
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(out) });
  });

  await page.goto('/');
  await page.waitForFunction(() => typeof window.checkUnreadMessages === 'function');

  const setup = async () => page.evaluate(() => {
    localStorage.clear();
    eval(`
      currentUser = { id: 'u1', email: 't@slon.uz' };
      currentProfile = { role: 'admin', name: 'Тест' };
      hasUnreadChat = false;
    `);
  });

  // 1. Сообщение десятидневной давности — точки быть не должно
  rows = [{ id: 1, created_at: new Date(Date.now() - 10 * 864e5).toISOString(), channel: 'Официанты' }];
  await setup();
  await page.evaluate(() => window.checkUnreadMessages());
  const onOld = await page.evaluate(() => eval('hasUnreadChat'));

  // 2. Сообщение часовой давности на чистом устройстве — тоже нет: до первого
  //    запуска всё считается прочитанным, иначе точка загорится «из ниоткуда»
  rows = [{ id: 2, created_at: new Date(Date.now() - 3600e3).toISOString(), channel: 'Официанты' }];
  await setup();
  await page.evaluate(() => window.checkUnreadMessages());
  const onFirstRun = await page.evaluate(() => eval('hasUnreadChat'));

  // 3. Сообщение, пришедшее ПОСЛЕ того, как чат уже смотрели — точка нужна
  await page.evaluate(() => {
    localStorage.setItem('slon-lastseen-u1', new Date(Date.now() - 2 * 3600e3).toISOString());
  });
  await page.evaluate(() => window.checkUnreadMessages());
  const onFresh = await page.evaluate(() => eval('hasUnreadChat'));

  expect(onOld, 'сообщение 10-дневной давности не должно зажигать точку').toBe(false);
  expect(onFirstRun, 'на новом устройстве история не должна считаться непрочитанной').toBe(false);
  expect(onFresh, 'новое сообщение после просмотра должно зажигать точку').toBe(true);
});

// Регресс-тест: кнопки периода рисовались только «Обзором», поэтому на вкладке
// «Чек-листы» подсветка застревала — данные уже за «сегодня», а горит «месяц».
test('переключатель периода подсвечивается и вне «Обзора» (регресс-тест)', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '[]' }));

  await page.goto('/');
  await page.waitForFunction(() => typeof window.setDashPeriod === 'function');

  const active = () => page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('#dash-period-switcher button'));
    const lit = btns.filter((b) => b.style.background.includes('gold-dark')).map((b) => b.textContent.trim());
    return { count: btns.length, lit };
  });

  // Стоим на «Чек-листах» с периодом «месяц»
  await page.evaluate(() => {
    eval(`
      currentProfile = { role: 'admin', name: 'Тест' };
      currentFilial = 'chekhov';
      dashPeriod = 'month';
      dashTab = 'checklists';
    `);
    window.renderDashPeriods();
  });
  const before = await active();

  // Переключаем период, НЕ уходя с вкладки
  await page.evaluate(async () => { await window.setDashPeriod('today'); });
  const after = await active();

  expect(before.lit, 'сначала должен гореть «Месяц»').toEqual(['Месяц']);
  expect(after.lit, 'после переключения должен гореть «Сегодня», а не «Месяц»').toEqual(['Сегодня']);
});

// В сообщение чата можно вложить несколько фото (media = массив). Старые
// сообщения хранят одно вложение в media_url — они обязаны показываться так же.
test('в пузыре чата видно все вложения, и старые сообщения не ломаются', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.chatBubbleHTML === 'function');

  const r = await page.evaluate(() => {
    const count = (html) => ({
      img: (html.match(/<img /g) || []).length,
      video: (html.match(/<video /g) || []).length,
    });
    const base = { id: 1, created_at: new Date().toISOString(), user_name: 'Тест', text: 'привет' };
    return {
      three: count(window.chatBubbleHTML({ ...base, media: [
        { url: 'https://x/1.jpg', type: 'image' },
        { url: 'https://x/2.jpg', type: 'image' },
        { url: 'https://x/3.mp4', type: 'video' },
      ] }, false, false)),
      one: count(window.chatBubbleHTML({ ...base, media: [{ url: 'https://x/1.jpg', type: 'image' }] }, false, false)),
      legacy: count(window.chatBubbleHTML({ ...base, media_url: 'https://x/old.jpg', media_type: 'image' }, false, false)),
      legacyVideo: count(window.chatBubbleHTML({ ...base, media_url: 'https://x/old.mp4', media_type: 'video' }, false, false)),
      noMedia: count(window.chatBubbleHTML(base, false, false)),
      // текст обязан уцелеть рядом с вложениями
      keepsText: window.chatBubbleHTML({ ...base, media: [
        { url: 'https://x/1.jpg', type: 'image' }, { url: 'https://x/2.jpg', type: 'image' },
      ] }, false, false).includes('привет'),
    };
  });

  expect(r.three, 'три вложения — три элемента, видео отдельно от картинок').toEqual({ img: 2, video: 1 });
  expect(r.one, 'одно вложение показывается как раньше').toEqual({ img: 1, video: 0 });
  expect(r.legacy, 'старое сообщение с media_url должно показываться').toEqual({ img: 1, video: 0 });
  expect(r.legacyVideo, 'старое видео тоже').toEqual({ img: 0, video: 1 });
  expect(r.noMedia, 'без вложений — ничего лишнего').toEqual({ img: 0, video: 0 });
  expect(r.keepsText, 'текст сообщения не должен теряться').toBe(true);
});

// База знаний: управляющий должен править только те книги, которые ему отдали
// (регламент по оборудованию), и не трогать Food Book / Bar Book — на них
// отвечает Помощник. То же правило продублировано в RLS.
test('база знаний: кто может править статьи и заводить книги', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kbCanEdit === 'function');

  const r = await page.evaluate(() => {
    const asRole = (role) => { eval(`currentProfile = { role: ${JSON.stringify(role)} }`); };
    const admin = { edit_role: 'admin' };
    const shared = { edit_role: 'manager' };
    const out = {};
    asRole('admin');
    out.adminAnyBook = window.kbCanEdit(admin);
    out.adminSharedBook = window.kbCanEdit(shared);
    out.adminMakesBooks = window.kbCanEditBooks();
    asRole('manager');
    out.managerAdminBook = window.kbCanEdit(admin);
    out.managerSharedBook = window.kbCanEdit(shared);
    out.managerMakesBooks = window.kbCanEditBooks();
    asRole('employee');
    out.employeeSharedBook = window.kbCanEdit(shared);
    asRole('boss');
    out.bossSharedBook = window.kbCanEdit(shared);
    return out;
  });

  for (const k of ['adminAnyBook', 'adminSharedBook', 'adminMakesBooks', 'managerSharedBook']) {
    expect(r[k], `${k} должен иметь право`).toBe(true);
  }
  for (const k of ['managerAdminBook', 'managerMakesBooks', 'employeeSharedBook', 'bossSharedBook']) {
    expect(r[k], `${k} НЕ должен иметь право`).toBe(false);
  }
});

// Инвентаризация посуды. Главное правило — слепой пересчёт: пока идёт
// инвентаризация, официант не должен нигде увидеть учётный остаток, иначе он
// перепишет цифру из системы вместо того, чтобы считать.
test('инвентаризация: официант считает вслепую, руководство видит остаток', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.renderDishwareInvActive === 'function');

  const res = await page.evaluate(() => {
    // Остаток намеренно приметный: ищем это число в разметке
    const items = [
      { id: 1, name: 'Рокс',    category: 'Бар', qty: 98765, cost: 20000 },
      { id: 2, name: 'Чайник',  category: 'Бар', qty: 47,    cost: 30000 },
      { id: 3, name: 'Вилка',   category: 'Зал', qty: 124,   cost: 5000 },
    ];
    const out = {};
    const asRole = role => { currentProfile = { role, name: 'Тест', employee_id: 1 }; };

    dishwareStock = items;
    dishwareInv = { id: 10, date: '2026-08-08', filial: 'istikbol', status: 'open', started_by_name: 'Управляющий' };
    dishwareCounts = { 2: { item_id: 2, qty: 45, user_name: 'Азиз', updated_at: new Date().toISOString() } };
    dishwareInvZone = '';
    dishwareInvSearch = '';

    // --- официант на вкладке инвентаризации
    asRole('employee');
    renderDishwareInvActive();
    const invHtml = document.getElementById('dishware-content').innerHTML;
    out.invShowsStock = invHtml.includes('98765');
    out.invInputs = document.querySelectorAll('#dinv-list input[type=number]').length;
    out.invCountedValue = document.getElementById('dinv-qty-2').value;
    out.progress = document.getElementById('dinv-progress').textContent;
    out.hasApplyBtn = /openDishwareDiff/.test(invHtml);

    // --- официант на вкладке остатков: остаток тоже скрыт
    document.getElementById('dishware-content').innerHTML = '<div id="dishware-list"></div>';
    renderDishwareStock();
    out.stockShowsQtyWaiter = document.getElementById('dishware-list').innerHTML.includes('98765');

    // --- руководство остаток видит, и у него есть утверждение
    asRole('admin');
    document.getElementById('dishware-content').innerHTML = '<div id="dishware-list"></div>';
    renderDishwareStock();
    out.stockShowsQtyAdmin = document.getElementById('dishware-list').innerHTML.includes('98765');
    renderDishwareInvActive();
    out.adminHasApplyBtn = /openDishwareDiff/.test(document.getElementById('dishware-content').innerHTML);

    // --- фильтр по зоне отсекает чужие позиции
    dishwareInvZone = 'Зал';
    renderDishwareInvActive();
    out.hallRows = document.querySelectorAll('#dinv-list input[type=number]').length;

    // --- прогресс считается по внесённым пересчётам
    dishwareInvZone = '';
    out.prog = dishwareInvProgress();
    return out;
  });

  expect(res.invShowsStock, 'учётный остаток не должен попадать на экран пересчёта').toBe(false);
  expect(res.stockShowsQtyWaiter, 'на вкладке остатков официант тоже не видит число').toBe(false);
  expect(res.stockShowsQtyAdmin, 'руководству остаток виден').toBe(true);
  expect(res.invInputs).toBe(3);
  expect(res.invCountedValue, 'уже посчитанное подставляется в поле').toBe('45');
  expect(res.progress).toContain('1');
  expect(res.hasApplyBtn, 'официант не утверждает инвентаризацию').toBe(false);
  expect(res.adminHasApplyBtn, 'руководство утверждает').toBe(true);
  expect(res.hallRows, 'в зоне «Зал» одна позиция').toBe(1);
  expect(res.prog).toEqual({ done: 1, total: 3, pct: 33 });
});

// Регресс-тест на жалобу «сотрудник подошёл спросить, где отметить приход».
// Карточка со сменой и кнопкой отметки должна стоять выше всех прочих
// карточек главного экрана и попадать в первый экран телефона без прокрутки.
test('кнопка отметки прихода видна сразу, без прокрутки', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.renderShiftAndAttendance === 'function');

  const res = await page.evaluate(() => {
    const login = document.getElementById('login-page');
    if (login) login.style.display = 'none';
    document.getElementById('app-page').style.display = '';
    currentProfile = { role: 'employee', name: 'Тест', employee_id: 1 };
    const shift = { shift_start: '12:00', shift_end: '03:00', filial: 'istikbol', is_day_off: false };

    // Прочие карточки главной заполнены — как в обычный рабочий день
    for (const id of ['home-stoplist-card', 'home-announcements', 'install-app-card']) {
      document.getElementById(id).innerHTML = '<div class="card" style="height:90px;margin-bottom:12px"></div>';
    }

    const out = {};
    renderShiftAndAttendance(shift, null);
    const att = document.getElementById('home-attendance-card');
    const btn = att.querySelector('button');
    out.hasButton = !!btn && /startCheckIn/.test(btn.getAttribute('onclick') || '');
    out.buttonBottom = btn ? btn.getBoundingClientRect().bottom : 99999;

    // Порядок в разметке: отметка выше стоп-листа, объявлений и установки
    const pos = id => [...document.querySelectorAll('#screen-home .content > div')].indexOf(document.getElementById(id));
    out.attPos = pos('home-attendance-card');
    out.othersPos = ['home-stoplist-card', 'home-announcements', 'install-app-card'].map(pos);

    // Уже отметился — кнопки съёмки нет, есть время прихода
    renderShiftAndAttendance(shift, { id: 7, check_in_time: '11:58', is_late: false, checkin_video: 'x' });
    out.afterText = document.getElementById('home-attendance-card').textContent;
    out.afterHasRecordBtn = /startCheckIn/.test(document.getElementById('home-attendance-card').innerHTML);

    // Выходной — отмечаться нечего
    renderShiftAndAttendance({ is_day_off: true }, null);
    out.dayOffAtt = document.getElementById('home-attendance-card').innerHTML;
    out.dayOffShift = document.getElementById('home-shift-card').innerHTML;
    return out;
  });

  expect(res.hasButton, 'на карточке смены есть кнопка отметки').toBe(true);
  // 780 — высота экрана недорогого телефона; кнопка должна помещаться целиком
  expect(res.buttonBottom, 'кнопка попадает в первый экран').toBeLessThan(780);
  for (const p of res.othersPos) expect(res.attPos).toBeLessThan(p);
  expect(res.afterText).toContain('11:58');
  expect(res.afterHasRecordBtn, 'повторно отметиться нельзя').toBe(false);
  expect(res.dayOffAtt, 'в выходной отметки нет').toBe('');
  expect(res.dayOffShift.length, 'в выходной видно, что он выходной').toBeGreaterThan(0);
});

// Официант открывает приложение в начале смены, чтобы узнать свои столы.
// Карточка позиции должна показать и свои столы, и кто стоит на остальных.
test('официант видит свою позицию и столы на главном экране', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/waiter_position_assignments**', (route) => {
    const url = route.request().url();
    // свой запрос идёт с employee_id=eq.1, чужие — с neq.1
    const body = url.includes('employee_id=eq.1')
      ? [{ position_ids: [2], employee_name: 'Тест', split_from: '18:00:00' }]
      : [{ employee_name: 'Соснин Владислав Николаевич', position_ids: [1] },
         { employee_name: 'Атаханов Агабек Пайзуллаевич', position_ids: [3] }];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/rest/v1/waiter_positions**', (route) => {
    const url = route.request().url();
    const all = [{ id: 1, name: 'Позиция 1', tables_list: '1, 2, 3, 4, 15', sort: 1 },
                 { id: 2, name: 'Позиция 2', tables_list: '5, 6, 7, 8, 9, 10, 11', sort: 2 },
                 { id: 3, name: 'Позиция 3', tables_list: '12, 13, 14, 16, 17', sort: 3 }];
    const ids = (url.match(/id=in\.%28([^)]*)%29/) || [])[1];
    const body = ids ? all.filter(p => ids.split('%2C').includes(String(p.id))) : all;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/');
  await page.waitForFunction(() => typeof window.loadPositionCard === 'function');

  const res = await page.evaluate(async () => {
    document.getElementById('app-page').style.display = '';
    currentProfile = { role: 'employee', name: 'Тест', employee_id: 1 };
    await loadPositionCard({ shift_start: '11:00', is_day_off: false });
    const card = document.getElementById('home-position-card');
    const out = { text: card.textContent };
    // Кто выходит последним — тот и есть «полный состав», оговорка ему не нужна
    await loadPositionCard({ shift_start: '18:00', is_day_off: false });
    out.lastShiftText = document.getElementById('home-position-card').textContent;
    // В выходной делить нечего — карточки быть не должно
    await loadPositionCard({ is_day_off: true });
    out.dayOff = document.getElementById('home-position-card').innerHTML;
    return out;
  });

  expect(res.text, 'видно свою позицию').toContain('Позиция 2');
  expect(res.text, 'видно свои столы').toContain('5, 6, 7, 8, 9, 10, 11');
  expect(res.text, 'видно, кто на соседней позиции').toContain('Соснин Владислав');
  expect(res.text, 'отчество в списке не показываем').not.toContain('Николаевич');
  expect(res.text, 'предупреждаем, что до 18:00 зал общий').toContain('18:00');
  expect(res.lastShiftText, 'вышедшему последним оговорка не нужна').not.toContain('зал общий');
  expect(res.dayOff, 'в выходной позиции нет').toBe('');
});

// Вкладка «Позиции в зале» нужна, когда официант говорит «мне вечно достаётся
// слабая». Главная цифра — вес на смену, а не количество смен: позиции
// неравноценны. Плюс отдельно видно повторы подряд и ручные правки.
test('дашборд показывает перекос по позициям и повторы подряд', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/waiter_positions**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ id: 1, name: 'Позиция 1', weight: 2, sort: 1 },
                          { id: 2, name: 'Позиция 2', weight: 3, sort: 2 },
                          { id: 3, name: 'Позиция 3', weight: 1, sort: 3 }]),
  }));
  await page.route('**/rest/v1/waiter_position_assignments**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([
      // Счастливчик: две смены подряд на топовой — и перекос, и повтор
      { date: '2026-08-10', employee_id: 1, employee_name: 'Счастливчик Тест', position_ids: [2], weight: 3, source: 'auto' },
      { date: '2026-08-11', employee_id: 1, employee_name: 'Счастливчик Тест', position_ids: [2], weight: 3, source: 'manual' },
      // Обделённый: две смены на слабой
      { date: '2026-08-10', employee_id: 2, employee_name: 'Обделённый Тест', position_ids: [3], weight: 1, source: 'auto' },
      { date: '2026-08-11', employee_id: 2, employee_name: 'Обделённый Тест', position_ids: [1], weight: 2, source: 'auto' },
    ]),
  }));

  await page.goto('/');
  await page.waitForFunction(() => typeof window.loadDashPositions === 'function');

  const res = await page.evaluate(async () => {
    document.getElementById('app-page').style.display = '';
    currentProfile = { role: 'admin', name: 'Тест' };
    await loadDashPositions();
    return document.getElementById('dashboard-content').textContent;
  });

  expect(res, 'видно обоих официантов').toContain('Счастливчик');
  expect(res, 'вес на смену у счастливчика 3,0').toContain('3,0');
  expect(res, 'вес на смену у обделённого 1,5').toContain('1,5');
  expect(res, 'перекос посчитан: 3,0 − 1,5').toContain('1,5');
  expect(res, 'повтор подряд найден').toContain('Одна позиция две смены подряд');
  expect(res, 'ручная правка отмечена').toContain('Расставлено вручную');
});

// Регресс-тест на жалобу «сотрудники не могут отметить приход» (12.08.2026).
// На сборках APK до 07.08 в манифесте не было разрешения на камеру: getUserMedia
// падал всегда, съёмка уходила в системную камеру, Android выгружал приложение
// из памяти — и приход не записывался НИ РАЗУ за смену, потому что раньше код
// без видео вообще ничего не писал. Теперь приход уходит в базу до камеры.
test('приход записывается, даже если камера не работает (регресс-тест)', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/functions/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/rest/v1/schedules**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ id: 1, employee_id: 1, shift_start: '12:00', shift_end: '23:00', filial: 'chekhov', is_day_off: false }]),
  }));

  const record = { id: 55, employee_id: 1, check_in_time: '12:03', is_late: false, late_minutes: 0, penalty: 0, checkin_video: null };
  const posted = [];
  await page.route('**/rest/v1/attendance**', (route) => {
    const req = route.request();
    if (req.method() !== 'POST') {
      // до отметки записи нет, после — она приезжает вместе с главным экраном
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(posted.length ? [record] : []) });
    }
    posted.push(req.postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(record) });
  });

  await page.goto('/');
  await page.waitForFunction(() => typeof window.startCheckIn === 'function');

  const res = await page.evaluate(async () => {
    const login = document.getElementById('login-page');
    if (login) login.style.display = 'none';
    document.getElementById('app-page').style.display = '';
    currentProfile = { role: 'employee', name: 'Тест', employee_id: 1 };
    currentUser = { id: '00000000-0000-0000-0000-000000000001', email: 'x@slon.uz' };

    // Телефон со старой оболочкой: снимать в приложении не даёт
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('NotAllowedError'));
    // Системная камера в тесте открыться не может — считаем, что человек её закрыл
    let fallbackOpened = false;
    document.getElementById('checkin-video-file').click = () => { fallbackOpened = true; };

    await startCheckIn();
    const att = document.getElementById('home-attendance-card');
    return {
      fallbackOpened,
      cardText: att.textContent,
      hasResendBtn: /startResendVideo/.test(att.innerHTML),
      hasRecordBtn: /startCheckIn/.test(att.innerHTML),
    };
  });

  expect(posted.length, 'приход записан, хотя камера не открылась').toBe(1);
  expect(posted[0].employee_id).toBe(1);
  expect(res.fallbackOpened, 'запасная камера всё же предложена').toBe(true);
  expect(res.cardText, 'на карточке видно время прихода').toContain('12:03');
  expect(res.hasResendBtn, 'есть кнопка «дослать видео»').toBe(true);
  expect(res.hasRecordBtn, 'второй раз отмечаться не предлагают').toBe(false);
});

// Точка непрочитанных сообщений опрашивала чат раз в 15 секунд и на каждый тик
// заново спрашивала у базы цех сотрудника — тот самый, что уже лежит в
// currentEmployee с момента входа. В логах это видно как ровный ряд запросов
// employees?select=department каждые 15 секунд с телефона сотрудника; за смену
// набегали тысячи. Цех берём из карточки, а свёрнутое приложение не опрашиваем.
test('опрос непрочитанных не ходит за цехом и молчит в фоне', async ({ page }) => {
  const deptCalls = [];
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/employees**', (route) => {
    deptCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/');
  await page.waitForFunction(() => typeof window.checkUnreadMessages === 'function');

  const res = await page.evaluate(async () => {
    currentUser = { id: '00000000-0000-0000-0000-000000000001', email: 'x@slon.uz' };
    currentProfile = { role: 'employee', name: 'Тест', employee_id: 72 };
    currentEmployee = { id: 72, name: 'Тест', role: 'Бармен', department: 'Бармены', salary: null };

    await checkUnreadMessages();
    const pollingWhileVisible = unreadPollInterval !== null;

    // Сворачиваем приложение
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const pollingWhileHidden = unreadPollInterval !== null;

    // и возвращаемся обратно
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return { pollingWhileVisible, pollingWhileHidden, pollingAfterReturn: unreadPollInterval !== null };
  });

  expect(deptCalls, 'цех берётся из карточки, а не из базы').toEqual([]);
  expect(res.pollingWhileVisible, 'на экране опрос идёт').toBe(true);
  expect(res.pollingWhileHidden, 'в фоне опрос остановлен').toBe(false);
  expect(res.pollingAfterReturn, 'при возврате опрос возобновляется').toBe(true);
});

// Заявки на замену и об опоздании: кто вправе вынести решение. Список тот же,
// что правит график, плюс два исключения — владелец только смотрит, а свою
// заявку старший цеха не утверждает сам, она уходит наверх.
test('заявки: кто может одобрять, а кто нет', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.canDecideRequest === 'function');

  const r = await page.evaluate(() => {
    const check = (role, empRole, empDept, req) => {
      currentProfile = { role, employee_id: 1 };
      currentEmployee = empRole ? { id: 1, role: empRole, department: empDept } : null;
      return window.canDecideRequest(Object.assign({ status: 'pending', employee_id: 2 }, req));
    };
    return {
      adminAnyDept:     check('admin', null, null, { department: 'Бармены' }),
      managerAnyDept:   check('manager', null, null, { department: 'Официанты' }),
      bossDenied:       check('boss', null, null, { department: 'Бармены' }),
      seniorOwnDept:    check('employee', 'Старший бармен', 'Бармены', { department: 'Бармены' }),
      seniorOtherDept:  check('employee', 'Старший бармен', 'Бармены', { department: 'Повара' }),
      seniorOwnRequest: check('employee', 'Старший бармен', 'Бармены', { department: 'Бармены', employee_id: 1 }),
      adminOwnRequest:  check('admin', null, null, { department: 'Бармены', employee_id: 1 }),
      lineWaiter:       check('employee', 'Официант', 'Официанты', { department: 'Официанты' }),
      alreadyDecided:   check('admin', null, null, { department: 'Бармены', status: 'approved' }),
    };
  });

  for (const k of ['adminAnyDept','managerAnyDept','seniorOwnDept','adminOwnRequest']) {
    expect(r[k], `${k} должен мочь решать`).toBe(true);
  }
  for (const k of ['bossDenied','seniorOtherDept','seniorOwnRequest','lineWaiter','alreadyDecided']) {
    expect(r[k], `${k} НЕ должен мочь решать`).toBe(false);
  }
});

// Запуск Истикбола (16.08.2026). До него весь состав, кроме управляющих, был
// приколочен к пилотному Чехову. Теперь филиал берётся из карточки сотрудника:
// человек видит тот, где работает, и не может отметиться в чужом.
test('филиал берётся из карточки сотрудника', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.myFilials === 'function');

  const r = await page.evaluate(() => {
    const setup = (role, filials) => {
      currentProfile = { role, employee_id: filials ? 1 : null };
      currentEmployee = filials ? { id: 1, role: 'Официант', department: 'Официанты', filials } : null;
    };
    const ids = () => myFilials().map(f => f.id);
    const out = {};

    setup('admin', null);            out.admin = ids();
    setup('boss', null);             out.boss = ids();
    setup('employee', ['chekhov']);  out.chekhovOnly = ids();
    setup('employee', ['istikbol']); out.istikbolOnly = ids();
    setup('employee', ['istikbol','chekhov']); out.both = ids();
    setup('employee', []);           out.noCard = ids();

    // Переключатель: одному филиалу переключать нечего
    setup('employee', ['istikbol']);
    renderFilialSwitcher();
    out.switcherHiddenForOne = document.getElementById('filial-switcher').style.display === 'none';
    setup('employee', ['istikbol','chekhov']);
    renderFilialSwitcher();
    out.switcherShownForTwo = document.getElementById('filial-switcher').style.display !== 'none';

    // Чужой филиал не открывается даже прямым вызовом
    setup('employee', ['istikbol']);
    currentFilial = 'istikbol';
    switchFilial('chekhov');
    out.afterForeignSwitch = currentFilial;

    // Застрявший с пилота чужой филиал чинится при входе
    setup('employee', ['istikbol']);
    currentFilial = 'chekhov';
    showApp();
    out.afterShowApp = currentFilial;
    return out;
  });

  expect(r.admin, 'управляющий видит оба').toEqual(['istikbol','chekhov']);
  expect(r.boss, 'владелец видит оба').toEqual(['istikbol','chekhov']);
  expect(r.chekhovOnly, 'сотрудник Чехова — только Чехов').toEqual(['chekhov']);
  expect(r.istikbolOnly, 'сотрудник Истикбола — только Истикбол').toEqual(['istikbol']);
  expect(r.both, 'кто работает в обоих — видит оба').toEqual(['istikbol','chekhov']);
  expect(r.noCard, 'аккаунт без карточки не остаётся без филиала').toEqual(['istikbol','chekhov']);
  expect(r.switcherHiddenForOne, 'при одном филиале переключателя нет').toBe(true);
  expect(r.switcherShownForTwo, 'при двух переключатель есть').toBe(true);
  expect(r.afterForeignSwitch, 'в чужой филиал не пускает').toBe('istikbol');
  expect(r.afterShowApp, 'чужой филиал из памяти исправляется на свой').toBe('istikbol');
});

// Жалоба «фото в чек-листах грузятся вечно» (14.08.2026). Файлы отправлялись
// по очереди: три снимка = три ожидания подряд на мобильном интернете. Сжатие
// оставляем последовательным (декодирование снимка съедает память), а отправку
// пускаем разом — узкое место именно сеть.
test('фото чек-листа отправляются разом, а не по очереди', async ({ page }) => {
  let inFlight = 0, peak = 0;
  const uploaded = [];

  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  let savedLog = null;
  await page.route('**/rest/v1/checklist_logs**', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH' || req.method() === 'POST') savedLog = req.postDataJSON();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 5, items_done: [], items_by: {}, media: [] }),
    });
  });
  await page.route('**/storage/v1/object/**', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    uploaded.push(route.request().url());
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 250));   // изображаем медленную связь
    inFlight--;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"ok"}' });
  });

  await page.goto('/');
  await page.waitForFunction(() => typeof window.uploadChecklistMedia === 'function');

  await page.evaluate(async () => {
    currentUser = { id: '00000000-0000-0000-0000-000000000001', email: 'x@slon.uz' };
    currentProfile = { role: 'employee', name: 'Тест', employee_id: 1 };

    const mkFile = async (name) => {
      const c = document.createElement('canvas');
      c.width = 900; c.height = 600;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#8a6a2f'; ctx.fillRect(0, 0, 900, 600);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      return new File([blob], name, { type: 'image/jpeg' });
    };

    document.getElementById('cl-media-template-id').value = '7';
    clMediaFiles = [await mkFile('a.jpg'), await mkFile('b.jpg'), await mkFile('c.jpg')];

    await uploadChecklistMedia();
  });

  expect(uploaded.length, 'ушли все три файла').toBe(3);
  // Пик одновременных отправок — точная проверка, в отличие от секундомера:
  // 1 означал бы прежнюю очередь, 3 — что все три ждут сеть одновременно
  expect(peak, 'файлы отправляются одновременно, а не по одному').toBe(3);
  // Фото принадлежат чек-листу целиком, а не отдельному пункту
  expect(savedLog.media.length, 'все три записаны к чек-листу').toBe(3);
  expect(savedLog.items_media, 'к пунктам ничего не пишется').toBeUndefined();
});

// Фото перенесены из-под каждого пункта в один блок в конце: снимают не пункт,
// а зал, и один кадр закрывает несколько строк. Старые фото по пунктам при
// этом обязаны остаться открываемыми — по ним разбирают спорные смены.
test('фото у чек-листа общие, но старые по пунктам открываются', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.checklistMediaBlock === 'function');

  const r = await page.evaluate(() => {
    const out = {};
    // Пустой чек-лист: блок есть, зовёт добавить
    currentChecklistLog = { id: 1, items_done: [], items_by: {}, items_media: {}, media: [] };
    out.emptyBlock = checklistMediaBlock(7);

    // Есть общие фото — рисуются миниатюрами
    currentChecklistLog = { id: 1, media: [
      { url: 'https://x/1.jpg', type: 'image' },
      { url: 'https://x/2.jpg', type: 'image' },
    ] };
    out.filledBlock = checklistMediaBlock(7);

    // Старый формат: одиночный объект вместо массива тоже должен читаться
    out.legacySingle = clMediaList({ url: 'https://x/old.jpg', type: 'image' }).length;
    out.legacyEmpty = clMediaList(undefined).length;
    return out;
  });

  expect(r.emptyBlock, 'у пустого блока есть кнопка добавления').toContain('openChecklistMediaModal(7)');
  expect(r.emptyBlock, 'миниатюр нет').not.toContain('<img');
  expect(r.filledBlock, 'оба фото показаны миниатюрами').toContain('https://x/2.jpg');
  expect(r.filledBlock, 'миниатюра открывает просмотр').toContain('viewChecklistMedia(0)');
  expect(r.legacySingle, 'одиночный старый объект читается как список').toBe(1);
  expect(r.legacyEmpty, 'пусто остаётся пустым').toBe(0);

  // Кнопок «прикрепить» под пунктами больше нет ни в одном языке
  const html = await page.content();
  expect(html, 'поле пункта удалено из разметки').not.toContain('cl-media-item-id');
});

// Окно подтверждения вызывается ИЗ другого окна и обязано лежать поверх него.
// У всех окон один z-index, а порядок наложения решал порядок в документе —
// и подтверждение, объявленное выше по файлу, открывалось ЗА окном заявок:
// человек жал «Одобрить», окно не закрывалось, а сзади всплывало ещё одно.
test('подтверждение открывается поверх окна, из которого вызвано', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.confirmDialog === 'function');

  const r = await page.evaluate(() => {
    // Окна, из которых реально зовут подтверждение
    const hosts = ['modal-requests', 'modal-positions', 'modal-checklist-media'];
    const out = {};
    for (const host of hosts) {
      openModal(host);
      confirmDialog('Проверка', { title: 'Тест', okText: 'Да', danger: false });

      const confirmEl = document.getElementById('modal-confirm');
      const box = confirmEl.querySelector('.modal').getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 10);
      out[host] = {
        onTop: !!(hit && confirmEl.contains(hit)),
        confirmZ: Number(getComputedStyle(confirmEl).zIndex),
        hostZ: Number(getComputedStyle(document.getElementById(host)).zIndex),
      };
      closeModal('modal-confirm');
      closeModal(host);
    }
    return out;
  });

  for (const host of Object.keys(r)) {
    expect(r[host].onTop, `подтверждение поверх ${host}`).toBe(true);
    expect(r[host].confirmZ, `у подтверждения z-index выше, чем у ${host}`).toBeGreaterThan(r[host].hostZ);
  }
});

// В чате та же болезнь, что была в чек-листах, но лечится иначе: сюда
// прикладывают и по десятку файлов, и десяток параллельных отправок с телефона
// рвётся чаще, чем ускоряет. Поэтому по три за раз — и строго с сохранением
// порядка, потому что первое вложение дублируется в media_url для старых версий.
test('чат отправляет вложения по три и не путает порядок', async ({ page }) => {
  let inFlight = 0, peak = 0;
  const order = [];
  let posted = null;

  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/team_chat**', (route) => {
    if (route.request().method() === 'POST') posted = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/storage/v1/object/**', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const name = decodeURIComponent(route.request().url().split('/').pop());
    order.push(name);
    inFlight++; peak = Math.max(peak, inFlight);
    // Первый файл отвечает дольше остальных: если порядок собирается по
    // времени ответа, а не по индексу, он уедет с первого места
    await new Promise((r) => setTimeout(r, name.endsWith('-0.jpg') ? 400 : 100));
    inFlight--;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"ok"}' });
  });

  await page.goto('/');
  await page.waitForFunction(() => typeof window.sendTeamChat === 'function');

  await page.evaluate(async () => {
    currentUser = { id: '00000000-0000-0000-0000-000000000001', email: 'x@slon.uz' };
    currentProfile = { role: 'employee', name: 'Тест', employee_id: 1 };
    currentEmployee = { id: 1, role: 'Официант', department: 'Официанты' };

    const mkFile = async (name, shade) => {
      const c = document.createElement('canvas');
      c.width = 800; c.height = 600;
      const ctx = c.getContext('2d');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, 800, 600);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      return new File([blob], name, { type: 'image/jpeg' });
    };
    teamChatMediaFiles = [];
    for (const shade of ['#111', '#333', '#555', '#777', '#999']) {
      teamChatMediaFiles.push(await mkFile('f.jpg', shade));
    }
    document.getElementById('teamchat-input').value = 'пять фото';
    await sendTeamChat();
  });

  expect(order.length, 'ушли все пять файлов').toBe(5);
  expect(peak, 'одновременно не больше трёх').toBe(3);
  expect(peak, 'но и не по одному').toBeGreaterThan(1);
  expect(posted.media.length, 'все пять попали в сообщение').toBe(5);
  // Первый файл отвечал дольше всех — и всё равно обязан остаться первым
  expect(posted.media[0].url, 'порядок вложений сохранён').toContain('-0.jpg');
  expect(posted.media_url, 'дубль для старых версий — тоже первый файл').toBe(posted.media[0].url);
});

// Вход в список заявок должен быть всегда, а не только когда что-то висит:
// первым делом после релиза управляющий идёт смотреть, где же подтверждать, и
// при пустом списке не находил ничего.
test('в список заявок можно войти, даже когда решать нечего', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.loadRequestsCard === 'function');

  const res = await page.evaluate(async () => {
    const render = async (role, empId) => {
      currentUser = { id: '00000000-0000-0000-0000-000000000001', email: 'x@slon.uz' };
      currentProfile = { role, employee_id: empId, name: 'Тест' };
      currentEmployee = empId ? { id: empId, role: 'Официант', department: 'Официанты' } : null;
      document.getElementById('home-requests-card').innerHTML = '';
      await loadRequestsCard();
      return document.getElementById('home-requests-card').innerHTML;
    };
    return {
      adminNoEmp: await render('admin', null),   // управляющий без карточки сотрудника
      waiter:     await render('employee', 7),   // рядовой официант
    };
  });

  expect(res.adminNoEmp, 'управляющий видит вход в список').toContain('openRequestsInbox()');
  expect(res.adminNoEmp, 'подавать заявку ему не от чьего имени').not.toContain('openSwapRequest()');
  expect(res.waiter, 'официант видит обе кнопки').toContain('openSwapRequest()');
  expect(res.waiter, 'и вход в список своих заявок').toContain('openRequestsInbox()');
});

// Заявка на замену уходит в базу целиком: без вида замены, напарника и второго
// дня одобрять её нечем — база такую и не примет (constraint shift_requests_shape).
test('заявка на замену собирается и уходит целиком', async ({ page }) => {
  const posted = [];
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/employees**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ id: 1, name: 'Я Сам' }, { id: 2, name: 'Напарник' }]),
  }));
  await page.route('**/rest/v1/schedules**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([
      { id: 10, date: '2026-08-20', shift_start: '11:00', shift_end: '23:00', filial: 'chekhov', is_day_off: false },
      { id: 11, date: '2026-08-22', shift_start: '15:00', shift_end: '23:00', filial: 'chekhov', is_day_off: false },
    ]),
  }));
  await page.route('**/rest/v1/shift_requests**', (route) => {
    const req = route.request();
    if (req.method() === 'POST') posted.push(req.postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/');
  await page.waitForFunction(() => typeof window.openSwapRequest === 'function');

  const shown = await page.evaluate(async () => {
    currentUser = { id: '00000000-0000-0000-0000-000000000001', email: 'x@slon.uz' };
    currentProfile = { role: 'employee', name: 'Я Сам', employee_id: 1 };
    currentEmployee = { id: 1, name: 'Я Сам', role: 'Официант', department: 'Официанты' };

    await openSwapRequest();
    // По умолчанию предлагается обмен днями — второй день обязателен
    const exchangeVisible = document.getElementById('swap-partner-date-group').style.display !== 'none';
    await submitSwapRequest();

    // Подмена вторым днём не интересуется
    await openSwapRequest();
    await setSwapKind('cover');
    const coverHidden = document.getElementById('swap-partner-date-group').style.display === 'none';
    await submitSwapRequest();
    return { exchangeVisible, coverHidden };
  });

  expect(shown.exchangeVisible, 'у обмена спрашивают второй день').toBe(true);
  expect(shown.coverHidden, 'у подмены второго дня нет').toBe(true);
  expect(posted.length, 'обе заявки ушли').toBe(2);

  expect(posted[0], 'обмен днями').toMatchObject({
    kind: 'swap', swap_kind: 'exchange', employee_id: 1, partner_id: 2,
    date: '2026-08-20', partner_date: '2026-08-20', department: 'Официанты',
  });
  expect(posted[1], 'подмена').toMatchObject({
    kind: 'swap', swap_kind: 'cover', employee_id: 1, partner_id: 2, date: '2026-08-20',
  });
  expect(posted[1].partner_date, 'у подмены второго дня быть не должно').toBeFalsy();
});

