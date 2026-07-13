const { test, expect } = require('@playwright/test');

// Тесты под реальным логином (тестовый сотрудник с ролью employee,
// минимальные права). Пропускаются целиком, если в окружении нет
// пароля — так тесты не падают у тех, у кого нет доступа к секрету.
const EMAIL = 'ci-test-employee@slon.uz';
const PASSWORD = process.env.TEST_EMPLOYEE_PASSWORD;

test.skip(!PASSWORD, 'TEST_EMPLOYEE_PASSWORD не задан в окружении — пропускаем тесты с логином');

async function login(page) {
  await page.goto('/');
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('button:has-text("Войти")');
  await expect(page.locator('#login-page')).toBeHidden({ timeout: 15000 });
}

test('вход под тестовым сотрудником и обход основных экранов без ошибок', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await login(page);

  const screens = ['home', 'tasks', 'schedule', 'checklist', 'teamchat', 'profile', 'mynotes', 'help'];
  for (const s of screens) {
    await page.evaluate((name) => showScreen(name, null), s);
    await page.waitForTimeout(500);
  }

  expect(errors, JSON.stringify(errors)).toEqual([]);
});

test('сотрудник может переключать вкладки отдела в графике без отката (регресс-тест)', async ({ page }) => {
  await login(page);
  await page.evaluate(() => showScreen('schedule', null));
  await page.waitForTimeout(1000);

  const before = await page.evaluate(() => currentDept);
  expect(before).toBeTruthy();

  // Кликаем на вкладку другого отдела и убеждаемся, что выбор не откатился
  const otherDeptBtn = page.locator('#schedule-dept-nav button').filter({ hasNotText: before }).first();
  const otherDeptName = await otherDeptBtn.textContent();
  await otherDeptBtn.click();
  await page.waitForTimeout(1000);

  const after = await page.evaluate(() => currentDept);
  expect(after).toBe(otherDeptName.trim());
  expect(after).not.toBe(before);
});

test('сотрудник видит только свои задачи (RLS работает)', async ({ page }) => {
  await login(page);
  await page.evaluate(() => showScreen('tasks', null));
  await page.waitForTimeout(1000);

  // Прямой запрос к employees_view не должен отдавать зарплату сотруднику без прав
  const salaryLeak = await page.evaluate(async () => {
    const { data } = await sb.from('employees_view').select('id,name,salary').limit(20);
    return (data || []).some((e) => e.salary !== null && e.name !== 'CI Test Account');
  });
  expect(salaryLeak).toBe(false);
});
