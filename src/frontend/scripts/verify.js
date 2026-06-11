async function loadJson(url, outputId) {
  const output = document.getElementById(outputId);

  try {
    const response = await fetch(url);
    const data = await response.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown fetch error"
      },
      null,
      2
    );
  }
}

async function sendJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  return response.json();
}

async function seedDemoData() {
  const output = document.getElementById("seed-output");
  output.textContent = "Loading...";
  const data = await sendJson("/api/demo/seed", "POST", {});
  output.textContent = JSON.stringify(data, null, 2);
}

async function showCredentials() {
  await loadJson("/api/demo/credentials", "credentials-output");
}

async function resolveTag() {
  const token = document.getElementById("tag-token").value;
  await loadJson(`/api/tags/${token}`, "tag-output");
}

async function createContactRequest() {
  const token = document.getElementById("request-token").value;
  const phone = document.getElementById("request-phone").value;
  const output = document.getElementById("request-output");
  output.textContent = "Loading...";

  const data = await sendJson("/api/contact-requests", "POST", {
    token,
    phone
  });

  output.textContent = JSON.stringify(data, null, 2);
}

await loadJson("/api/health", "health-output");
await loadJson("/api/runtime/status", "status-output");
await showCredentials();

document.getElementById("seed-button").addEventListener("click", seedDemoData);
document.getElementById("resolve-tag-button").addEventListener("click", resolveTag);
document
  .getElementById("create-request-button")
  .addEventListener("click", createContactRequest);
