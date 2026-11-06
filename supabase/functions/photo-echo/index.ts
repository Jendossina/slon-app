// Supabase Edge Function: photo-echo
// Возвращает присланный снимок обратно, байт в байт. Больше ничего не делает.
//
// Зачем: на vivo Y35 (старший бармен, 2026) часть снимков из галереи браузер
// внутри приложения отказывается читать — file.arrayBuffer(), createImageBitmap
// и <img> падают с NotReadableError, а значит, сжать снимок на телефоне нечем.
// Отказ привязан к файлу: 30.10.2026 одни и те же восемь снимков, отправленные
// дважды, оба раза ушли оригиналами. При этом ОТПРАВКА того же файла проходит
// (сеть читает его другим путём). Поэтому телефон отправляет снимок сюда и
// получает его назад уже обычными байтами в памяти — их можно сжать как всегда.
// В хранилище оригинал не попадает.
//
// Разворачивается с проверкой JWT (--verify-jwt): звать может только вошедший
// сотрудник, иначе это был бы бесплатный ретранслятор трафика для кого угодно.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BYTES = 20 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const fail = (msg: string, status: number) =>
    new Response(msg, { status, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  if (req.method !== "POST") return fail("POST only", 405);

  let file: FormDataEntryValue | null = null;
  try {
    file = (await req.formData()).get("file");
  } catch (_e) {
    return fail("bad form", 400);
  }
  if (!(file instanceof File)) return fail("no file", 400);
  if (!file.type.startsWith("image/")) return fail("not an image", 415);
  if (file.size > MAX_BYTES) return fail("too big", 413);

  return new Response(file.stream(), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.size),
      "Cache-Control": "no-store",
    },
  });
});
