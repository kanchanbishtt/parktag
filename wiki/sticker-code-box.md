# The sticker code box on Add Your Vehicles (removed 2026-10-09)

What it was: a typed fallback to scanning. Added in `d963bf7` (12 Jun 2026) as
"Enter your sticker code, found on the back of your sticker or in your order
confirmation"; typing the 12-character QR token opened the same activation page
the scan does.

Why it stopped working: `c1e30f4` (26 Jun 2026) moved QR tokens to 64 hex
characters (`createSecureToken`) so codes cannot be guessed or enumerated. The
box still demanded exactly 12 characters and upper-cased them, so nothing on a
current sticker could match. A later redesign moved it into the vehicle form as
"Link sticker code (optional)", which made it look like part of adding a vehicle.

Why it was removed rather than fixed: scanning the QR already opens the wizard,
and a short typeable code is exactly what the token change took away. A typed
fallback would need the printed serial (`PT-<batch>-<serial>`) plus proof of
holding the sticker (the wizard's OTP). Build that only if owners report they
cannot scan.

Trap it left: a vehicle typed above the box went to `pt_pending_vehicles`
before the redirect, and the dashboard's `syncLocalVehicles` minted a free
E-Tag for it. Anything that parks vehicles in localStorage feeds that sync.
