import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {startTestApp, stopTestApp, purgeLoginCollections, TEST_ORIGIN, uniqueAddress} from './helpers.js';
let app, collections;
const realFetch = globalThis.fetch;
let upstreamCalls = 0;
let rejectCode = false;
const phone = '+919000000001';
before(async () => {
  process.env.FIREBASE_API_KEY = 'fake-test-key';
  process.env.FIREBASE_PROJECT_ID = 'test-project';
  ({app, collections} = await startTestApp());
  await purgeLoginCollections(collections);
  globalThis.fetch = async url => {
    assert.match(String(url), /^https:\/\/identitytoolkit.googleapis.com\//);
    upstreamCalls++;
    if (rejectCode) return {ok: false, status: 400, json: async () => ({error: {message: 'INVALID_CODE'}})};
    return {ok: true, json: async () => ({phoneNumber: phone, sessionInfo: 'fake-session'})};
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  if (collections) await purgeLoginCollections(collections);
  if (app) await stopTestApp(app);
});
function post(path, payload) {
  return app.inject({method: 'POST', url: '/api/auth/firebase-phone/' + path, payload, remoteAddress: uniqueAddress(), headers: {origin: TEST_ORIGIN}});
}
test('SMS verification reuses the existing WhatsApp owner', async () => {
  const {_id} = await (async () => { const doc = {mobile: phone, phone, role: 'owner', createdAt: new Date().toISOString()}; const r = await collections.owners.insertOne(doc); return {_id: r.insertedId}; })();
  const response = await post('verify', {sessionInfo: 'fake-session', code: '123456'});
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().isNew, false);
  assert.equal(await collections.owners.countDocuments({mobile: phone}), 1);
  assert.ok(await collections.sessions.findOne({userId: String(_id)}));
});
test('invalid Firebase OTP never creates a session', async () => {
  const before = await collections.sessions.countDocuments({});
  rejectCode = true;
  try {
    const response = await post('verify', {sessionInfo: 'fake-session', code: '000000'});
    assert.equal(response.statusCode, 400);
    assert.equal(await collections.sessions.countDocuments({}), before);
  } finally { rejectCode = false; }
});
test('missing captcha is rejected before contacting Firebase', async () => {
  const before = upstreamCalls;
  assert.equal((await post('send', {phone})).statusCode, 400);
  assert.equal(upstreamCalls, before);
});
test('SMS send is charged against the shared destination budget', async () => {
  const response = await post('send', {phone, recaptchaToken: 'fake-token'});
  assert.equal(response.statusCode, 200);
  assert.ok(await collections.otpTokens.findOne({identifier: phone, channel: 'firebase', used: true}));
});

test('a rejected SMS does not block either OTP channel', async () => {
  const rejectedPhone = '+919000000002';
  rejectCode = true;
  try {
    const rejected = await post('send', {phone: rejectedPhone, recaptchaToken: 'fake-token'});
    assert.equal(rejected.statusCode, 400);
    assert.equal(await collections.otpTokens.countDocuments({identifier: rejectedPhone}), 0);
    assert.equal(await collections.otpTokens.countDocuments({_id: `sms-window:${rejectedPhone}`}), 0);
  } finally { rejectCode = false; }

  const retry = await post('send', {phone: rejectedPhone, recaptchaToken: 'fresh-token'});
  assert.equal(retry.statusCode, 200);
});

test('legacy mobile spelling reuses its account rather than making a duplicate', async () => {
  await collections.owners.updateOne({mobile: phone}, {$set: {mobile: '9000000001'}});
  const response = await post('verify', {sessionInfo: 'fake-session', code: '123456'});
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().isNew, false);
  assert.equal(await collections.owners.countDocuments({}), 1);
});

test('a second SMS inside the window is refused with the seconds remaining', async () => {
  const windowPhone = '+919000000003';
  const first = await post('send', {phone: windowPhone, recaptchaToken: 'fake-token'});
  assert.equal(first.statusCode, 200);
  const second = await post('send', {phone: windowPhone, recaptchaToken: 'fake-token'});
  assert.equal(second.statusCode, 429);
  const body = second.json();
  assert.ok(Number.isInteger(body.retryAfter) && body.retryAfter > 0 && body.retryAfter <= 600, `retryAfter=${body.retryAfter}`);
  assert.equal(second.headers['retry-after'], String(body.retryAfter));
  assert.match(body.error, /Please wait (\d+ min( \d+ sec)?|\d+ sec) before requesting another/);
});
