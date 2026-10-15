import { handleAsaasWebhook } from './asaas-webhook.mjs';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const previousFetch = globalThis.fetch;
const token = 'safe-test-token-at-least-32-characters-local-only';
const env = {
  ASAAS_WEBHOOK_TOKEN: token,
  ASAAS_API_KEY: 'test-only',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  ASAAS_API_BASE: 'https://api.asaas.com/v3',
  BH_PAYMENTS_MODE: 'production',
};
const body = JSON.stringify({
  id: 'evt_abcdef123456789',
  event: 'PAYMENT_RECEIVED',
  payment: { id: 'pay_12345test' },
});
const req = (t = token, payload = body) => new Request(
  'https://test.workers.dev/api/asaas/webhook',
  { method: 'POST', headers: { 'asaas-access-token': t }, body: payload },
);
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push([url, options]);
  if (url.includes('api.asaas.com')) {
    return new Response(JSON.stringify({
      id: 'pay_12345test', billingType: 'PIX', status: 'RECEIVED', value: 35,
    }), { status: 200 });
  }
  return new Response(JSON.stringify({ result: 'processed' }), { status: 200 });
};

try {
  assert.equal((await handleAsaasWebhook(req('wrong'), env)).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await handleAsaasWebhook(req(token, '{'), env)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await handleAsaasWebhook(req(), {
    ...env, ASAAS_API_BASE: 'https://api-sandbox.asaas.com/v3',
  })).status, 503);
  const response = await handleAsaasWebhook(req(), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, 'processed');
  assert.equal(calls.length, 2);
  const data = JSON.parse(calls[1][1].body);
  assert.equal(data.p_payment_id, 'pay_12345test');
  assert.equal(data.p_payment_amount, 35);
} finally {
  globalThis.fetch = previousFetch;
}
