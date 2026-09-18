import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { captureMetaCheckoutContext } from '../lib/integrations/meta-checkout-context.js';
import { sendCapiEvent } from '../lib/integrations/meta-capi.js';
import { renderAnalyticsBundle } from '../lib/analytics.js';

const source = fs.readFileSync(new URL('../assets/analytics.js', import.meta.url), 'utf8');
function visit(hostname, search, jar, surface = 'app', configured = true) {
  const writes = [];
  const document = {
    currentScript: { getAttribute: () => surface },
    get cookie() { return Object.entries(jar).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('; '); },
    set cookie(value) {
      writes.push(value);
      const [name, encoded] = value.split(';')[0].split('=');
      jar[name] = decodeURIComponent(encoded);
    }
  };
  const code = renderAnalyticsBundle(source, configured ? { metaPixelId: 'test' } : {})
    .split('  // ---------------------------------------------------------------- event map')[0] + '})();';
  vm.runInNewContext(code, { document, window: { location: { hostname, search, protocol: 'https:' } }, URLSearchParams });
  return writes;
}

test('real ad click survives landing to app, retaining original click timestamp', () => {
  const jar = {};
  const writes = visit('parktag.me', '?fbclid=real_click_123', jar);
  assert.match(jar._fbc, /^fb\.1\.\d+\.real_click_123$/);
  assert.match(jar._fbp, /^fb\.1\.\d+\.\d+$/);
  assert.ok(writes.every(v => v.includes('Domain=parktag.me') && v.includes('Secure')));
  const original = { ...jar };
  visit('app.parktag.me', '', jar);
  assert.deepEqual(jar, original);
  const context = captureMetaCheckoutContext({ cookies: jar, ip: '203.0.113.5', headers: { 'user-agent': 'buyer browser' } });
  assert.equal(context.fbc, original._fbc);
  assert.equal(context.fbp, original._fbp);
  assert.equal(context.clientIp, '203.0.113.5');
  assert.equal(context.userAgent, 'buyer browser');
});

test('UTMs never become fabricated click IDs; new actual clicks replace fbc', () => {
  const jar = {};
  visit('parktag.me', '?utm_source=meta', jar);
  assert.equal(jar._fbc, undefined);
  visit('parktag.me', '?fbclid=first', jar);
  visit('parktag.me', '?fbclid=second', jar);
  assert.ok(jar._fbc.endsWith('.second'));
});

test('scanner and unconfigured environments do not write cookies', () => {
  assert.deepEqual(visit('app.parktag.me', '?fbclid=secret', {}, 'scanner'), []);
  assert.deepEqual(visit('app.parktag.me', '?fbclid=secret', {}, 'app', false), []);
  assert.ok(visit('localhost', '', {}).every(v => !v.includes('Domain=')));
});

test('malformed cookie values and forwarded headers are not trusted', () => {
  const context = captureMetaCheckoutContext({ cookies: { _fbc: 'meta / paid', _fbp: 'bad' }, ip: 'not-ip', headers: { 'x-forwarded-for': '203.0.113.99', 'user-agent': 'x'.repeat(1025) } });
  assert.deepEqual(context, { eventSourceUrl: 'https://app.parktag.me/shop' });
});

test('persisted checkout context reaches Purchase; acceptance is checked', async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  let accepted = 1;
  globalThis.fetch = async (_, options) => {
    payload = JSON.parse(options.body).data[0];
    return { ok: true, json: async () => ({ events_received: accepted }) };
  };
  try {
    const context = captureMetaCheckoutContext({ cookies: { _fbc: 'fb.1.1750000000000.real_click', _fbp: 'fb.1.1750000000000.12345' }, ip: '203.0.113.5', headers: { 'user-agent': 'buyer browser' } });
    const env = { metaPixelId: 'test', metaCapiAccessToken: 'test' };
    const event = { eventName: 'Purchase', eventId: 'purchase:PT-test', eventSourceUrl: context.eventSourceUrl, userData: { ...context, phone: '9876543210' }, customData: { value: 499, currency: 'INR' } };
    assert.equal((await sendCapiEvent(env, event)).ok, true);
    assert.equal(payload.user_data.fbc, context.fbc);
    assert.equal(payload.user_data.fbp, context.fbp);
    assert.equal(payload.user_data.client_user_agent, 'buyer browser');
    assert.equal(payload.event_source_url, context.eventSourceUrl);
    assert.equal(payload.custom_data.value, 499);
    assert.match(payload.user_data.ph[0], /^[a-f0-9]{64}$/);
    accepted = 0;
    assert.equal((await sendCapiEvent(env, event)).ok, false);
  } finally { globalThis.fetch = originalFetch; }
});
