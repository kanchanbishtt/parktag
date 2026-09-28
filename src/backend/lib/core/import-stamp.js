// Version stamping for the ES-module graph.
//
// Pages reference their entry script as /scripts/get.js?v=<assetVersion> and it
// is served immutable for a year. The modules that script imports were written
// as plain `./recaptcha.js`, so they carried no version, got no immutability,
// and were revalidated on every visit: a second-level waterfall of conditional
// requests behind every cached entry point.
//
// Rather than edit every import in the frontend, the stamp is added on the way
// out: when a script is requested with the CURRENT version, the relative and
// absolute-/scripts import specifiers inside it gain the same `?v=`. Every
// module in the graph is then requested with that version and is itself
// rewritten the same way, so the whole tree is immutable.
//
// One module, one URL. A module reached as `./x.js?v=V` from one importer and
// `/scripts/x.js?v=V` from another resolves to the same absolute URL, so the
// browser loads it once. What must never happen is the same file being reached
// both with and without `?v=`, which would run it twice; that is why a request
// with a missing or stale version is served untouched (its imports stay
// unversioned too) and why a specifier that already has a query is left alone.

// A string literal that is a relative (`./`, `../`) or absolute-under-/scripts
// path ending in .js, directly after `from`, `import(` or a bare `import`.
// `[^"'?#]` stops at any query or fragment, so an already-stamped specifier
// (`x.js?v=1`) has `?` where the closing quote must be and does not match: the
// rewrite is idempotent and cannot stamp twice. External URLs (`https://...`)
// never start with `./`, `../` or `/scripts/` and are left alone.
const IMPORT_SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])((?:\.{1,2}\/|\/scripts\/)[^"'?#\r\n]*\.js)\2/g;

// HTML pages get this substituted at serve time; scripts that build a URL for a
// versioned asset (a lazy `import()`, a preload) can use it the same way.
const VERSION_TOKEN = "__ASSET_VERSION__";

export function stampScriptImports(source, version) {
  if (!version) return source;
  return String(source)
    .replace(IMPORT_SPECIFIER, (_match, lead, quote, specifier) => `${lead}${quote}${specifier}?v=${version}${quote}`)
    .replaceAll(VERSION_TOKEN, version);
}
