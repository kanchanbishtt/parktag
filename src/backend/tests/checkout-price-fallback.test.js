import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const sheet = await fs.readFile(new URL('../../frontend/scripts/owner/address-step.js', import.meta.url), 'utf8');
const vendor = await fs.readFile(new URL('../../frontend/scripts/vendor/number-flow.js', import.meta.url), 'utf8');

// The order-summary price on the delivery sheet (/get, /shop) is upgraded from
// plain text to the NumberFlow rolling number. On a browser without CSS round()
// that upgrade broke the price: ₹399 was drawn as ₹99.
function numberFlowFits(CSS) {
  const source = sheet.match(/function numberFlowFits\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, 'numberFlowFits is defined in address-step.js');
  return vm.runInNewContext(`(${source})()`, CSS === undefined ? {} : { CSS });
}

test('the rolling price is used only where CSS round() exists', () => {
  const asked = [];
  const modern = { supports: (prop, value) => { asked.push([prop, value]); return true; } };
  assert.equal(numberFlowFits(modern), true);
  assert.deepEqual(asked, [['padding', 'round(nearest, 1px, 1px)']]);
  assert.equal(numberFlowFits({ supports: () => false }), false, 'Chrome before 125: plain text');
  assert.equal(numberFlowFits({}), false, 'no CSS.supports: plain text');
  assert.equal(numberFlowFits(undefined), false, 'no CSS object: plain text');
  assert.equal(numberFlowFits({ supports() { throw new Error('boom'); } }), false);
});

test('NumberFlow is not even downloaded where it would not fit', () => {
  const load = sheet.match(/function loadNumberFlow\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const guard = load.indexOf('!numberFlowFits()');
  const fetched = load.indexOf('import("/scripts/vendor/number-flow.js")');
  assert.ok(guard > -1 && fetched > -1 && guard < fetched, 'the guard returns before the import');
});

// Why the guard exists. If a NumberFlow upgrade stops doing this, the guard can go.
test('the vendored NumberFlow still offsets its digits with a round() padding', () => {
  assert.match(vendor, /\$="round\(nearest,/);
  assert.ok(vendor.includes("margin:0 calc(-1 * ${R})"), "digits are pulled left by a negative margin");
  assert.ok(vendor.includes(".number__inner{padding:${$} ${R}"), "and pushed back by a padding that needs round()");
});
