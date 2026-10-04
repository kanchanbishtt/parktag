# Admin MCP server

Run the admin panel from Claude: reports, UTM links, promo codes, tags, print queue, reviews, marketing demo units,
sticker designs. It is a remote MCP server on the backend itself.

```
https://app.parktag.me/mcp
```

## Connect Claude

1. Claude > Settings > Connectors > Add custom connector. Name it anything, URL as above. Leave the OAuth client ID and
   secret blank (the client registers itself).
2. Claude opens ParkTag. Sign in as an admin (the normal admin sign-in, bot check included), pick what it may do, Approve.
   The screen preselects `read`; choose `ops` there if you want it to make changes.
3. Done. The connection shows on the admin Tokens page as `Claude (OAuth)`.

Claude Code: `claude mcp add --transport http parktag-admin https://app.parktag.me/mcp`, then `/mcp` > authenticate.

A ParkTag API token pasted as `Authorization: Bearer ptk_...` also works on `/mcp`, for clients that cannot do OAuth.

## What a connection may do

Chosen on the consent screen, and the tools list shrinks to match. Scopes include the ones before them.

| Scope | Adds |
|---|---|
| `read` | overview, traffic, sales by UTM, reconciliation, promo codes, shop settings, tags, batches, print queue, activations, activity, marketing, sticker designs, reviews |
| `write` | create/update/activate/revoke promo codes, the dashboard-plate setting |
| `ops` | issue tags, tag active/inactive, mark tag/run printed, marketing add/sold/deactivate, approve reviews, log activation reminders, publish/unpublish a sticker design |

Never reachable this way, by design: deleting tags, batches or designs; saving a design; PDF/QR/door-hanger exports;
admins, owners, the audit log; token management. Those need a signed-in browser.

## How it is built

- **The access token is an API token** (`lib/auth/api-token.js`). The route allowlist, scope check, expiry, revocation and
  audit log are the ones that already guard `/api/admin`. Tools call those routes in-process with the caller's own token
  (`mcp/client.js`), so there is no second way into the admin.
- **One row per connection.** Access tokens last one hour; a refresh (single use) rotates that row's token in place.
  Revoking the row on the Tokens page ends the connection: the next refresh fails.
- **Refresh reuse ends the connection.** A refresh token is marked used, not deleted. Presenting a used one means two
  parties hold the same chain, so the connection is revoked and the admin must approve again. If a refresh response is
  ever lost in transit, expect to reconnect once.
- **Hard stop at 90 days.** Refreshing never extends a connection past 90 days from consent, the same ceiling as a token
  minted by hand. After that, approve again.
- **Open registration, narrow redirects.** Anyone can register a client, but the only redirects accepted are Claude's
  exact callback (`https://claude.ai/api/mcp/auth_callback`, and the `claude.com` equivalent) and loopback addresses.
  Clients are public with PKCE S256 only, and approval needs an admin session. The consent screen shows the full redirect
  address and says the app's name is not verified. Clients expire 90 days after last use; when the table is full the
  oldest never-used ones are evicted, and a client that has completed a grant never is.
- **Customer text is untrusted.** Reviews, contact history and similar come from buyers. Tool descriptions say so, and
  `read` is the preselected scope. A connection with `write` or `ops` that reads hostile text could be talked into using
  those tools, so grant the least you need.
- **Audit.** Approving and declining are logged, and every write through a connection is logged as
  `via Claude (OAuth)`.

## Endpoints

| | |
|---|---|
| `POST /mcp` | MCP over Streamable HTTP, stateless. 401 with `WWW-Authenticate` pointing at the metadata below |
| `GET /.well-known/oauth-protected-resource[/mcp]` | which authorization server guards `/mcp` |
| `GET /.well-known/oauth-authorization-server` | endpoints and capabilities |
| `POST /oauth/register` | dynamic client registration |
| `GET/POST /oauth/authorize` | sign-in redirect, consent screen, decision |
| `POST /oauth/token` | `authorization_code` and `refresh_token` |

Code: `routes/oauth`, `routes/mcp`, `lib/auth/oauth.js`, `mcp/`. Tests: `tests/oauth.test.js`, `tests/oauth-mcp.test.js`.

The older stdio server (`parktag-admin-mcp`) still works with a pasted token. Its tools are the same ones; this
endpoint is the maintained copy.
