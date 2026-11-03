// Касса в дашборде (03.11.2026): выручка за период, гости, средний чек и ФОТ
// для управляющих и владельца; менеджер кассу вносит с главного экрана.
const { test, expect } = require('@playwright/test');

const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

test('дашборд «Касса»: выручка, средний чек по дням с гостями, пропущенные дни', async ({ page }) => {
  const now = new Date();
  const d1 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2));
  const d2 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3));
  const fin = [
    { date: d1, filial: 'chekhov', amount: 10000000, breakdown: { guests: 100 } },
    { date: d2, filial: 'chekhov', amount: 6000000, breakdown: { guests: null } },   // гости не указаны — в средний чек не идёт
  ];
  await page.route('**/rest/v1/**', (route) => {
    const u = decodeURIComponent(route.request().url());
    if (u.includes('/finances') && u.includes(`gte.${ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))}`)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fin) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.loadDashMoney === 'function');

  const html = await page.evaluate(async () => {
    currentUser = { id: 'u1' };
    currentProfile = { role: 'admin', name: 'Тест' };
    currentFilial = 'chekhov';
    window.myFilials = () => [{ id: 'chekhov', name: 'Чехов' }];
    dashPeriod = 'week';
    document.getElementById('screen-dashboard').classList.add('active');
    await loadDashMoney();
    return document.getElementById('dashboard-content').textContent.replace(/\s+/g, ' ');
  });
  expect(html).toContain('16 000 000');          // касса за неделю
  expect(html).toContain('100 000');             // средний чек: 10 млн ÷ 100, день без гостей не занижает
  expect(html).toContain('Касса не внесена');    // остальные дни недели пустые
  expect(html).toContain('гости не указаны');
});

test('касса без гостей не сохраняется, карточка на главной только у менеджера и управляющего', async ({ page }) => {
  let posted = null;
  await page.route('**/rest/v1/**', (route) => {
    if (route.request().url().includes('/finances') && route.request().method() === 'POST') posted = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.renderKassaCard === 'function');

  const r = await page.evaluate(async () => {
    currentUser = { id: 'u1' };
    currentFilial = 'chekhov';
    currentProfile = { role: 'employee', name: 'Тест' };
    await renderKassaCard();
    const employee = document.getElementById('home-kassa-card').textContent.trim();
    currentProfile = { role: 'manager', name: 'Тест' };
    await renderKassaCard();
    const manager = document.getElementById('home-kassa-card').textContent;

    await openKassaModal();
    document.getElementById('kassa-amount').value = '5000000';
    await saveKassa();
    const savedWithoutGuests = !!document.getElementById('modal-kassa').classList.contains('open');
    document.getElementById('kassa-guests').value = '50';
    await saveKassa();
    return { employee, manager, savedWithoutGuests };
  });
  expect(r.employee, 'сотруднику карточка не положена').toBe('');
  expect(r.manager).toContain('Внести кассу');
  expect(r.savedWithoutGuests, 'без гостей окно не закрылось').toBe(true);
  expect(posted, 'с гостями касса ушла в базу').not.toBe(null);
  expect(posted.breakdown.guests).toBe(50);
});
