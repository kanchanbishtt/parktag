// One visit's checkout, kept across a reload.
//
// A reload used to throw away what a buyer had chosen (the pack counts, the
// add-on tick, a typed code) and close the checkout they were in the middle
// of. /get fixed that for itself; /shop and /direct did not, and each would
// have grown its own copy. This is the one place it is done, for every public
// storefront page.
//
// What a page keeps is its own business: it saves small patches as the buyer
// chooses things and reads them back on load. The one field every page uses the
// same way is `checkout`, the pack whose checkout is open, which is what tells
// the page to reopen it after a reload. The address being typed is NOT kept
// here: the shared address sheet keeps its own draft (owner/address-step.js).
//
// sessionStorage, not localStorage: this is one visit's cart, so it survives a
// reload of the tab and is gone when the tab closes. Storage that is disabled
// or full, or a corrupt value, is never fatal: the page simply behaves as it
// did before, and forgets on reload.
export function checkoutCart(key) {
  function read() {
    try {
      const cart = JSON.parse(sessionStorage.getItem(key) || "{}");
      return cart && typeof cart === "object" && !Array.isArray(cart) ? cart : {};
    } catch {
      return {};
    }
  }

  function save(patch) {
    try { sessionStorage.setItem(key, JSON.stringify({ ...read(), ...patch })); } catch { /* ignore */ }
  }

  // The order is paid or placed: nothing is left to bring back. The address
  // sheet's draft goes too, so a finished purchase never prefills the next one.
  function clear() {
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
    try { window.ptCollectAddress?.clearDraft?.(); } catch { /* ignore */ }
  }

  return { read, save, clear };
}
