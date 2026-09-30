// Firebase provisions its own reCAPTCHA key. Do not reuse the WhatsApp v3
// token: Identity Toolkit validates SMS against the Firebase project's key.
let authPromise;
async function getFirebaseAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      const response = await fetch("/api/auth/firebase-config");
      const config = await response.json();
      if (!response.ok) throw new Error("SMS sign-in is unavailable. Please use WhatsApp.");
      const [{ initializeApp }, { getAuth, RecaptchaVerifier }] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js")
      ]);
      return { auth: getAuth(initializeApp(config, "parktag-sms")), RecaptchaVerifier };
    })().catch(error => { authPromise = null; throw error; });
  }
  return authPromise;
}

// Google's "I'm not a robot" card comes in two fixed sizes and cannot be
// resized: "normal" is 304px wide, "compact" is 164px. The sign-in card leaves
// under 304px on most phones (a 360px screen has about 278px), where "normal"
// spilled out of the card and off the screen. Pick the size that fits the
// space the widget is actually given.
const NORMAL_CAPTCHA_WIDTH = 304;
export function captchaSizeFor(availableWidth) {
  return availableWidth >= NORMAL_CAPTCHA_WIDTH ? "normal" : "compact";
}

export async function getFirebaseCaptchaToken() {
  const { auth, RecaptchaVerifier } = await getFirebaseAuth();
  const container = document.getElementById("firebase-sms-recaptcha");
  // clientWidth is 0 if the container is missing or hidden. Treat unknown as
  // narrow: "compact" fits everywhere, "normal" only where it was measured to.
  const available = container?.clientWidth || 0;
  const verifier = new RecaptchaVerifier(auth, "firebase-sms-recaptcha", { size: captchaSizeFor(available) });
  try {
    // Each send/resend needs a fresh, single-use token. The backend dispatches
    // SMS so its per-IP and shared WhatsApp/SMS destination limits still apply.
    return await verifier.verify();
  } finally {
    verifier.clear();
  }
}
