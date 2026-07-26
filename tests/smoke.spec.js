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

test('service worker регистрируется и кеширует оболочку', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  const result = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { supported: true, registered: false };
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    let cachedCount = 0;
    if (keys.length) {
      const cache = await caches.open(keys[0]);
      cachedCount = (await cache.keys()).length;
    }
    return { supported: true, registered: !!reg.active, cachedCount };
  });
  expect(result.registered).toBe(true);
  expect(result.cachedCount).toBeGreaterThan(20);
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
