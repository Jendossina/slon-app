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

// Пункт стандарта с меткой «[видео N]» кликабелен и открывает свой файл —
// как раньше ссылка на пост в Telegram (пример владельца, 01.11.2026).
test('пункт стандарта открывает своё видео или фото', async ({ page }) => {
  const article = {
    id: 7, book_id: 4, title: 'Открытие зала',
    content: '1. Свет во всех зонах включён.\n6. Столы протёрты с моющим средством. [видео 1]\n7. Менажные наборы чистые [фото 2]',
    media: [
      { type: 'video', url: 'https://x/kb/stol.mp4', path: 'kb/stol.mp4' },
      { type: 'image', url: 'https://x/kb/menazh.jpg', path: 'kb/menazh.jpg' },
      { type: 'image', url: 'https://x/kb/obshee.jpg', path: 'kb/obshee.jpg' },
    ],
    depts: ['Официанты'],
  };
  await page.route('**/rest/v1/kb_articles**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(article) }));
  await page.route('**/rest/v1/kb_books**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 4, title: 'Стандарты', edit_role: 'admin' }) }));
  await page.route('**/rest/v1/**', (route) => route.fallback ? route.fallback() : route.continue());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.openKbArticle === 'function');

  const r = await page.evaluate(async () => {
    currentUser = { id: 'u1' };
    currentProfile = { name: 'Тест', employee_id: 1, role: 'employee' };
    await openKbArticle(7);
    const lines = [...document.querySelectorAll('#kb-content .kb-ref-line')];
    const opened = [];
    lines.forEach((l) => {
      l.click();
      const box = document.getElementById('kb-media-content');
      const el = box.querySelector('video, img');
      opened.push((el.tagName === 'VIDEO' ? 'video ' : 'image ') + el.getAttribute('src') + ' | ' + document.getElementById('kb-media-title').textContent);
    });
    const text = document.getElementById('kb-content').innerText;
    const topMedia = [...document.querySelectorAll('#kb-content img, #kb-content video')].map((e) => e.getAttribute('src'));
    return { n: lines.length, first: lines[0] && lines[0].innerText, opened, hasRawTag: /\[(видео|фото)/.test(text), topMedia };
  });

  expect(r.n, 'кликабельных пунктов должно быть два').toBe(2);
  expect(r.first, 'кликабелен не тот пункт').toContain('Столы протёрты');
  // В заголовке окна — сам пункт, а не «Отчёт сотрудника»
  expect(r.opened).toEqual([
    'video https://x/kb/stol.mp4 | 6. Столы протёрты с моющим средством.',
    'image https://x/kb/menazh.jpg | 7. Менажные наборы чистые',
  ]);
  expect(r.hasRawTag, 'метка «[видео 1]» видна сотруднику как текст').toBe(false);
  expect(r.topMedia, 'над текстом — только файл без метки').toEqual(['https://x/kb/obshee.jpg']);
});

test('метка встаёт в конец пункта, а при удалении файла номера сдвигаются', async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kbInsertMediaRef === 'function');

  const r = await page.evaluate(() => {
    currentUser = { id: 'u1' };
    currentProfile = { name: 'Тест', employee_id: 1, role: 'admin' };
    openKbArticleModal(4);
    const ta = document.getElementById('kb-article-content');
    ta.value = '1. Свет включён.\n2. Столы протёрты.\n3. Менажки чистые.';
    kbEditMedia = [
      { type: 'video', url: 'u1', path: 'kb/1.mp4' },
      { type: 'video', url: 'u2', path: 'kb/2.mp4' },
      { type: 'image', url: 'u3', path: 'kb/3.jpg' },
    ];
    kbRenderEditMedia();
    // курсор посреди второго пункта, потом фокус уходит на кнопку
    ta.focus(); ta.setSelectionRange(22, 22); ta.blur();
    kbInsertMediaRef(1);
    ta.focus(); ta.setSelectionRange(ta.value.length - 3, ta.value.length - 3); ta.blur();
    kbInsertMediaRef(2);
    const inserted = ta.value;
    kbRemoveMedia(0);   // первый ролик убрали: [видео 2] → [видео 1], [фото 3] → [фото 2]
    return { inserted, after: ta.value, left: kbEditMedia.map((m) => m.url) };
  });

  expect(r.inserted).toBe('1. Свет включён.\n2. Столы протёрты. [видео 2]\n3. Менажки чистые. [фото 3]');
  expect(r.after).toBe('1. Свет включён.\n2. Столы протёрты. [видео 1]\n3. Менажки чистые. [фото 2]');
  expect(r.left).toEqual(['u2', 'u3']);
});

// Несколько фото на пункт и пояснение «как делать» строками с тире под ним:
// в списке пояснение скрыто, в окне пункта — все файлы и пояснение.
test('пункт с несколькими фото и пояснением', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kbOpenItem === 'function');
  const r = await page.evaluate(() => {
    kbCurrentArticle = {
      title: 'Открытие зала',
      content: '1. Свет включён.\n7. Менажные наборы чистые [фото 1] [фото 2]\n- Соль и перец заполнены на 2/3\n- Салфетки сложены уголком [фото 3]\n8. Кнопки вызова работают\n- Нажать каждую и проверить часы',
      media: [{ type: 'image', url: 'a.jpg' }, { type: 'image', url: 'b.jpg' }, { type: 'image', url: 'c.jpg' }],
    };
    const box = document.createElement('div');
    box.innerHTML = kbContentHtml(kbCurrentArticle);
    document.body.appendChild(box);
    const listText = box.innerText;
    const lines = [...box.querySelectorAll('.kb-ref-line')].map((l) => l.innerText);
    box.querySelectorAll('.kb-ref-line')[0].click();
    const content = document.getElementById('kb-media-content');
    const shown = [...content.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    const detail = content.innerText;
    const title = document.getElementById('kb-media-title').textContent;
    box.querySelectorAll('.kb-ref-line')[1].click();
    const onlyDetail = { imgs: content.querySelectorAll('img, video').length, text: content.innerText };
    box.remove();

    // Обычная статья без меток: тире — это список, его не прячем
    const plain = document.createElement('div');
    plain.innerHTML = kbContentHtml({ content: 'Состав:\n- лёд\n- лайм', media: [] });
    return { listText, lines, shown, detail, title, onlyDetail, plainText: plain.innerText, plainClickable: plain.querySelectorAll('.kb-ref-line').length };
  });

  expect(r.listText, 'пояснение видно в списке — стандарт перестаёт быть коротким').not.toContain('Соль и перец');
  expect(r.lines.length, 'кликабельны пункты 7 и 8').toBe(2);
  expect(r.lines[0], 'у пункта с тремя фото значок с числом').toContain('📷 3');
  expect(r.shown).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  expect(r.title).toBe('7. Менажные наборы чистые');
  expect(r.detail).toContain('Соль и перец заполнены на 2/3');
  expect(r.detail).toContain('Салфетки сложены уголком');
  expect(r.onlyDetail.imgs, 'у пункта 8 нет файлов').toBe(0);
  expect(r.onlyDetail.text).toContain('Нажать каждую');
  expect(r.plainText, 'в обычной статье список с тире пропал').toContain('- лёд');
  expect(r.plainClickable).toBe(0);
});

test('строка пояснения с двоеточием — подзаголовок, а не пункт', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kbOpenItem === 'function');
  const r = await page.evaluate(() => {
    kbCurrentArticle = {
      title: 'Открытие', media: [{ type: 'image', url: 'a.jpg' }],
      content: '10. Стейшен заполнен [фото 1]\n- Комплектация (минимум):\n- Вилки 15\n- Ножи 15',
    };
    kbOpenItem(0);
    const rows = [...document.getElementById('kb-media-content').querySelectorAll('div > div')].map((d) => d.innerText.replace(/\s+/g, ' ').trim());
    return rows;
  });
  expect(r).toContain('Комплектация (минимум)');
  expect(r).toContain('• Вилки 15');
  expect(r.some((x) => x.startsWith('•') && x.includes('Комплектация')), 'подзаголовок показан пунктом').toBe(false);
});
