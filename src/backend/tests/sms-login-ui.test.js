import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = (await fs.readFile(new URL('../../frontend/scripts/owner/login.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');
async function harness(channel = 'whatsapp') {
  const ids = ['phone-channel', 'phone-channel-field', 'owner-identifier', 'phone-otp-inp', 'phone-step2', 'owner-form-step1', 'card-sub', 'owner-auth-status', 'owner-login-button', 'phone-verify-btn', 'phone-resend-btn'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', style: {}, dataset: {}, classList: {add(){}, remove(){}}, addEventListener(){}, setAttribute(){}}]));
  elements['phone-channel'].value = channel;
  elements['owner-identifier'].value = '9876543210';
  const calls = [];
  let fail = false;
  const location = { search: '', href: '' };
  const context = { document: {getElementById: id => elements[id] || null}, window: {location}, location, URLSearchParams, sessionStorage: {setItem(){}, removeItem(){}}, getCaptchaToken: async () => 'wa-captcha', getFirebaseCaptchaToken: async () => 'sms-captcha', fetch: async (url, opts) => {
    calls.push({url, body: JSON.parse(opts.body)});
    return {ok: !fail, json: async () => fail ? {error: 'Try later'} : {ok: true, sessionInfo: 'sms-session', isNew: url.endsWith('/verify')}};
  }};
  const api = await vm.runInNewContext(`(async()=>{${source}\nreturn { loginOwner, verifyWhatsappOtp, resendWhatsappOtp };})()`, context);
  return {api, elements, calls, location, fail: value => {fail = value;}};
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
test('failed SMS resend retains current verification session', async () => {
  const h = await harness('sms');
  await h.api.loginOwner();
  h.fail(true);
  await h.api.resendWhatsappOtp();
  assert.equal(h.calls[1].url, '/api/auth/firebase-phone/send');
  assert.match(h.elements['owner-auth-status'].textContent, /Try later/);
  h.fail(false);
  h.elements['phone-otp-inp'].value = '123456';
  await h.api.verifyWhatsappOtp();
  assert.equal(h.calls[2].body.sessionInfo, 'sms-session');
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
