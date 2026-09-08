// Supabase Edge Function: send-telegram
// Токен бота берётся из секрета TG_TOKEN (Supabase -> Edge Functions -> Secrets),
// в коде его быть не должно.
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    });
  }
  try {
    const body = await req.text();
    const { chat_id, text, media, document: doc, filename } = JSON.parse(body);
    const TG_TOKEN = Deno.env.get("TG_TOKEN");

    // doc — файл по ссылке (сейчас это APK из релизов GitHub). Отправляем
    // документом, потому что скачивание APK браузером на части телефонов молча
    // застревает: полоска доходит до 100%, а файла на устройстве нет (браузер
    // внутри Telegram кладёт его в своё хранилище, MIUI режет установку из
    // неизвестных источников). Файл в чате ставится нажатием и этих преград не
    // знает. Качаем байтами: GitHub отвечает редиректом на подписанный адрес,
    // и Telegram по такой ссылке файл забрать не может.
    const DOC_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
    if (doc) {
      let host = '';
      try { host = new URL(String(doc)).hostname; } catch (_e) { /* адрес разберём ниже */ }
      if (!DOC_HOSTS.includes(host)) {
        // Иначе бот превратился бы в пересыльщик любых файлов кому угодно:
        // функция открыта, токен в ней свой
        return new Response(JSON.stringify({ ok: false, description: 'посторонний адрес файла' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const file = await fetch(String(doc));
      if (!file.ok) {
        return new Response(JSON.stringify({ ok: false, description: `файл не скачался: ${file.status}` }), {
          status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const form = new FormData();
      form.append('chat_id', String(chat_id));
      form.append('document', await file.blob(), String(filename || 'file.apk'));
      if (text) { form.append('caption', text); form.append('parse_mode', 'HTML'); }
      const docRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendDocument`, {
        method: 'POST', body: form,
      });
      return new Response(JSON.stringify(await docRes.json()), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // media — альбом видео (дайджест прихода): до 10 роликов одним сообщением,
    // подпись у каждого своя.
    //
    // Файлы отдаём БАЙТАМИ, а не ссылкой. Ссылку Telegram скачать не может:
    // хранилище стоит за Cloudflare, и его фетчер получает отлуп — приходит
    // «Wrong file identifier/HTTP URL specified». Ролик весит около полумегабайта,
    // так что прогнать его через функцию дешевле, чем городить обходы.
    if (Array.isArray(media) && media.length) {
      const form = new FormData();
      form.append('chat_id', String(chat_id));
      const parts = [];
      for (let i = 0; i < Math.min(media.length, 10); i++) {
        const it = media[i];
        const file = await fetch(it.media);
        if (!file.ok) continue;                    // ролик удалён по сроку хранения — пропускаем
        const name = `file${i}`;
        form.append(name, await file.blob(), `${name}.mp4`);
        parts.push({ type: it.type || 'video', media: `attach://${name}`,
                     caption: it.caption, parse_mode: 'HTML' });
      }
      if (!parts.length) {
        return new Response(JSON.stringify({ ok: false, description: 'нечего отправлять' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      form.append('media', JSON.stringify(parts));
      const albumRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMediaGroup`, {
        method: 'POST', body: form,
      });
      return new Response(JSON.stringify(await albumRes.json()), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message
    }), {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});
