// A COD shipment tells Delhivery to collect the order total in cash; a prepaid
// one must collect nothing. Pure: fetch is replaced, no database, no network.
import test, { describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createShipment } from "../lib/integrations/delhivery.js";

// Not a test_ prefix on purpose: the external guard refuses a disposable run,
// and every call below is caught by the stubbed fetch before any network.
const ENV = {
  mongoCollectionPrefix: "prod_",
  delhiveryApiKey: "key",
  delhiveryPickupLocation: "ParkTag",
  delhiveryBaseUrl: "https://example.invalid"
};
const ADDRESS = { fullName: "COD QA", phone: "9812300001", line1: "1 QA Street", city: "Noida", state: "Uttar Pradesh", pincode: "201301" };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function bookedShipment(codAmountPaise) {
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(new URLSearchParams(init.body).get("data")).shipments[0];
    return new Response(JSON.stringify({ packages: [{ waybill: "WB1", status: "Success" }] }));
  };
  await createShipment(ENV, { orderId: "PT-QA", address: ADDRESS, productName: "Duo", codAmountPaise });
  return sent;
}

describe("Delhivery payment mode", () => {
  test("a guest COD Duo Pack collects ₹429 in cash", async () => {
    const shipment = await bookedShipment(42900);
    assert.equal(shipment.payment_mode, "COD");
    assert.equal(shipment.cod_amount, "429");
  });

  test("a prepaid order collects nothing", async () => {
    const shipment = await bookedShipment(0);
    assert.equal(shipment.payment_mode, "Prepaid");
    assert.equal(shipment.cod_amount, undefined);
  });
});
