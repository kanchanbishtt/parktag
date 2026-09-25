// The opt-in "Share where the car is" position: checked, rounded to ~110 m,
// named by the nearest landmark, and never an error when Ola is unavailable.
import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readCarLocation, resolveCarLocation, carMapUrl } from "../lib/core/car-location.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.OLA_MAPS_API_KEY; });

describe("car location", () => {
  test("rounds to 3 decimals and refuses junk", () => {
    assert.deepEqual(readCarLocation({ lat: 28.567712, lng: 77.323049 }), { lat: 28.568, lng: 77.323 });
    assert.equal(readCarLocation({ lat: "x", lng: 1 }), null);
    assert.equal(readCarLocation({ lat: 0, lng: 0 }), null);
    assert.equal(readCarLocation({ lat: 91, lng: 10 }), null);
    assert.equal(readCarLocation(null), null);
  });

  test("names the nearest landmark without state, PIN or country", async () => {
    process.env.OLA_MAPS_API_KEY = "k";
    let asked;
    globalThis.fetch = async (url, init) => {
      asked = { url: String(url), init };
      return { ok: true, json: async () => ({ results: [{ formatted_address: "Wave Mall, Pocket J, Sector 18, Noida, Uttar Pradesh 201301" }] }) };
    };
    const loc = await resolveCarLocation({ lat: 28.567712, lng: 77.323049 });
    assert.equal(loc.place, "Wave Mall, Sector 18, Noida");
    assert.equal(loc.lat, 28.568);
    assert.match(loc.mapToken, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(new URL(asked.url).searchParams.get("latlng"), "28.568,77.323", "only the rounded point leaves the server");
    assert.equal(asked.init.headers.Origin, "https://app.parktag.me");
    assert.equal(carMapUrl({ appBaseUrl: "https://app.parktag.me/" }, loc), `https://app.parktag.me/m/${loc.mapToken}.png`);
  });

  test("no key or a failed lookup still keeps the point, with no place name", async () => {
    const loc = await resolveCarLocation({ lat: 28.5, lng: 77.3 });
    assert.equal(loc.place, null);
    process.env.OLA_MAPS_API_KEY = "k";
    globalThis.fetch = async () => { throw new Error("down"); };
    assert.equal((await resolveCarLocation({ lat: 28.5, lng: 77.3 })).place, null);
  });
});
