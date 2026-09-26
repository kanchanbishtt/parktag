Fabric.js 6.9.1 (MIT, see LICENSE), `dist/index.min.js` from the npm package
`fabric@6.9.1`, with only its sourceMappingURL comment removed. Used by
/admin/sticker-designer. Vendored rather than loaded from a CDN because the
app's CSP only allows first-party scripts. To upgrade, replace the file and
bump the version in its name and in pages/admin/sticker-designer.html.
