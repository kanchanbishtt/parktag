// The opt-in "Share where the car is" position: checked, rounded to ~110 m,
// named by the nearest landmark, and never an error when Ola is unavailable.
import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readCarLocation, resolveCarLocation, carMapUrl, carMapLink } from "../lib/core/car-location.js";

const realFetch = globalThis.fetch;
const COMPONENTS = [
  { types: ["country"], long_name: "India" },
  { types: ["administrative_area_level_1"], long_name: "Uttar Pradesh" },
  { types: ["locality"], long_name: "Noida" },
  { types: ["sublocality"], long_name: "Sector 18" },
  { types: ["neighborhood"], long_name: "Pocket G" }
];
afterEach(() => { globalThis.fetch = realFetch; delete process.env.OLA_MAPS_API_KEY; });

describe("car location", () => {
  test("rounds to 4 decimals (~11 m) and refuses junk", () => {
    assert.deepEqual(readCarLocation({ lat: 28.567712, lng: 77.323049 }), { lat: 28.5677, lng: 77.323 });
    assert.equal(readCarLocation({ lat: "x", lng: 1 }), null);
    assert.equal(readCarLocation({ lat: 0, lng: 0 }), null);
    assert.equal(readCarLocation({ lat: 91, lng: 10 }), null);
    assert.equal(readCarLocation(null), null);
  });

  test("a nearby business is not a landmark: block, sector and city instead", async () => {
    process.env.OLA_MAPS_API_KEY = "k";
    let asked;
    globalThis.fetch = async (url, init) => {
      asked = { url: String(url), init };
      return { ok: true, json: async () => ({ results: [
        { name: "Xacco Global Hospitalities", types: ["lodging"], distance_meters: 30, address_components: COMPONENTS },
        { name: "Vatika", types: ["restaurant"], distance_meters: 10 }
      ] }) };
    };
    const loc = await resolveCarLocation({ lat: 28.570012, lng: 77.323049 });
    assert.equal(loc.place, "Pocket G, Sector 18, Noida");
    assert.equal(loc.pin, "Pocket G, Sector 18");
    assert.equal(loc.lat, 28.57);
    assert.match(loc.mapToken, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(new URL(asked.url).searchParams.get("latlng"), "28.57,77.323", "only the rounded point leaves the server");
    assert.equal(asked.init.headers.Origin, "https://app.parktag.me");
    assert.equal(carMapUrl({ appBaseUrl: "https://app.parktag.me/" }, loc), `https://app.parktag.me/m/${loc.mapToken}.png`);
  });

  test("a real landmark within 150 m leads", async () => {
    process.env.OLA_MAPS_API_KEY = "k";
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [
      { name: "Burger King", types: ["restaurant"], distance_meters: 20, address_components: COMPONENTS },
      { name: "Wave Mall", types: ["shopping_mall"], distance_meters: 90 },
      { name: "Far Hospital", types: ["hospital"], distance_meters: 400 }
    ] }) });
    const loc = await resolveCarLocation({ lat: 28.5681, lng: 77.323 });
    assert.equal(loc.place, "Wave Mall, Sector 18, Noida");
    assert.equal(loc.pin, "Wave Mall");
  });

  test("no key or a failed lookup still keeps the point, with no place name", async () => {
    const loc = await resolveCarLocation({ lat: 28.5, lng: 77.3 });
    assert.equal(loc.place, null);
    process.env.OLA_MAPS_API_KEY = "k";
    globalThis.fetch = async () => { throw new Error("down"); };
    assert.equal((await resolveCarLocation({ lat: 28.5, lng: 77.3 })).place, null);
  });

  test("the owner's map link names only the stored point, and nothing for junk", () => {
    assert.equal(
      carMapLink({ lat: 28.5677, lng: 77.323, place: null, mapToken: "x" }),
      "https://www.google.com/maps/search/?api=1&query=28.5677,77.323"
    );
    assert.equal(carMapLink({ lat: 28.567712, lng: 77.323049 }), "https://www.google.com/maps/search/?api=1&query=28.5677,77.323");
    assert.equal(carMapLink(null), null);
    assert.equal(carMapLink({ lat: 0, lng: 0 }), null);
    assert.equal(carMapLink({ place: "Wave Mall" }), null);
  });
});

describe("car map image", () => {
  test("draws the label with the bundled font, no system fonts needed", async () => {
    const { carMapSvg, composeCarMap } = await import("../lib/integrations/car-map.js");
    const { Resvg } = await import("@resvg/resvg-js");
    const blank = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#eee"/></svg>').render().asPng();
    assert.match(carMapSvg(blank, "Wave Mall <&>"), /Wave Mall &lt;&amp;&gt;/, "the label is escaped");
    const out = composeCarMap(blank, "Pocket G, Sector 18");
    assert.equal(out.subarray(1, 4).toString(), "PNG");
    const unlabelled = composeCarMap(blank, "");
    assert.ok(out.length > unlabelled.length, "text was actually drawn");
  });
});
