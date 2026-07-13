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
    'loadDishware', 'loadDirectory', 'loadHelp', 'loadMyNotes', 'loadDashboard',
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
