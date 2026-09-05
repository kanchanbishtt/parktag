// What `request.ip` and `request.protocol` are, behind one reverse proxy.
//
// Nearly every abuse control in this app keys on request.ip — every per-route
// rate limit, the credential-spray lockout, the plate last-4 counters — and the
// session cookie's Secure flag falls back to request.protocol. Both are
// computed by Fastify from the trustProxy setting, which means that one option
// silently decides whether those controls work at all.
//
// It has already broken once. app.js used `trustProxy: 1`, and fastify 5.12.3 —
// the release fixing GHSA-3m5p-2c4r-xxw2, the very X-Forwarded-* spoof the
// setting exists to prevent — changed what a NUMBER means. On that version `1`
// stopped trusting the proxy at all: request.ip became the edge's address for
// every caller, which collapses every per-IP limit into ONE shared bucket and
// lets a single abuser rate-limit the entire userbase. Nothing failed loudly;
// one unrelated-looking cookie test went red.
//
// So this pins the behaviour rather than the option. A real socket, not
// app.inject(): inject resolved these differently from a real connection on one
// of the two versions, which is exactly the discrepancy that would hide a
// regression.
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

const CLIENT = "203.0.113.9";
const ATTACKER = "198.51.100.7";

let app;
let base;

before(async () => {
  // The same predicate app.js passes. Imported by value rather than from the
  // app because building the app needs a database; the contract under test is
  // this option's behaviour, not the routes on top of it.
  app = Fastify({ trustProxy: (_address, hop) => hop === 0 });
  app.get("/whoami", async (request) => ({ ip: request.ip, protocol: request.protocol }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${app.server.address().port}/whoami`;
});

after(async () => { await app?.close(); });

async function ask(headers) {
  const response = await fetch(base, { headers });
  return response.json();
}

describe("one reverse proxy in front, and nothing beyond it trusted", () => {
  test("the client's real address is read from the proxy's header", async () => {
    const { ip } = await ask({ "x-forwarded-for": CLIENT });
    assert.equal(
      ip,
      CLIENT,
      "request.ip is not the caller — every per-IP limit now shares one bucket, " +
        "so a single abuser can rate-limit everybody"
    );
  });

  // The attack the setting exists to stop. A caller can send any header they
  // like; only the entry OUR proxy appended may be believed.
  test("an address the caller prepended is ignored", async () => {
    const { ip } = await ask({ "x-forwarded-for": `${ATTACKER}, ${CLIENT}` });
    assert.equal(
      ip,
      CLIENT,
      "a caller-supplied X-Forwarded-For entry was believed — rate limits and " +
        "the spray lockout can be bypassed by rotating a header"
    );
  });

  test("a long forged chain does not help either", async () => {
    const { ip } = await ask({
      "x-forwarded-for": `10.0.0.1, 10.0.0.2, ${ATTACKER}, ${CLIENT}`
    });
    assert.equal(ip, CLIENT);
  });

  test("with no header at all it falls back to the peer", async () => {
    const { ip } = await ask({});
    assert.equal(ip, "127.0.0.1");
  });

  // Feeds the session cookie's Secure flag: TLS terminates at the proxy, so the
  // connection to this process is plain HTTP and the scheme is only knowable
  // from the header.
  test("the scheme survives TLS terminating at the proxy", async () => {
    const { protocol } = await ask({ "x-forwarded-proto": "https", "x-forwarded-for": CLIENT });
    assert.equal(
      protocol,
      "https",
      "request.protocol is not https behind a TLS-terminating proxy — the " +
        "session cookie loses its connection-derived Secure flag"
    );
  });
});

// `true` and a plain number are the two obvious things to reach for, and both
// are wrong here in different ways. Asserted so the reasoning survives the
// person who reads app.js next and thinks the predicate looks overwrought.
describe("the alternatives, and why they are not used", () => {
  test("trustProxy: true believes whatever the caller prepends", async () => {
    const loose = Fastify({ trustProxy: true });
    loose.get("/whoami", async (request) => ({ ip: request.ip }));
    await loose.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(`http://127.0.0.1:${loose.server.address().port}/whoami`, {
        headers: { "x-forwarded-for": `${ATTACKER}, ${CLIENT}` }
      });
      const { ip } = await response.json();
      assert.equal(ip, ATTACKER, "trustProxy:true no longer trusts the whole chain — recheck app.js");
    } finally {
      await loose.close();
    }
  });
});
