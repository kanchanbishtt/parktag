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

export async function getFirebaseCaptchaToken() {
  const { auth, RecaptchaVerifier } = await getFirebaseAuth();
  const verifier = new RecaptchaVerifier(auth, "firebase-sms-recaptcha", { size: "normal" });
  try {
    // Each send/resend needs a fresh, single-use token. The backend dispatches
    // SMS so its per-IP and shared WhatsApp/SMS destination limits still apply.
    return await verifier.verify();
  } finally {
    verifier.clear();
  }
}
