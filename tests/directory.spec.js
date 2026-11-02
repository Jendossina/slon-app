// Справочник → «Оборудование» (02.11.2026): оборудование своего филиала,
// по зонам и с фото; новое заводится на текущий филиал.
const { test, expect } = require('@playwright/test');

const ROWS = [
  { id: 1, category: 'equipment', title: 'Гриль', field1: '1 шт', field2: 'Кухня', filial: 'chekhov', photo_url: 'https://slon-app.vercel.app/img/catalog/eq-118.jpg' },
  { id: 2, category: 'equipment', title: 'Таймер', field1: '3 шт', field2: 'Кухня', filial: 'chekhov', photo_url: null },
];

test('оборудование: список своего филиала с фото, новое — на текущий филиал', async ({ page }) => {
  let listUrl = null;
  let inserted = null;
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/directory_entries')) {
      if (req.method() === 'GET') { listUrl = decodeURIComponent(req.url()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }); }
      if (req.method() === 'POST') inserted = JSON.parse(req.postData() || '{}');
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/img/catalog/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: '' }));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.loadDirectory === 'function');

  await page.evaluate(async () => {
    currentUser = { id: 'u1' };
    currentProfile = { name: 'Тест', employee_id: 1, role: 'admin' };
    currentFilial = 'chekhov';
    document.getElementById('screen-directory').classList.add('active');
    switchDirCat('equipment');
  });
  await expect(page.locator('#directory-content')).toContainText('Гриль');

  expect(listUrl, 'запрос не фильтрует по филиалу').toContain('filial.eq.chekhov');
  await expect(page.locator('#directory-content img')).toHaveCount(1);          // у таймера фото нет — значок
  await expect(page.locator('#directory-content')).toContainText('Кухня · 2');
  await expect(page.locator('#dir-tabs')).toContainText('Оборудование');

  await page.evaluate(async () => {
    openDirectoryModal();
    document.getElementById('dir-category').value = 'equipment';
    updateDirFields();
    document.getElementById('dir-title').value = 'Мясорубка';
    document.getElementById('dir-field1').value = '1 шт';
    document.getElementById('dir-field2').value = 'Кухня';
    await saveDirectory();
  });
  expect(inserted, 'запись не ушла в базу').not.toBe(null);
  expect(inserted.filial).toBe('chekhov');
  expect(inserted.category).toBe('equipment');
  expect(inserted).toHaveProperty('photo_url', null);
});
