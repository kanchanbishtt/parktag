import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveSmsWindow } from '../routes/auth/firebase.js';
test('SMS reservation blocks concurrent requests, survives refresh, and opens at ten minutes', async () => {
  const records = new Map();
  const collections = { otpTokens: { async updateOne(filter, update) {
    const old = records.get(filter._id);
    if (old && old.expiresAt > filter.expiresAt.$lte) throw Object.assign(new Error('duplicate'), {code:11000});
    records.set(filter._id, update.$set);
  }, async findOne(filter) { return records.get(filter._id) || null; } } };
  const now = Date.now();
  const attempts = await Promise.allSettled([reserveSmsWindow(collections, '+919876543210', now), reserveSmsWindow(collections, '9876543210', now)]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  // The refusal says how long is left, and carries it for the route's 429.
  await assert.rejects(reserveSmsWindow(collections, '+919876543210', now + 599999), err => err.retryAfterSeconds === 1 && /wait 1 sec before requesting another/.test(err.message));
  await assert.rejects(reserveSmsWindow(collections, '+919876543210', now + 300000), err => err.retryAfterSeconds === 300 && /wait 5 min before requesting another/.test(err.message));
  // A stub with no findOne (or a failing lookup) still refuses, with the full window.
  const bare = { otpTokens: { updateOne: collections.otpTokens.updateOne } };
  await assert.rejects(reserveSmsWindow(bare, '+919876543210', now + 1), err => err.retryAfterSeconds === 600);
  await reserveSmsWindow(collections, '+919876543210', now + 600000);
  await reserveSmsWindow(collections, '+919876543211', now);
});
