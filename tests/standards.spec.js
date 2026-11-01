// Стандарты с видео (01.11.2026): ролик пережимается в браузере перед
// загрузкой и не теряет звук, а статья уносит в базу файлы и отделы.
const { test, expect } = require('@playwright/test');

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

// Тяжёлый ролик со звуком, как из Telegram: 1280x720, высокий битрейт, тон 440 Гц
async function makeHeavyVideo(page, seconds) {
  return page.evaluate(async (seconds) => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const cx = c.getContext('2d');
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest); osc.start();
    const stream = c.captureStream(30);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { videoBitsPerSecond: 8000000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((ok) => (rec.onstop = ok));
    rec.start(500);
    const until = Date.now() + seconds * 1000;
    await new Promise((ok) => {
      const draw = () => {
        // движущиеся цветные плашки — кодеку есть что кодировать, как в живой съёмке
        const t = Date.now() / 300;
        for (let y = 0; y < 720; y += 40) for (let x = 0; x < 1280; x += 40) {
          cx.fillStyle = `hsl(${(x + y + t * 40) % 360},70%,${40 + 20 * Math.sin(x / 90 + t)}%)`;
          cx.fillRect(x, y, 40, 40);
        }
        if (Date.now() >= until) return ok();
        requestAnimationFrame(draw);
      };
      draw();
    });
    rec.stop(); await stopped; osc.stop(); ac.close();
    const type = chunks[0].type || 'video/webm';
    window.__heavy = new File([new Blob(chunks, { type })], 'IMG_9001.' + (type.includes('mp4') ? 'mp4' : 'webm'), { type });
    return window.__heavy.size;
  }, seconds);
}

test('видео стандарта сжимается и сохраняет звук', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.shrinkTrainingVideo === 'function');
  const original = await makeHeavyVideo(page, 3);

  const r = await page.evaluate(async () => {
    const ac = kbAudioContext();
    const progress = [];
    const out = await shrinkTrainingVideo(window.__heavy, ac, (p) => progress.push(p));
    ac.close();
    // Звук проверяем по самому файлу: проигрываем без звука и смотрим, сколько
    // аудио браузер раскодировал. Ноль — дорожки в ролике нет.
    const v = document.createElement('video');
    v.src = URL.createObjectURL(out); v.muted = true;
    await new Promise((ok) => (v.onloadedmetadata = ok));
    await v.play();
    await new Promise((ok) => setTimeout(ok, 1500));
    const audioBytes = v.webkitAudioDecodedByteCount;
    v.pause();
    return { size: out.size, same: out === window.__heavy, side: Math.max(v.videoWidth, v.videoHeight), audioBytes, type: out.type, progressed: progress.length > 0 };
  });

  expect(r.same, 'вернулся оригинал — сжатия не было').toBe(false);
  expect(r.size, `ролик не стал легче (${original} → ${r.size})`).toBeLessThan(original);
  // ~0,76 Мбит/с с запасом на начало записи: 3 секунды — не больше ~430 КБ
  expect(r.size * 8 / 3, `битрейт ${Math.round(r.size * 8 / 3 / 1000)} кбит/с — сжатие не держит норму`).toBeLessThan(1200000);
  expect(r.side, 'сторона больше 960 px').toBeLessThanOrEqual(960);
  expect(r.audioBytes, 'в сжатом ролике пропал звук').toBeGreaterThan(0);
  expect(r.progressed, 'человек не видел, сколько осталось').toBe(true);
});

test('стандарт сохраняется с файлами под kb/ и с отделами', async ({ page }) => {
  let saved = null;
  const uploads = [];
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/kb_articles') && req.method() === 'POST') saved = JSON.parse(req.postData() || '{}');
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/storage/v1/object/task-reports/**', (route) => {
    uploads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"task-reports/x"}' });
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.saveKbArticle === 'function');

  await page.evaluate(async () => {
    currentUser = { id: 'u1' };
    currentProfile = { name: 'Тест', employee_id: 1, role: 'admin' };
    openKbArticleModal(4);
    document.getElementById('kb-article-title').value = 'Как протереть стол';
    document.getElementById('kb-article-content').value = '1. Спрей. 2. Салфетка.';
    const c = document.createElement('canvas');
    c.width = 2000; c.height = 1500;
    c.getContext('2d').fillRect(0, 0, 2000, 1500);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
    kbAddMedia({ files: [new File([blob], 'stol.jpg', { type: 'image/jpeg' })], value: '' });
    document.querySelector('#kb-article-depts input[value="Официанты"]').checked = true;
    await saveKbArticle();
  });

  expect(saved, 'статья не ушла в базу').not.toBe(null);
  expect(saved.depts, 'отделы не сохранились').toEqual(['Официанты']);
  expect(saved.media.length, 'фото не попало в статью').toBe(1);
  expect(saved.media[0].path, 'файл лежит не под kb/ — его удалит уборка').toMatch(/^kb\//);
  expect(uploads.length, 'фото не загрузилось').toBe(1);
});

test('стандарт без отмеченных отделов виден всем', async ({ page }) => {
  let saved = null;
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/kb_articles') && req.method() === 'POST') saved = JSON.parse(req.postData() || '{}');
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.saveKbArticle === 'function');
  await page.evaluate(async () => {
    currentUser = { id: 'u1' };
    currentProfile = { name: 'Тест', employee_id: 1, role: 'admin' };
    openKbArticleModal(4);
    document.getElementById('kb-article-title').value = 'Как включить свет';
    await saveKbArticle();
  });
  expect(saved.depts, 'пустой выбор должен значить «всем»').toBe(null);
  expect(saved.media).toEqual([]);
});
