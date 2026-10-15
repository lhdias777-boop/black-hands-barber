/**
 * Black Hands: receptor de webhook Asaas para Cloudflare Workers.
 * No Worker ATUAL, adicione a rota:
 * if (url.pathname === '/api/asaas/webhook') return handleAsaasWebhook(request, env);
 * Importar este arquivo no bundle; nao servi-lo como JavaScript publico.
 */
export async function handleAsaasWebhook(request, env) {
  const reply = (status, payload) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });

  const token = env.ASAAS_WEBHOOK_TOKEN;
  const receivedToken = request.headers.get('asaas-access-token') || '';
  if (!token || typeof token !== 'string' || token.length < 32) {
    return reply(503, { error: 'Webhook not configured' });
  }
  const hash = async value => new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(value)
  ));
  const [expected, actual] = await Promise.all([hash(token), hash(receivedToken)]);
  let different = 0;
  for (let i = 0; i < expected.length; i++) different |= expected[i] ^ actual[i];
  if (different !== 0) return reply(401, { error: 'Unauthorized' });

  // Nunca conciliar cobrancas de Sandbox como producao.
  const apiBase = (env.ASAAS_API_BASE || env.ASAAS_BASE_URL || '').replace(/\/$/, '');
  if (env.BH_PAYMENTS_MODE !== 'production' || apiBase !== 'https://api.asaas.com/v3') {
    return reply(503, { error: 'Production environment not verified' });
  }
  if (!env.ASAAS_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply(503, { error: 'Payment service not configured' });
  }

  let raw;
  try { raw = await request.text(); } catch { return reply(400, { error: 'Invalid payload' }); }
  if (!raw || raw.length > 65536) return reply(413, { error: 'Invalid payload length' });
  let event;
  try { event = JSON.parse(raw); } catch { return reply(400, { error: 'Invalid JSON' }); }

  const eventId = event?.id;
  const eventType = event?.event;
  const paymentId = event?.payment?.id;
  if (typeof eventId !== 'string' || eventId.length < 5 || eventId.length > 200 ||
      typeof paymentId !== 'string' || !/^pay_[a-zA-Z0-9_-]{3,180}$/.test(paymentId) ||
      typeof eventType !== 'string') {
    return reply(400, { error: 'Invalid Asaas event' });
  }
  if (!['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(eventType)) {
    return reply(200, { ok: true, result: 'event_ignored' });
  }

  // Consultar o Asaas diretamente, sem confiar no status enviado no POST.
  let verifiedPayment;
  try {
    const check = await fetch(apiBase + '/payments/' + encodeURIComponent(paymentId), {
      headers: {
        access_token: env.ASAAS_API_KEY,
        accept: 'application/json',
        'User-Agent': 'BlackHandsBarber/1.0',
      },
    });
    if (!check.ok) return reply(503, { error: 'Asaas verification unavailable' });
    verifiedPayment = await check.json();
  } catch {
    return reply(503, { error: 'Asaas verification unavailable' });
  }
  if (verifiedPayment?.id !== paymentId || verifiedPayment?.billingType !== 'PIX' ||
      !['CONFIRMED', 'RECEIVED'].includes(verifiedPayment?.status) ||
      !Number.isFinite(Number(verifiedPayment.value)) || Number(verifiedPayment.value) <= 0) {
    return reply(409, { error: 'Payment is not a confirmed PIX' });
  }

  // RPC no Supabase: valida ambiente, valor, deduplicacao e bloqueios da agenda.
  let result;
  try {
    const db = await fetch(env.SUPABASE_URL.replace(/\/$/, '') +
      '/rest/v1/rpc/bh_process_verified_asaas_event', {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_event_id: eventId,
        p_event_type: eventType,
        p_payment_id: paymentId,
        p_payment_amount: verifiedPayment.value,
      }),
    });
    if (!db.ok) return reply(503, { error: 'Database unavailable' });
    result = await db.json();
  } catch {
    return reply(503, { error: 'Database unavailable' });
  }
  return reply(200, { ok: true, result: result?.result || 'processed' });
}
