# ParkTag Daily Smoke Test

About 30 to 40 minutes. Run every day; run the full list after each deploy.

## Rules

- Test on a real Android phone on mobile data, and once on an iPhone or a second browser.
- Use a fresh incognito tab for every flow.
- Report every line as PASS, FAIL or NOT TESTED. Never leave a line out.
- For any FAIL, attach a screenshot or screen recording plus the exact steps.
- Mark test orders as TEST. Cancel them, or report their order IDs.

## 1. Landing site

- [ ] Home, About, Contact, Privacy, Terms and Refund pages load with no broken images or layout.
- [ ] Every "Shop" and "Buy" button opens the shop.
- [ ] The owner login link opens the login page.
- [ ] The contact form or contact details work.
- [ ] Page loads in under 3s on mobile data (note the time).

## 2. Shop and checkout (most important)

- [ ] The shop page loads and every product and price is correct.
- [ ] Bike, car and combo pack show the right stock status.
- [ ] Add to cart, change quantity, remove item.
- [ ] Valid promo code applies the correct discount; invalid code shows a clear error.
- [ ] Address: valid, invalid and unservable pincodes all behave correctly.
- [ ] Refresh mid-checkout: address and cart must not vanish.
- [ ] Confirm delivery address (note the seconds).
- [ ] Online payment: Razorpay opens (note the seconds), pay by UPI or card, land on the success page.
- [ ] Online payment: close or fail Razorpay, get a clean failure with retry.
- [ ] COD order: place it (note the seconds), get the confirmation page.
- [ ] Order confirmation message arrives (WhatsApp, SMS or email).
- [ ] Track order page shows the test order.
- [ ] The order appears in admin with the correct amount, address and payment mode.

## 3. Owner flow

- [ ] Register or claim a tag: OTP arrives, vehicle number and phone save.
- [ ] Log in with OTP, log in with PIN, run forgot password.
- [ ] Dashboard shows vehicles and tags.
- [ ] Toggle a tag inactive and active; state persists after refresh.
- [ ] Contact request log shows the scan and call attempts from section 4.
- [ ] Membership and documents pages load.
- [ ] Download the QR image.

## 4. Scanner flow (core product)

- [ ] Scan a real sticker with a phone camera: scanner page opens with the masked vehicle number.
- [ ] Call Owner: enter your number, get the call, the owner's phone rings, neither side sees the other's number.
- [ ] WhatsApp message: send a note, the owner receives it.
- [ ] Inactive tag: fallback shows and the WhatsApp message still works.
- [ ] Invalid or unclaimed tag: friendly error, no crash.
- [ ] Report-tag flow submits.
- [ ] Every scan, call and message shows in the owner dashboard and in admin.

## 5. Admin

- [ ] Admin login works.
- [ ] Overview numbers look sane (no NaN, no unexpected zeros).
- [ ] Orders, print queue and activations pages load with fresh data.
- [ ] Promo codes list loads and the active toggle works.

## 6. Security and general

- [ ] Owner and admin pages redirect to login when logged out (try `/owner/dashboard` and `/admin` in incognito).
- [ ] The scanner page never shows a full phone number.
- [ ] Browser console has no red errors on shop, checkout and scanner pages.
- [ ] Note anything slow, laggy or ugly on mobile.

## Speed targets (flag if exceeded)

| Step | Target |
|---|---|
| Landing load | 3s |
| Address confirm | 1s |
| Razorpay open | 2s |
| COD place | 3s |

## Tiers

- **Every day (15 min):** section 2 (COD and online), section 4 (call and WhatsApp), admin order check.
- **After each deploy:** the full list.
- **Weekly:** sections 1, 3, 5 and 6 on a second device.

## Report template

```
ParkTag daily test | Date: | Tester: | Device/network:
Result: X passed, Y failed, Z not tested

FAILED
1. [Section] What broke | Steps | Screenshot/video

SLOW (seconds)
Address confirm: | Razorpay open: | COD place: | Landing load:

NOT TESTED (and why):

PASSED sections: Landing / Shop / Owner / Scanner call / Scanner WhatsApp / Admin / Security

Test orders created (IDs):
Anything odd:
```
