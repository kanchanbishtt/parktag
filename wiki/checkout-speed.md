# Why "Continue to pay" was slow, and what is left

Investigated 2026-10-01 after a report that Razorpay's window took 2 to 3
seconds to appear on `/shop` and 5 to 6 on `/get`.

## It was not Razorpay drawing its window

Measured against production with read-only requests:

| What | Time after TLS |
| --- | --- |
| A static image, no database | about 250 ms |
| `/api/health` | about 250 ms |
| A tag lookup (one database read behind a per-route rate limit) | about 490 ms |

Two things follow.

- **Every request costs about 250 ms before the app does anything.** The Railway
  edge that answers is Singapore (`x-railway-edge: sin1`), about 75 ms from
  India. The other 170 ms is the edge reaching the app and coming back, which
  is what a server in a US region looks like from Singapore.
- **Each database round trip costs roughly 120 to 240 ms.** The database is far
  from the app server too.

Guest `create-order` did four or five database trips, a courier lookup and a
Razorpay call, **one after another**. From a far-away server each is a slow hop, and the
buyer waited for the sum.

`/get` was slower than `/shop` for a different reason. It mints a reCAPTCHA
token when the delivery step opens, and a token lasts two minutes. Typing an
address takes longer, so at the tap the token was stale and a second one was
fetched while the buyer watched. `/shop` sends no token for an online order.

## What changed

1. **The bot-check token is kept fresh** (`scripts/fresh-captcha.js`). `/get`
   re-mints it every 75 seconds while the delivery step is open, so the tap
   never waits for Google.
2. **The server is told when the buyer is close to paying.** The address sheet
   calls `POST /api/shop/guest/warm` when the pincode is complete and again when
   the form is. It sends the pincode and nothing else. The server then:
   - asks the courier about that pincode, so the answer is cached when the order
     asks (12 hours, production only);
   - opens the connection to Razorpay (`warmRazorpay`).
3. **The connection to Razorpay is kept open** (`payments.js`). Before, every
   order opened a new TLS connection, three round trips before the request.
4. **`create-order` starts its independent reads together**: the courier lookup,
   the referral lookup and the unscored-order cap now run alongside the bot
   check. Razorpay's order and our order number are created together. The
   decisions are still taken in the original order.
5. `/shop` opens its connections to Razorpay's hosts at the tap, as `/get` did.

## What it buys

Simulated locally with the latencies above (database 200 ms a trip, Razorpay
1000 ms on a new connection and 400 ms on an open one, courier 900 ms):

| Order creation on the server | Before | After |
| --- | --- | --- |
| First-time pincode, nothing warmed | 2715 ms | 2513 ms |
| Warmed while the buyer typed | n/a | 1014 ms |

Running the steps together saves little by itself, because the courier and
Razorpay are the long poles. **The warm-up is what removes them from the tap.**

On top of the server time the buyer still pays the 250 ms request hop, and then
Razorpay draws its own window, which is theirs.

These are simulations, not production measurements: measuring the real thing
means placing real orders.

## What is left, and why code cannot remove it

After the change a warmed order still does, in sequence: the request hop, the
route's rate-limit check (one database trip), the reuse lookup (one), Razorpay's
order (one round trip to India), and the insert (one). About a second from a
server that is far from its database, its payment provider and its buyers.

**Moving the app server close to the database and to India is the remaining
lever, and it is the largest one.** It shortens every request on the site, not
only checkout. Check in Railway (service → Settings → Region) and in Atlas
(cluster region) before deciding: the two must end up near each other, or every
database trip gets slower instead of faster.

## Limits worth knowing

- The warm-up helps the server instance that received it. With several replicas
  it helps when the order lands on the same one, which is usual for two requests
  on one browser connection but not guaranteed.
- Razorpay closes an idle connection after a while. A buyer who completes the
  form and then waits minutes before tapping pays for a new connection.
- A background tab throttles timers, so the token refresh may not run there. The
  tap then mints one, as it did before.
- `/direct` still mints its token at the tap. Same fix applies if wanted.
- The signed-in dashboard checkout (`/api/shop/create-order`) is unchanged.

Tests: `src/backend/tests/checkout-speed.test.js`.
