import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { captchaSizeFor } from '../../frontend/scripts/firebase-sms.js';

// Google's checkbox card is 304px wide in "normal" and cannot be resized. The
// sign-in card is `viewport - 82px` wide inside (16px page padding, 24px card
// padding and a 1px border on each side), so it only fits from 386px up.
const insideCard = viewport => viewport - 82;

test('the captcha uses the compact card wherever the normal one would overflow', () => {
  for (const phone of [320, 360, 375, 384]) assert.equal(captchaSizeFor(insideCard(phone)), 'compact', `${phone}px phone`);
  for (const wide of [386, 390, 412, 768, 1280]) assert.equal(captchaSizeFor(Math.min(insideCard(wide), 350)), 'normal', `${wide}px screen`);
  assert.equal(captchaSizeFor(304), 'normal');
  assert.equal(captchaSizeFor(303), 'compact');
});

test('an unmeasurable container gets the size that always fits', () => {
  assert.equal(captchaSizeFor(0), 'compact');
});

test('the login page centres the captcha and keeps it inside the card', async () => {
  const html = await fs.readFile(new URL('../../frontend/pages/owner/login.html', import.meta.url), 'utf8');
  const tag = html.match(/<div id="firebase-sms-recaptcha"[^>]*>/)?.[0] || '';
  assert.match(tag, /justify-content:center/);
  assert.match(tag, /max-width:100%/);
  assert.match(tag, /overflow:hidden/);
});
