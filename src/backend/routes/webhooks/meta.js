import { getCollections } from "../../lib/db/repositories.js";
import { verifyMetaWebhookSignature } from "../../lib/integrations/meta.js";
import { isNonEmptyString, safeEqual, maskIdentifier } from "../../lib/auth/security.js";
import { toE164 } from "../../lib/core/phone.js";
import { recordDeliveryStatus } from "../../lib/core/message-log.js";
import { serviceWindowUntil } from "../../lib/core/messaging-consent.js";

export function registerMetaWebhookRoutes(app, env) {
  // Meta sends a GET request to verify the webhook URL is real.
  // Must echo back hub.challenge if hub.verify_token matches.
  app.get("/api/provider/meta/webhook", async (request, reply) => {
    const mode      = request.query["hub.mode"];
    const token     = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    // Fail CLOSED when no verify token is configured. The check used to be a
    // bare `token === env.metaWhatsappWebhookVerifyToken`, and that env var
    // defaults to "" — so a request carrying `hub.verify_token=` compared ""
    // against "" and PASSED, letting anyone complete Meta's verification
    // handshake against this endpoint and have it echo back any challenge they
    // chose. (Confirmed: it returned 200 with the attacker's own value.)
    if (!isNonEmptyString(env.metaWhatsappWebhookVerifyToken)) {
      request.log.error(
        "[meta webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured — refusing webhook verification."
      );
      reply.code(403);
      return { ok: false, error: "Webhook not configured" };
    }

    // Constant-time compare so the token can't be recovered a character at a
    // time by timing the responses.
    if (
      mode === "subscribe" &&
      isNonEmptyString(token) &&
      safeEqual(token, env.metaWhatsappWebhookVerifyToken)
    ) {
      reply.type("text/plain");
      return reply.send(challenge);
    }

    reply.code(403);
    return { ok: false, error: "Verification token mismatch" };
  });

  // Meta POSTs delivery status updates here after each message.
  // Statuses: sent, delivered, read, failed
  app.post("/api/provider/meta/webhook", async (request, reply) => {
    // Authenticate the caller as Meta before touching the DB. Without this,
    // anyone who finds this URL can POST arbitrary `entry[].changes[].value`
    // payloads and flip the status of any contact-request record (matched by
    // `providerRequestId`, which is echoed back to owners/admins).
    if (env.metaAppSecret) {
      const signature = request.headers["x-hub-signature-256"];
      if (!verifyMetaWebhookSignature(env, request.rawBody, signature)) {
        reply.code(401);
        return { ok: false, error: "Invalid signature" };
      }
    } else if (env.runtimeMode === "production") {
      // No app secret in production — fail CLOSED. Anyone could otherwise POST
      // forged delivery statuses. (Production also refuses to boot without this
      // secret — see REQUIRED_IN_PRODUCTION in lib/env.js; this is the backstop
      // in case APP_ENV is misconfigured.)
      request.log.error(
        "[meta webhook] META_APP_SECRET is not configured in production — rejecting unauthenticated webhook."
      );
      reply.code(401);
      return { ok: false, error: "Webhook not configured" };
    } else {
      // Dev only — log loudly rather than silently accepting unverified writes.
      request.log.warn(
        "[meta webhook] META_APP_SECRET is not configured — webhook signature is NOT being verified."
      );
    }

    // Storage is best effort, and deliberately cannot stop the logging below.
    //
    // Two separate bugs met here. One: OTP sends never create a contactRequest
    // (sendOtp discards the wamid), so every sent/delivered/FAILED callback for
    // a verification code matched no row, was swallowed by the .catch further
    // down, and vanished without a line anywhere — Meta was reporting the
    // reason on every one and nothing was listening. Two: `getCollections`
    // THROWS when Mongo is unreachable rather than returning null, so the
    // `if (!collections) return` that used to sit here never guarded an outage
    // at all; the throw escaped and Meta got a 500. Meta retries 500s and
    // eventually disables a webhook that keeps producing them, which would
    // silently cost every delivery status for every message.
    //
    // So: never throw out of this handler, and log the status whether or not
    // the database is reachable.
    let collections = null;
    try {
      collections = await getCollections(env);
    } catch (err) {
      request.log.error(
        { err },
        "[meta webhook] statuses will be logged but NOT stored — the database is unreachable"
      );
    }

    const body = request.body || {};

    // Meta wraps everything in entry[].changes[]
    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value    = change.value || {};
        const statuses = value.statuses || [];

        for (const s of statuses) {
          const messageId = s.id;        // wamid — matches providerRequestId stored at send time
          const status    = s.status;    // sent | delivered | read | failed
          const timestamp = s.timestamp; // unix seconds

          if (!messageId || !status) continue;

          // The wamid is an opaque provider id, safe to log and the only way to
          // tie a log line back to one send. The recipient is a customer's phone
          // number, so it is masked — the same rule the OTP logger follows.
          const error = s.errors?.[0];
          if (status === "failed") {
            request.log.error(
              {
                messageId,
                to: maskIdentifier(s.recipient_id || ""),
                code: error?.code,
                title: error?.title,
                // Meta puts the actionable sentence here, not in `title`.
                detail: error?.error_data?.details || error?.message
              },
              "[meta webhook] message delivery FAILED"
            );
          } else {
            request.log.info(
              { messageId, to: maskIdentifier(s.recipient_id || ""), status },
              "[meta webhook] message status"
            );
          }

          const set = {
            provider: "meta",
            providerWebhookStatus: status,
            updatedAt: new Date().toISOString()
          };

          // Map Meta statuses to our internal status field
          if (status === "delivered") set.status = "delivered";
          else if (status === "read")  set.status = "read";
          else if (status === "failed") {
            set.status = "provider_failed";
            if (error) {
              set.providerError     = error.message || "Delivery failed";
              set.providerErrorDetail = `${error.code}: ${error.title || ""}`.trim();
            }
          }

          if (timestamp) set.providerTimestamp = Number(timestamp);

          // A miss is normal, not an error: OTP statuses have no row to update.
          if (collections) {
            await collections.contactRequests.updateOne(
              { providerRequestId: messageId },
              { $set: set }
            ).catch(() => null);

            // The message log, which unlike contactRequests has a row for
            // EVERY send. This is what closes the gap the comment above
            // describes: an OTP status used to match nothing anywhere and
            // vanish, with Meta reporting a reason nobody was listening to.
            await recordDeliveryStatus(collections, {
              wamid: messageId,
              status,
              at: timestamp ? new Date(Number(timestamp) * 1000) : new Date()
            }).catch(() => null);
          }
        }

        // ── Inbound messages ────────────────────────────────────────────
        //
        // Dropped on the floor until now: this handler read `statuses` and
        // ignored `messages` entirely, so a customer who replied got silence
        // and a customer who typed STOP kept receiving.
        //
        // Two things are recorded, and both are load-bearing rather than nice
        // to have. Opt-out is what makes a marketing template lawful to send at
        // all. The service window is what makes utility templates FREE for
        // twenty-four hours after any reply, which is the difference between a
        // lifecycle programme that pays for itself and one that does not.
        if (collections) {
          for (const message of value.messages || []) {
            await handleInboundMessage(collections, message, request.log).catch((err) => {
              request.log.error({ err }, "[meta webhook] inbound message not recorded");
            });
          }
        }
      }
    }

    return { ok: true };
  });
}

// Keywords that stop promotional messages.
//
// Matched on the WHOLE trimmed message, not as a substring. "Please stop
// calling me about the dent on my bumper" is a person in distress about their
// vehicle, not an unsubscribe, and treating it as one would silence exactly the
// customer who most needs to hear from us.
const STOP_WORDS = new Set(["stop", "unsubscribe", "stop promotions", "stop promo", "opt out"]);
const START_WORDS = new Set(["start", "resume", "subscribe"]);

async function handleInboundMessage(collections, message, log) {
  const from = message?.from;
  if (!from) return;

  // Any inbound message opens the free window, whatever it says. This happens
  // before the keyword check on purpose: someone who typed STOP has still
  // opened a service window, and the confirmation we owe them is sent through
  // it.
  const now = Date.now();
  const set = { waWindowOpenUntil: serviceWindowUntil(now) };

  // Meta puts a button tap in `button.text`, not in `text.body` — the "Stop
  // promotions" quick reply on parktag_upgrade_offer arrives that way, and
  // reading only text.body would have ignored the one opt-out control the
  // customer was actually given.
  const said = String(message?.text?.body || message?.button?.text || "")
    .trim()
    .toLowerCase();

  if (STOP_WORDS.has(said)) {
    set.marketingOptOut = true;
    set.marketingOptOutAt = new Date(now).toISOString();
  } else if (START_WORDS.has(said)) {
    set.marketingOptOut = false;
    set.marketingOptInAt = new Date(now).toISOString();
  }

  // Matched on both fields for the same reason login-pin.js and
  // membership-fulfilment.js read both: signup wrote `phone` for years and
  // `mobile` now, and an owner carrying only the older one must still be able
  // to opt out.
  //
  // The number arrives from Meta WITHOUT a leading plus; toE164 is what makes
  // it match rows stored in E.164.
  const e164 = toE164(from);
  const candidates = [from, e164].filter(Boolean);

  const result = await collections.owners.updateOne(
    { $or: [{ mobile: { $in: candidates } }, { phone: { $in: candidates } }] },
    { $set: set }
  );

  if (set.marketingOptOut || set.marketingOptOut === false) {
    log?.info?.(
      {
        to: maskIdentifier(from),
        optOut: set.marketingOptOut === true,
        matched: result.matchedCount > 0
      },
      "[meta webhook] marketing preference updated"
    );
  }

  // No matching owner is not an error. A scanner who replies to an alert has no
  // account here and never will, and inventing one from an inbound message
  // would create records for people who have not signed up for anything.
}
