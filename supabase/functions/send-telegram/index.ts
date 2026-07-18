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
    const { chat_id, text } = JSON.parse(body);
    const TG_TOKEN = Deno.env.get("TG_TOKEN");
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id,
        text,
        parse_mode: 'HTML'
      })
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
