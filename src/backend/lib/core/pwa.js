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
