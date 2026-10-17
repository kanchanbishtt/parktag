// The service worker's version stamp.
//
// A browser installs a new service worker only when the bytes of /sw.js
// change, and the worker refreshes its copy of the offline page only when it
// installs. So the stamp written into the worker has to move whenever the
// offline page does, or an edited offline page would sit behind the old copy
// until some unrelated script changed. The asset version (styles and scripts)
// is folded in too, so a deploy that changes the site also rolls the worker.
//
// Nothing else about the worker depends on this value: it only names the
// cache, and the activate step deletes every cache with another name.

import { createHash } from "node:crypto";

const SW_VERSION_TOKEN = "__SW_VERSION__";

export function serviceWorkerVersion({ assetVersion, offlineHtml }) {
  const offlineDigest = createHash("sha1").update(String(offlineHtml)).digest("hex").slice(0, 8);
  return `${assetVersion}-${offlineDigest}`;
}

export function renderServiceWorker(source, { assetVersion, offlineHtml }) {
  return source.replaceAll(SW_VERSION_TOKEN, serviceWorkerVersion({ assetVersion, offlineHtml }));
}

// ── Digital Asset Links for the Android app ─────────────────────────────────
//
// The Play Store app is a Trusted Web Activity: Chrome showing this site with
// no browser bar, which Android allows only if the site says the app may
// speak for it. That statement is /.well-known/assetlinks.json: the app's
// package name and the SHA-256 of the certificate(s) it is signed with.
//
// Fingerprints arrive from the environment as people paste them: Play Console
// shows them uppercase with colons, keytool prints "SHA256: AA:BB:...", and a
// copy from a terminal may have lost the colons. All of those are accepted and
// written back in the one form Android compares against (uppercase, colon
// separated). Anything that is not 32 bytes of hex is dropped rather than
// published: a malformed fingerprint in the file does not fail the check for
// the good ones, but it is a typo nobody would otherwise notice.
//
// Returns null when there is nothing valid to publish, and the route answers
// 404: a deploy without the Play app must not serve an empty statement.

// The app's package name. One constant, not a setting: scripts/pwa.js has to
// know the same name to recognise a launch from the app, and a setting that
// the served script could not follow would be a lie. The test suite holds the
// two together.
export const ANDROID_APP_PACKAGE = "me.parktag.app";

const FINGERPRINT = /^[0-9A-F]{64}$/;

export function normaliseSha256Fingerprint(value) {
  const hex = String(value || "").trim().replace(/^SHA-?256:\s*/i, "").replace(/[\s:]/g, "").toUpperCase();
  if (!FINGERPRINT.test(hex)) return null;
  return hex.match(/.{2}/g).join(":");
}

export function assetLinks({ packageName, fingerprints }) {
  const name = String(packageName || "").trim();
  const valid = [...new Set((fingerprints || []).map(normaliseSha256Fingerprint).filter(Boolean))];
  if (!name || valid.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: name,
        sha256_cert_fingerprints: valid
      }
    }
  ];
}
