# Response Compression

The backend compresses responses with `@fastify/compress`, registered in
`src/backend/app.js` after the asset-stamping `onSend` hook and before
`@fastify/static`.

## Negotiation

Chosen per request from the client's `Accept-Encoding` header. This is standard
HTTP content negotiation, so no client detection code is needed:

1. `zstd` if the client lists it and Node supports it (22.15+)
2. `br`
3. `gzip`
4. plain body when the header is missing, says `identity`, or lists nothing supported

Clients that cannot decode zstd simply do not advertise it, so they get brotli
or gzip. Responses carry `Vary: Accept-Encoding` so caches keep variants apart.
Bodies under 1 KB and non-compressible types (images, PDFs) are sent as is.

## Measured sizes (plugin defaults, 2026-09-24)

| Payload | Plain | gzip | br (q4) | zstd (l3) |
| --- | --- | --- | --- | --- |
| `/styles/styles.css` | 161,365 | 40,598 | 41,852 | 44,002 |
| `/get` page | 28,084 | 7,461 | 7,473 | 7,835 |

At the default levels zstd is the fastest (about 1.2 ms vs 3.8 ms for gzip on
`styles.css`) but produces slightly larger output. It is not smaller than
brotli for text. Higher levels change that:

| Level | Size | Time per compress |
| --- | --- | --- |
| br q6 | 37,976 | 4.3 ms |
| zstd l9 | 38,336 | 5.3 ms |
| br q11 | 33,187 | 246 ms (too slow per request) |

If egress cost matters more than CPU, set `brotliOptions` quality 5-6 and/or a
higher zstd level in the plugin options, or precompress static files at build
time and serve them with `@fastify/static`'s `preCompressed` option.

## Constraints

- Request decompression is disabled (`globalDecompression: false`). No client
  sends encoded bodies, and the Razorpay/Meta/Exotel webhooks verify
  signatures against the raw request bytes.
