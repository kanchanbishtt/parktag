import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = (await fs.readFile(new URL('../../frontend/scripts/owner/login.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');
// `store` is a plain object standing in for localStorage; pass the same one to
// two harnesses to simulate a page reload (fresh script state, same browser).
// `clock` is a mutable { now } so tests can move time without waiting.
async function harness(channel = 'whatsapp', { store = {}, clock = { now: 1_700_000_000_000 } } = {}) {
  const ids = ['sms-fallback', 'sms-fallback-btn', 'sms-consent', 'phone-channel', 'phone-channel-field', 'owner-identifier', 'phone-otp-inp', 'phone-step2', 'owner-form-step1', 'card-sub', 'owner-auth-status', 'owner-login-button', 'phone-verify-btn', 'phone-resend-btn'];
  const listeners = {};
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', style: {}, dataset: {}, classList: {add(){}, remove(){}}, addEventListener(event, fn){ (listeners[id] ||= {})[event] = fn; }, setAttribute(){}}]));
  elements['phone-channel'].value = channel;
  elements['owner-identifier'].value = '9876543210';
  const calls = [];
  let fail = false;
  let failBody = {error: 'Try later'};
  let failStatus = 500;
  const location = { search: '', href: '' };
  const timers = [];
  const intervals = [];
  const context = {
    Date: { now: () => clock.now },
    setTimeout: (fn, ms) => timers.push({fn, ms}),
    setInterval: (fn, ms) => { intervals.push({fn, ms}); return intervals.length; },
    clearInterval(){},
    document: {hidden: false, getElementById: id => elements[id] || null, addEventListener(){}},
    window: {location}, location, URLSearchParams,
    sessionStorage: {setItem(){}, removeItem(){}, getItem(){ return null; }},
    localStorage: {getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); }, removeItem: key => { delete store[key]; }},
    getCaptchaToken: async () => 'wa-captcha', getFirebaseCaptchaToken: async () => 'sms-captcha',
    fetch: async (url, opts) => {
      calls.push({url, body: JSON.parse(opts.body)});
      return {ok: !fail, status: fail ? failStatus : 200, json: async () => fail ? failBody : {ok: true, sessionInfo: 'sms-session', isNew: url.endsWith('/verify')}};
    }
  };
  const api = await vm.runInNewContext(`(async()=>{${source}\nreturn { loginOwner, verifyWhatsappOtp, resendWhatsappOtp };})()`, context);
  // Advance the fake clock and fire the countdown tick, as a browser would.
  const tick = ms => { clock.now += ms; for (const i of intervals) i.fn(); };
  return {api, elements, calls, timers, intervals, listeners, location, store, clock, tick, fail: (value, body, status) => {fail = value; if (body) failBody = body; if (status) failStatus = status;}};
}
test('WhatsApp remains default and uses existing OTP endpoints', async () => {
  const h = await harness();
  await h.api.loginOwner();
  assert.equal(h.calls[0].url, '/api/auth/send-otp');
  assert.equal(h.calls[0].body.identifier, '+919876543210');
  h.elements['phone-otp-inp'].value = '123456';
  await h.api.verifyWhatsappOtp();
  assert.equal(h.calls[1].url, '/api/auth/verify-otp');
});
test('a WhatsApp failure exposes SMS immediately', async () => {
  const h = await harness();
  h.fail(true);
  await h.api.loginOwner();
  assert.equal(h.elements['phone-step2'].style.display, '');
  assert.equal(h.elements['sms-fallback'].hidden, false);
  assert.match(h.elements['owner-auth-status'].textContent, /try SMS/i);
});
test('SMS uses Firebase captcha, session verification, and new-owner redirect', async () => {
  const h = await harness('sms');
  await h.api.loginOwner();
  assert.equal(h.calls[0].url, '/api/auth/firebase-phone/send');
  assert.equal(h.calls[0].body.recaptchaToken, 'sms-captcha');
  assert.match(h.elements['card-sub'].innerHTML, /SMS/);
  h.elements['phone-otp-inp'].value = '123456';
  await h.api.verifyWhatsappOtp();
  assert.equal(h.calls[1].url, '/api/auth/firebase-phone/verify');
  assert.equal(h.calls[1].body.sessionInfo, 'sms-session');
  assert.equal(h.location.href, '/owner-welcome?new=1');
});
test('SMS resend during cooldown makes no request and retains verification session', async () => {
  const h = await harness('sms');
  await h.api.loginOwner();
  h.fail(true);
  await h.api.resendWhatsappOtp();
  assert.equal(h.calls.length, 1);
  assert.match(h.elements['owner-auth-status'].textContent, /wait 10 min before requesting another SMS/);
  h.fail(false);
  h.elements['phone-otp-inp'].value = '123456';
  await h.api.verifyWhatsappOtp();
  assert.equal(h.calls[1].body.sessionInfo, 'sms-session');
});
test('SMS choice does not affect email OTP', async () => {
  const h = await harness('sms');
  h.elements['owner-identifier'].value = 'test@example.com';
  await h.api.loginOwner();
  assert.equal(h.calls[0].url, '/api/auth/send-otp');
  assert.equal(h.location.href, '/owner-verify');
});
test('rejects nonnumeric codes without a verification request', async () => {
  const h = await harness('sms');
  await h.api.loginOwner();
  h.elements['phone-otp-inp'].value = 'abcdef';
  await h.api.verifyWhatsappOtp();
  assert.equal(h.calls.length, 1);
});

test('SMS fallback delay starts after WhatsApp send, not page load', async () => {
  const h = await harness();
  assert.equal(h.elements['sms-fallback'].hidden, true);
  assert.equal(h.timers.length, 0);
  await h.api.loginOwner();
  assert.equal(h.elements['sms-fallback'].hidden, true);
  assert.equal(h.timers[0].ms, 10000);
  h.timers[0].fn();
  assert.equal(h.elements['sms-fallback'].hidden, false);
  assert.equal(h.elements['phone-channel'].value, 'whatsapp');
});

test('WhatsApp resend restarts fallback delay and invalidates old timer', async () => {
  const h = await harness();
  await h.api.loginOwner();
  await h.api.resendWhatsappOtp();
  h.timers[0].fn();
  assert.equal(h.elements['sms-fallback'].hidden, true);
  h.timers[1].fn();
  assert.equal(h.elements['sms-fallback'].hidden, false);
});

test('SMS countdown runs from 10:00 down to Resend', async () => {
  const h = await harness('sms');
  await h.api.loginOwner();
  assert.equal(h.elements['phone-resend-btn'].textContent, 'Try SMS in 10:00');
  assert.equal(h.elements['phone-resend-btn'].disabled, true);
  assert.equal(h.intervals.length, 1, 'one ticking countdown');
  h.tick(61_000);
  assert.equal(h.elements['phone-resend-btn'].textContent, 'Try SMS in 8:59');
  h.tick(539_000);
  assert.equal(h.elements['phone-resend-btn'].textContent, 'Resend');
  assert.equal(h.elements['phone-resend-btn'].disabled, false);
});

test('Resend tapped inside the SMS window stays disabled and keeps counting', async () => {
  const h = await harness('sms');
  await h.api.loginOwner();
  h.tick(30_000);
  await h.api.resendWhatsappOtp();
  assert.equal(h.calls.length, 1, 'no second SMS request');
  assert.equal(h.elements['phone-resend-btn'].disabled, true);
  assert.equal(h.elements['phone-resend-btn'].textContent, 'Try SMS in 9:30');
  assert.match(h.elements['owner-auth-status'].textContent, /wait 9 min 30 sec/);
});

test('the SMS window survives a page reload for the same number', async () => {
  const store = {};
  const clock = { now: 1_700_000_000_000 };
  const first = await harness('sms', {store, clock});
  await first.api.loginOwner();
  clock.now += 120_000;
  // Reload: fresh script state, same browser storage.
  const again = await harness('sms', {store, clock});
  await again.api.loginOwner();
  assert.equal(again.calls.length, 0, 'no SMS request while the window is live');
  assert.equal(again.elements['phone-step2'].style.display, '', 'verification step still opens');
  assert.equal(again.elements['sms-fallback'].hidden, false);
  assert.equal(again.elements['sms-fallback-btn'].textContent, 'Try SMS in 8:00');
  assert.equal(again.elements['sms-fallback-btn'].disabled, true);
  assert.match(again.elements['owner-auth-status'].textContent, /wait 8 min before requesting another SMS/);
  assert.doesNotMatch(again.elements['owner-auth-status'].textContent, /WhatsApp/);
});

test('a different number is not held to the previous number\'s SMS window', async () => {
  const store = {};
  const first = await harness('sms', {store});
  await first.api.loginOwner();
  const other = await harness('sms', {store});
  other.elements['owner-identifier'].value = '9123456789';
  await other.api.loginOwner();
  assert.equal(other.calls.length, 1);
  assert.equal(other.calls[0].body.phone, '+919123456789');
});

test('a server 429 with retryAfter starts the countdown from the server\'s clock', async () => {
  const h = await harness('sms');
  h.fail(true, {ok: false, error: 'An SMS was sent to this number recently. Please wait 5 min 42 sec before requesting another.', retryAfter: 342}, 429);
  await h.api.loginOwner();
  assert.equal(h.calls.length, 1);
  assert.match(h.elements['owner-auth-status'].textContent, /5 min 42 sec/);
  assert.equal(h.elements['sms-fallback-btn'].textContent, 'Try SMS in 5:42');
  assert.equal(h.elements['sms-fallback-btn'].disabled, true);
  assert.equal(h.intervals.length, 1, 'countdown is ticking');
  h.tick(342_000);
  assert.equal(h.elements['sms-fallback-btn'].textContent, 'Try SMS OTP verification');
  assert.equal(h.elements['sms-fallback-btn'].disabled, false);
});

test('a WhatsApp send failure is still reported as WhatsApp', async () => {
  const h = await harness();
  h.fail(true);
  await h.api.loginOwner();
  assert.match(h.elements['owner-auth-status'].textContent, /WhatsApp could not send/);
});
