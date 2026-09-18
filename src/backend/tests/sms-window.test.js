import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveSmsWindow } from '../routes/auth/firebase.js';
test('SMS reservation blocks concurrent requests, survives refresh, and opens at ten minutes', async () => {
  const records = new Map();
  const collections = { otpTokens: { async updateOne(filter, update) {
    const old = records.get(filter._id);
    if (old && old.expiresAt > filter.expiresAt.$lte) throw Object.assign(new Error('duplicate'), {code:11000});
    records.set(filter._id, update.$set);
  } } };
  const now = Date.now();
  const attempts = await Promise.allSettled([reserveSmsWindow(collections, '+919876543210', now), reserveSmsWindow(collections, '9876543210', now)]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  await assert.rejects(reserveSmsWindow(collections, '+919876543210', now + 599999), /10 minutes/);
  await reserveSmsWindow(collections, '+919876543210', now + 600000);
  await reserveSmsWindow(collections, '+919876543211', now);
});
