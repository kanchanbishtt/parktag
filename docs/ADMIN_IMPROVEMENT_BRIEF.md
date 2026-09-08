# ParkTag admin panel: improvement brief

Use this as the opening prompt for a coding session. It describes what the admin panel at app.parktag.me/admin is missing, how each piece should behave, and the rules for building it in this repo. Work through the phases in order. Do not start a phase until the previous one is merged.

## Context you need first

- Backend: Fastify in `src/backend`, ES modules. Pages are plain HTML in `src/frontend/pages`, scripts in `src/frontend/scripts`, styles in `src/frontend/styles`. No framework on the frontend. Admin pages live under `src/frontend/pages/admin/` and are guarded by `guardAdmin` in `src/backend/app.js`.
- Database: MongoDB. Collections come from `getCollections` in `src/backend/lib/db/repositories.js`. Orders are in `shopOrders`. Order status values in use: `created` (abandoned checkout), `paid`, `cod`. Soft deletion uses a `deletedAt` field; never hard delete.
- Fulfilment: `src/backend/lib/core/order-fulfilment.js` runs when an order becomes `paid` or `cod`. It books a Delhivery waybill via `createShipment` in `src/backend/lib/integrations/delhivery.js`, stores `waybill` and `shipmentBookedAt` on the order, notifies the buyer, and sends a Purchase event to Meta. It does not request a pickup and never checks the shipment again.
- Prices are server-authoritative. The catalogue is `SHOP_PRODUCTS` in `src/backend/lib/integrations/payments.js`. The client sends a product id, never an amount. Keep it that way.
- Tests: `node --test` under `src/backend/tests`. Integration tests boot the app with `startTestApp` from `tests/helpers.js`, which requires `MONGODB_COLLECTION_PREFIX` matching `^(test|ci)[_-]`. CI runs them. Write tests first for every route you add.
- Read `docs/SHOP_LOGIN_WALL.md` and `docs/ANALYTICS_EVENTS.md` before touching checkout or analytics.

## House rules

- No em-dashes anywhere, in code comments, copy or commit messages.
- No AI attribution in commits, PRs or code.
- Commits: `type: description` (feat, fix, refactor, docs, test, chore).
- Branch from `main`, one pull request per phase, CI green before merge.
- Every new page must be usable on a phone. Girish checks orders from his phone.
- Never print or log a full phone number, address or payment id in a place a logged-out user could reach.
- Verify by outcome, not by reading: after each phase, exercise the feature on a local run and, after deploy, on production with a real record.

## Phase 1: Orders

The panel has no orders page. Build one.

**Page `/admin/orders`** listing every order in `shopOrders` that is not soft-deleted, newest first, with filters for status and a search box over order number, buyer name and mobile. Each row: order number, product name, amount, payment method (prepaid or COD), status, waybill with a link to `delhivery.com/track/package/<waybill>`, buyer name and mobile, placed date, last shipment status and its time.

**Order statuses.** Extend the vocabulary and make transitions explicit: `created` (checkout abandoned), `paid`, `cod`, `booked` (waybill created), `picked_up`, `in_transit`, `delivered`, `rto` (returned to origin), `cancelled`, `refunded`. Keep `paid` and `cod` as the payment facts; add a separate `shipmentStatus` field for the courier lifecycle rather than overloading `status`. Do not rewrite historical documents beyond adding the new field.

**Pickup request.** After `createShipment` succeeds, call Delhivery's pickup request API for the next working day and store `pickupRequestedFor` on the order. If the request fails, store `pickupError` and surface it in the row. The 4 August order PT-260804-00006 died because a label was created and no pickup was ever requested.

**Tracking sync.** A scheduled job, hourly is enough, that calls `trackShipment` for every order with a waybill and a non-final shipment status, stores the latest scan as `shipmentStatus`, `shipmentStatusAt` and `shipmentLocation`, and appends to a `shipmentScans` array. Final statuses: delivered, rto, cancelled. If Delhivery offers a webhook for this account, prefer the webhook and keep the poll as a backstop.

**Manual order.** A form on the orders page: buyer name, mobile, address (reuse the fields from `src/frontend/scripts/owner/address-step.js`), product from the catalogue, payment method (UPI, cash, bank transfer, COD) and payment reference, and an optional existing waybill. It creates a `shopOrders` document with `channel: "manual"`, status `paid` or `cod`, and runs the same fulfilment path as a shop order unless a waybill was supplied. Offline WhatsApp sales must end up here before the parcel is booked.

**Order detail view.** Click a row to see everything: buyer, address, payment, the tag serial linked to the order if known, shipment scans, and the action buttons from Phase 3.

**Acceptance:** an order placed on the shop appears within seconds; its pickup is requested automatically; its row updates to picked up and delivered without anyone touching the panel; a manual order can be entered from a phone in under a minute.

## Phase 2: Leads and alerts

**Abandoned checkouts.** A list of `created` orders from the last 30 days that never became `paid` or `cod`, with buyer mobile, product, how far they got (address given, payment opened, payment dismissed) and a WhatsApp button that opens a prefilled message. To know how far they got, record checkout steps on the order: `addressSubmittedAt`, `paymentOpenedAt`, `paymentDismissedAt`. The guest checkout in `src/frontend/scripts/shop.js` and the dashboard checkout both need to send these.

**New-order alert.** When an order becomes `paid` or `cod`, send a message to the admin WhatsApp number or Telegram (whichever env already has a working integration) with order number, product, amount, payment method and buyer city. Also alert on `pickupError` and on `rto`.

**Acceptance:** an abandoned checkout is visible with the step where the buyer stopped; a real order produces an alert on Girish's phone within a minute.

## Phase 3: Order actions

On the order detail view: cancel (with reason), mark refunded (with reference; refunds themselves are issued in Razorpay), re-ship (books a new waybill and pickup, keeps the old one in history), download label (fetch from Delhivery and serve as PDF), resend confirmation to the buyer, mark as test (hides from counts and lists by default). Every action writes to the existing activity log with the admin's email.

**Acceptance:** each action is a single tap, is reversible where possible, and is recorded with who did it and when.

## Phase 4: Money, stock, funnel

**COD reconciliation.** A page listing COD orders with delivered status, the amount Delhivery should remit, and a field to record the remittance date and amount from Delhivery's COD statement. Show outstanding total.

**Stock.** A single number, tags on hand, maintained as printed batches minus tags attached to shipped orders, with a manual adjustment entry for counts. Show it on the overview.

**Funnel.** On the traffic page, add the shop funnel by day and by source: landing visits, shop views, checkouts started, orders paid. Source comes from the landing beacon's referrer host and the UTM parameters, so record `utm_source`, `utm_medium` and `utm_campaign` on the landing visit and carry them onto the order via the session.

## Things not to do

- Do not add a frontend framework. The admin pages are plain HTML and JS by design.
- Do not let the client send prices or totals.
- Do not hard delete orders, owners or tags.
- Do not change the CSP in `src/backend/app.js` or `landing/next.config.ts` without loading the live page afterwards and confirming analytics hits arrive. Two silent outages came from exactly this.
- Do not build Phase 4 before Phase 1 is in production and has handled at least one real order end to end.
