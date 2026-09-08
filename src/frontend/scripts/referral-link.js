// Remember a referral code across the walk to checkout.
//
// Somebody arrives on app.parktag.me/get?ref=X237XC from a friend's WhatsApp,
// reads the page, opens the address sheet, and only then does a checkout call
// happen. The query string survives none of that reliably: /shop bounces
// signed-out visitors through sign-in, and pt-analytics rewrites the address
// bar on the scan pages.
//
// So the code is parked once, on arrival, and read back at checkout.
//
// sessionStorage, not localStorage, and the difference is deliberate. A
// referral is one visit's context, not a permanent property of the browser: a
// code left in localStorage would still be attached to an order somebody places
// three months later, having long forgotten whose link they followed. Tab
// scope also stops one visit's code leaking into another tab's checkout.
//
// The code is never trusted here. It is a hint carried to the server, which
// resolves it, refuses self-referral and decides the discount. This file cannot
// change a price.

const KEY = "pt_ref";

// Same shape the server validates. Rejecting junk here keeps a garbage query
// string out of storage and out of the checkout body; it is not a security
// boundary, because nothing on this side of the wire is.
const CODE = /^[2-9A-HJKMNP-TVWXYZ]{6}$/;

function park() {
  try {
    const raw = new URLSearchParams(location.search).get("ref");
    if (!raw) return;
    const code = String(raw).trim().toUpperCase();
    if (CODE.test(code)) sessionStorage.setItem(KEY, code);
  } catch {
    // Private browsing can refuse sessionStorage outright. A referral is worth
    // exactly nothing next to the checkout still working.
  }
}

/**
 * The parked code, or null. Read by the checkout scripts and sent as `ref`.
 */
export function referralCode() {
  try {
    const code = sessionStorage.getItem(KEY);
    return code && CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * Forget it once an order has been placed, so a second purchase in the same
 * session does not silently reuse a code the buyer has already spent. The
 * server caps rewards per referrer, but the honest behaviour is not to send it
 * twice in the first place.
 */
export function clearReferralCode() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

park();
