# ParkTag Slack operator commands

The existing n8n logger continues posting alerts. `/parktag` calls the backend directly and replies privately to the operator. It does not need access to Slack message history or an additional bot token.

## Commands

| Command | Result |
| --- | --- |
| `/parktag help` | Usage |
| `/parktag tag PT-Batch-002-000007` | Batch, linked owner, vehicle, activation and order |
| `/parktag track PT-260917-00027` | Delhivery status; a waybill also works |
| `/parktag order PT-260917-00027` | Payment, shipping and currently linked stickers |
| `/parktag customer +91XXXXXXXXXX` | Customer's tags and recent orders |
| `/parktag batch Batch-002` | Counts by status; test batch labelled |
| `/parktag activate PT-Batch-002-000007` | Resume an already owned tag |
| `/parktag deactivate PT-Batch-002-000007` | Stop contact while keeping its owner |
| `/parktag reset PT-Batch-002-000007 confirm` | Unlink owner and clear vehicle details |
| `/parktag sales` | Today/month paid and COD order totals in IST |

Reset keeps the printed QR, internal-test flag and physical batch identity. It preserves the customer account and historical order assignment, archives the old tag record without its secret token, and revokes scanner grants/pending calls. Tags with vault documents or membership orders are blocked for admin review. MongoDB must support transactions (production Atlas does); failure aborts the reset. No real tag is reset during setup.

Activation is resuming a linked tag, not bypassing a new customer's OTP. Pausing an owned tag does not make it claimable. Public claims use an atomic unowned/status guard to avoid overwriting ownership.

Tracking uses the existing 15-minute cache and may show an older saved snapshot if Delhivery is unavailable; the timestamp is included. Sales excludes internal/giveaway orders. COD is an order total, not proof of cash collection. Amazon orders are outside this ledger.

## Setup

In the existing Demo App (`A09KYP5U51B`) in Edittree:

1. Create `/parktag` with Request URL `https://app.parktag.me/api/integrations/slack/commands`.
2. Description: `Track shipments and manage ParkTag stickers`; usage hint: `help | tag | track | order | customer | batch | activate | deactivate | reset | sales`.
3. Leave escaping off. Add/install the `commands` scope if Slack requests it; preserve the existing logger scopes.
4. Set backend Railway variables: `SLACK_SIGNING_SECRET` from Basic Information, `SLACK_TEAM_ID=T05AEFR59TM`, `SLACK_CHANNEL_ID=C0C09P0NBD3`, `SLACK_ADMIN_USER_IDS=U05B4AM9JHE`.
5. Deploy the reviewed commit. Run `/parktag help`, then the tag/track lookups in #parktag-logger. Confirm private replies. Do not use a real reset as a smoke test.

The endpoint fails closed without configuration. It verifies Slack's HMAC over the original body and rejects timestamps more than five minutes old. Only the configured workspace, channel and operators can execute commands. Callbacks are limited to Slack's HTTPS response URL for that workspace.

Commands are acknowledged before work starts. Mongo records deduplicate repeated deliveries and provide an operator/action audit. Background execution is process-local; a restart can interrupt it. The response URL is not saved. If a command gets no final reply, look up the tag/order before retrying, and inspect `slack_commands` by the request ID. Do not automatically replay destructive commands.

## Validation

Run unit tests with `node --test src/backend/tests/slack-commands.test.js`. Integration tests require a disposable collection prefix matching `test_`/`ci_`, plus MongoDB configuration. `slack-operations.integration.test.js` tests real public routes, ownership retention, reset archiving and revocation, and vault/membership guards. Two transaction tests explicitly skip on standalone MongoDB in CI; all passed locally with an isolated Atlas test prefix.

### Reply presentation

Replies use private Block Kit sections with dividers and a text fallback. Help groups lookup, shipment and tag-management commands. Offset-bearing timestamps display in IST; provider timestamps without a timezone retain their original text. Background commands acknowledge with an empty HTTP 200 and send one private result.
