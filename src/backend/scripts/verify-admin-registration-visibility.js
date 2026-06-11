const BASE_URL = process.env.WAVETAG_VERIFY_BASE_URL || "http://127.0.0.1:3000";
const ADMIN_EMAIL = "admin@wavetag.local";
const ADMIN_PASSWORD = "demo1234";

function fail(message) {
  throw new Error(message);
}

async function postJson(url, body, extra = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(extra.headers || {})
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    fail(data.error || `Request failed: ${response.status}`);
  }

  return { response, data };
}

async function getJson(url, extra = {}) {
  const response = await fetch(url, {
    headers: extra.headers || {}
  });

  const data = await response.json();

  if (!response.ok) {
    fail(data.error || `Request failed: ${response.status}`);
  }

  return { response, data };
}

async function main() {
  await postJson(`${BASE_URL}/api/demo/seed`, {});

  const login = await postJson(`${BASE_URL}/api/auth/login`, {
    role: "admin",
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });

  const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];

  if (!cookie) {
    fail("Admin session cookie was not returned");
  }

  const suffix = String(Date.now()).slice(-6);
  const displayName = `Owner ${suffix}`;
  const email = `owner${suffix}@example.com`;

  const registration = await postJson(`${BASE_URL}/api/register-owner`, {
    displayName,
    email,
    password: "demo1234",
    phone: "+919999999999",
    vehicleLabel: "Test Car",
    plateNumber: `DL01AB${suffix.slice(-4)}`,
    stickerRequested: true
  });

  const overview = await getJson(`${BASE_URL}/api/admin/overview`, {
    headers: { cookie }
  });

  const ownerEntry = overview.data.owners.find((item) => item.email === email);
  const registrationEntry = overview.data.recentRegistrations?.find(
    (item) => item.email === email
  );

  if (!ownerEntry) {
    fail("Registered owner is missing from admin owners list");
  }

  if (!registrationEntry) {
    fail("Registered owner is missing from admin recent registrations");
  }

  if (ownerEntry.tags < 1 || ownerEntry.activeTags < 1) {
    fail("Registered owner did not surface with an active tag in admin overview");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        registeredOwner: registration.data.owner,
        registeredTag: {
          token: registration.data.tag.token,
          printStatus: registration.data.tag.printStatus
        },
        adminOwnerEntry: ownerEntry,
        adminRegistrationEntry: registrationEntry
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
