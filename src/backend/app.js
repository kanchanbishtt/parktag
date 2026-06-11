import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { getEnv } from "./lib/env.js";
import { readSession } from "./lib/session.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDemoRoutes } from "./routes/demo.js";
import { registerOwnerRoutes } from "./routes/owner.js";
import { registerProviderRoutes } from "./routes/provider.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerRegistrationRoutes } from "./routes/registration.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const frontendRoot = path.resolve(currentDir, "../frontend");
const pagesRoot = path.join(frontendRoot, "pages");
const scannerPage = path.join(pagesRoot, "index.html");
const verifyPage = path.join(pagesRoot, "verify.html");
const ownerPage = path.join(pagesRoot, "owner.html");
const adminPage = path.join(pagesRoot, "admin.html");
const adminOverviewPage = path.join(pagesRoot, "admin-overview.html");
const adminIssuancePage = path.join(pagesRoot, "admin-issuance.html");
const adminPrintQueuePage = path.join(pagesRoot, "admin-print-queue.html");
const adminOwnersPage = path.join(pagesRoot, "admin-owners.html");
const adminActivityPage = path.join(pagesRoot, "admin-activity.html");
const adminAdminsPage = path.join(pagesRoot, "admin-admins.html");
const registerOwnerPage = path.join(pagesRoot, "register-owner.html");
const ownerLoginPage = path.join(pagesRoot, "owner-login.html");
const hubPage = path.join(pagesRoot, "hub.html");
const scannerAssetVersion = "scanner-shell-20";
const hubAssetVersion = "hub-shell-1";

function setScannerNoCache(reply) {
  reply.header(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
}

export async function buildApp() {
  const env = getEnv();
  const app = Fastify({
    logger: true
  });

  app.decorate("sessions", new Map());

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (request, body, done) => {
      const params = new URLSearchParams(body);
      const data = Object.fromEntries(params.entries());
      done(null, data);
    }
  );

  await app.register(fastifyCookie);

  await app.register(fastifyStatic, {
    root: frontendRoot,
    prefix: "/"
  });

  app.get("/", async (request, reply) => {
    const html = await fs.readFile(hubPage, "utf8");
    reply.type("text/html");
    return html.replaceAll("__HUB_ASSET_VERSION__", hubAssetVersion);
  });

  app.get("/hub", async (_request, reply) => {
    const html = await fs.readFile(hubPage, "utf8");
    reply.type("text/html");
    return html.replaceAll("__HUB_ASSET_VERSION__", hubAssetVersion);
  });

  app.get("/verify", async (_request, reply) => {
    const html = await fs.readFile(verifyPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/owner", async (request, reply) => {
    const session = readSession(app, request);

    if (!session || session.role !== "owner") {
      const html = await fs.readFile(ownerLoginPage, "utf8");
      reply.type("text/html");
      return html;
    }

    const html = await fs.readFile(ownerPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/register-owner", async (_request, reply) => {
    const html = await fs.readFile(registerOwnerPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/admin", async (request, reply) => {
    const session = readSession(app, request);

    if (session && session.role === "admin") {
      reply.redirect("/admin/overview");
      return;
    }

    const html = await fs.readFile(adminPage, "utf8");
    reply.type("text/html");
    return html;
  });

  async function guardAdmin(request, reply, pagePath) {
    const session = readSession(app, request);

    if (!session || session.role !== "admin") {
      reply.redirect("/admin");
      return;
    }

    const html = await fs.readFile(pagePath, "utf8");
    reply.type("text/html");
    return html;
  }

  app.get("/admin/overview", async (request, reply) => {
    return guardAdmin(request, reply, adminOverviewPage);
  });

  app.get("/admin/issuance", async (request, reply) => {
    return guardAdmin(request, reply, adminIssuancePage);
  });

  app.get("/admin/print-queue", async (request, reply) => {
    return guardAdmin(request, reply, adminPrintQueuePage);
  });

  app.get("/admin/owners", async (request, reply) => {
    return guardAdmin(request, reply, adminOwnersPage);
  });

  app.get("/admin/activity", async (request, reply) => {
    return guardAdmin(request, reply, adminActivityPage);
  });

  app.get("/admin/admins", async (request, reply) => {
    return guardAdmin(request, reply, adminAdminsPage);
  });

  app.get("/vehicle/:token([A-Za-z0-9]{12})", async (_request, reply) => {
    const html = await fs.readFile(scannerPage, "utf8");
    setScannerNoCache(reply);
    reply.type("text/html");
    return html.replaceAll("__SCANNER_ASSET_VERSION__", scannerAssetVersion);
  });

  registerRuntimeRoutes(app, env);
  registerDemoRoutes(app, env);
  registerPublicRoutes(app, env);
  registerProviderRoutes(app, env);
  registerRegistrationRoutes(app, env);
  registerAuthRoutes(app, env);
  registerOwnerRoutes(app, env);
  registerAdminRoutes(app, env);

  return app;
}
