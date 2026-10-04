// The remote admin MCP server: POST /mcp, Streamable HTTP, stateless (a fresh server per request, nothing held between
// calls, so any replica can answer and a deploy drops nothing).
//
// Credential: a ptk_ API token as a Bearer, either one an admin minted on the Tokens page or one issued by the OAuth
// flow (routes/oauth). Without a usable one the answer is 401 with a WWW-Authenticate header pointing at the OAuth
// metadata, which is how Claude discovers it should start the sign-in.
//
// Tools run through the normal /api/admin routes in-process with the caller's own token (mcp/client.js), so the
// route allowlist, scope check, rate limits and audit log are the ones that already guard those routes.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { SCOPES, resolveApiToken } from "../../lib/auth/api-token.js";
import { requireSession } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import { createInternalClient } from "../../mcp/client.js";
import { registerTools } from "../../mcp/tools.js";

const jsonRpcError = (code, message) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

const ARGS_MAX = 1000;
const clipArgs = (args) => {
  const json = JSON.stringify(args ?? {});
  return json.length > ARGS_MAX ? `${json.slice(0, ARGS_MAX)}...[cut]` : json;
};

export function registerMcpRoutes(app, env) {
  const base = String(env.appBaseUrl).replace(/\/+$/, "");
  const challenge = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    config: { rateLimit: { max: 300, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      let found;
      let collections;
      try {
        collections = await getCollections(env);
        found = collections ? await resolveApiToken(collections, request) : null;
      } catch {
        reply.code(503);
        return jsonRpcError(-32000, "Service temporarily unavailable. Please try again.");
      }
      if (!found?.session || !SCOPES.includes(found.session.scope)) {
        reply.code(401).header("www-authenticate", challenge);
        return jsonRpcError(-32001, "Authentication required.");
      }
      // Stateless: there is no session to resume or end, and no server-initiated stream.
      if (request.method !== "POST") {
        reply.code(405).header("allow", "POST");
        return jsonRpcError(-32000, "Method not allowed.");
      }

      const server = new McpServer({ name: "parktag-admin", version: "1.0.0" });
      registerTools(server, {
        api: createInternalClient(app, { authorization: request.headers.authorization, remoteAddress: request.ip }),
        baseUrl: base,
        scope: found.session.scope,
        onCall: (call) => {
          const { session, token } = found;
          collections.mcpCalls.insertOne({
            at: new Date(), adminId: session.userId, email: session.email, tokenId: session.tokenId, tokenName: session.tokenName,
            clientId: token.oauthClientId ?? null, scope: session.scope, ip: request.ip ?? null,
            tool: call.tool, args: clipArgs(call.args), isError: call.isError, error: call.error, ms: call.ms, bytes: call.bytes
          }).catch((error) => request.log.warn({ err: error?.message }, "[mcp] could not record a tool call"));
        }
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      reply.raw.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });

      reply.hijack();
      try {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        request.log.error({ err: error }, "[mcp] request failed");
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { "content-type": "application/json" });
          reply.raw.end(JSON.stringify(jsonRpcError(-32603, "Internal server error.")));
        }
      }
    }
  });
  // Newest first. Cookie-only: this route is not on the API-token allowlist, so a connection cannot read its own trail.
  app.get("/api/admin/mcp-calls", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;
    const collections = await getCollections(env);
    if (!collections) { reply.code(503); return { ok: false, error: "Database is not available." }; }

    const limit = Math.min(Math.max(Number.parseInt(request.query?.limit, 10) || 50, 1), 200);
    const filter = typeof request.query?.tool === "string" && request.query.tool ? { tool: request.query.tool } : {};
    const calls = await collections.mcpCalls.find(filter, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray();
    return { ok: true, calls };
  });
}
