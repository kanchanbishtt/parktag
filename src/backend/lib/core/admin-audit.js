// Admin sign-in log: who signed in or out of the admin panel, how, from where,
// and failed attempts at the admin sign-in.
//
// Built to cost next to nothing:
//   - callers do not await it, so a sign-in is never slowed or blocked by the
//     log, and a failed write is dropped rather than failing the sign-in;
//   - each row is a few short fields (a "Chrome · Windows" label, not the full
//     user agent);
//   - rows expire after 90 days through a TTL index on `at` (a real Date: the
//     TTL monitor ignores strings), so the collection never grows unbounded;
//   - failed attempts for the same email from the same IP within one minute
//     are one row with a count, so a guessing burst is a line, not a flood.

import crypto from "node:crypto";
import { ObjectId } from "mongodb";

export const ADMIN_AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60;

const EVENTS = new Set(["login", "logout", "login_failed", "login_locked"]);

// A short, human label for a user agent. Order matters: Edge and Opera also
// say "Chrome", and Chrome also says "Safari".
export function browserLabel(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return null;
  const browser =
    /Edg\//.test(ua) ? "Edge"
      : /OPR\/|Opera/.test(ua) ? "Opera"
        : /Firefox\//.test(ua) ? "Firefox"
          : /Chrome\//.test(ua) ? "Chrome"
            : /Safari\//.test(ua) ? "Safari"
              : "Other browser";
  const os =
    /Windows/.test(ua) ? "Windows"
      : /Android/.test(ua) ? "Android"
        : /iPhone|iPad|iPod/.test(ua) ? "iOS"
          : /Mac OS X|Macintosh/.test(ua) ? "macOS"
            : /Linux/.test(ua) ? "Linux"
              : null;
  return os ? `${browser} · ${os}` : browser;
}

const cleanEmail = (value) => String(value || "").trim().toLowerCase().slice(0, 120) || null;

// Fire and forget: returns a promise that never rejects, for tests to await.
export function recordAdminEvent(collections, { event, adminId = null, email, method = null, reason = null, request }) {
  if (!collections?.adminAudit || !EVENTS.has(event)) return Promise.resolve();
  const at = new Date();
  const ip = String(request?.ip || "").slice(0, 64) || null;
  const browser = browserLabel(request?.headers?.["user-agent"]);
  const mail = cleanEmail(email);

  let write;
  if (event === "login_failed" || event === "login_locked") {
    // One row per email, IP and minute; repeats only bump the count.
    const minute = at.toISOString().slice(0, 16);
    const key = crypto.createHash("sha256").update(`${event}|${mail}|${ip}|${minute}`).digest("hex").slice(0, 32);
    write = collections.adminAudit.updateOne(
      { _id: `f_${key}` },
      {
        $set: { at, browser },
        $setOnInsert: { event, email: mail, ip, reason, firstAt: at },
        $inc: { count: 1 }
      },
      { upsert: true }
    );
  } else {
    const id = adminId ? String(adminId) : null;
    write = collections.adminAudit.insertOne({ at, event, adminId: id, email: mail, method, ip, browser });
    // "Last signed in" on the admin list reads this stamp, not the log.
    if (event === "login" && id && ObjectId.isValid(id) && collections.admins) {
      write = Promise.all([
        write,
        collections.admins.updateOne({ _id: new ObjectId(id) }, { $set: { lastSignInAt: at } })
      ]);
    }
  }
  return Promise.resolve(write).then(() => undefined, (error) => {
    request?.log?.warn?.({ event: "admin-audit-write-failed", err: error?.message }, "[admin-audit] could not record an admin sign-in event");
  });
}
