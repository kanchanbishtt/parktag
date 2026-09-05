import nodemailer from "nodemailer";
import { maskIdentifier } from "../auth/security.js";

export function isEmailConfigured(env) {
  return !!(env.emailSmtpHost && env.emailSmtpUser && env.emailSmtpPass);
}

// Everything interpolated into the HTML below.
//
// The senders that came first only ever placed server-owned values into their
// markup — an order number this app generates, a product name out of the
// catalogue — so there was nothing to escape and no helper. That stopped being
// true the moment an owner's NAME reached an e-mail: displayName is typed by
// the person, the delivery name is typed into a public checkout form, and
// neither is validated for anything except length. Injected markup in an
// e-mail is not the same risk as in a page — mail clients drop scripts — but it
// is a live one, because a convincing <a> is all a phishing link needs, and
// this message already tells the reader something urgent has happened to their
// car.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The app's own base, trimmed. NOT the landing site: /owner-welcome and
// /track-order are served by this service, and APP_BASE_URL pointing at the
// marketing host is why a password-reset link can 404 — the same variable, the
// same failure. Kept as one helper so fixing the variable fixes every link.
function appBase(env) {
  return String(env.appBaseUrl || "https://app.parktag.me").replace(/\/+$/, "");
}

function createTransport(env) {
  return nodemailer.createTransport({
    host: env.emailSmtpHost,
    port: env.emailSmtpPort || 587,
    secure: env.emailSmtpPort === 465,
    auth: {
      user: env.emailSmtpUser,
      pass: env.emailSmtpPass
    }
  });
}

// Wording per code purpose. A code that authorises permanent deletion must not
// go out described as a sign-in code: the description is the only thing telling
// the recipient what they are approving, and it is what makes "read me the code
// you just got" fail rather than succeed.
const OTP_EMAIL_COPY = {
  "delete-account": {
    subject: (code) => `${code} — confirm deleting your ParkTag account`,
    heading: "Confirm account deletion",
    lead:
      "Use the code below to permanently delete your ParkTag account, including " +
      "every vehicle, tag and order on it. This cannot be undone. The code " +
      "expires in <strong>10 minutes</strong>.",
    footer:
      "If you didn't ask to delete your account, do not share this code — " +
      "ignore this email and your account stays exactly as it is."
  }
};

const OTP_EMAIL_DEFAULT = {
  subject: (code) => `${code} — your ParkTag verification code`,
  heading: "Your verification code",
  lead:
    "Use the code below to sign in to your ParkTag owner account. It expires in " +
    "<strong>10 minutes</strong>.",
  footer: "If you didn't request this, you can safely ignore this email."
};

export async function sendOtpEmail(env, { to, code, purpose }) {
  const copy = OTP_EMAIL_COPY[purpose] || OTP_EMAIL_DEFAULT;

  if (!isEmailConfigured(env)) {
    if (env.runtimeMode !== "production") {
      // Dev-only fallback so the flow is testable without SMTP configured.
      // Identifier is masked — only the OTP itself needs to be readable here.
      console.log(`\n[ParkTag] Dev OTP for ${maskIdentifier(to)}: ${code}\n`);
      return;
    }
    throw new Error("Email is not configured on this server.");
  }

  const transporter = createTransport(env);

  await transporter.sendMail({
    from: env.emailFrom || "ParkTag <noreply@parktag.me>",
    to,
    subject: copy.subject(code),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;background:#F5A623;border-radius:8px;padding:8px 16px">
            <span style="color:#fff;font-weight:800;font-size:1.1rem">ParkTag</span>
          </div>
        </div>
        <h2 style="color:#111;margin-bottom:8px">${copy.heading}</h2>
        <p style="color:#555;line-height:1.6">${copy.lead}</p>
        <div style="text-align:center;margin:28px 0">
          <div style="display:inline-block;background:#F9FAFB;border:2px solid #E5E7EB;border-radius:12px;padding:20px 40px">
            <span style="font-size:2.2rem;font-weight:800;letter-spacing:0.18em;color:#111">${code}</span>
          </div>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
        <p style="color:#bbb;font-size:0.75rem">${copy.footer}</p>
        <p style="color:#ccc;font-size:0.75rem;margin-top:8px">ParkTag · parktag.me</p>
      </div>
    `
  });
}

// Order confirmation e-mail. Sent best-effort after an order is placed — for
// COD it doubles as the delivery-acceptance reminder ("keep cash ready, accept
// your parcel"). `amountPaise` is the amount in paise; `cod` toggles the COD vs
// prepaid copy. Callers must treat a throw as non-fatal (the order already
// exists) — mirrors how the OTP mail never blocks its flow.
export async function sendOrderConfirmationEmail(env, { to, orderNumber, productName, amountPaise, cod, trackingUrl }) {
  const rupees = `₹${(Math.round(Number(amountPaise) || 0) / 100).toLocaleString("en-IN")}`;

  if (!isEmailConfigured(env)) {
    if (env.runtimeMode !== "production") {
      console.log(`\n[ParkTag] Dev order confirmation for ${maskIdentifier(to)}: ${orderNumber} · ${productName} · ${rupees} · ${cod ? "COD" : "PAID"}\n`);
      return;
    }
    throw new Error("Email is not configured on this server.");
  }

  const codBlock = cod
    ? `<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:16px;margin:20px 0">
         <p style="margin:0;color:#9A3412;font-weight:700">Cash on Delivery — ${rupees} to pay</p>
         <p style="margin:6px 0 0;color:#9A3412;line-height:1.6;font-size:.9rem">Please keep <strong>${rupees} in cash ready</strong> and accept your parcel when the delivery agent arrives. Refusing delivery delays everyone — thank you!</p>
       </div>`
    : `<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:16px;margin:20px 0">
         <p style="margin:0;color:#065F46;font-weight:700">Payment received — ${rupees}</p>
         <p style="margin:6px 0 0;color:#065F46;line-height:1.6;font-size:.9rem">Your order is confirmed and will be shipped shortly.</p>
       </div>`;

  const trackBlock = trackingUrl
    ? `<div style="text-align:center;margin:22px 0">
         <a href="${trackingUrl}" style="background:#03162D;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:.95rem;display:inline-block">Track your order</a>
       </div>`
    : "";

  const transporter = createTransport(env);

  await transporter.sendMail({
    from: env.emailFrom || "ParkTag <noreply@parktag.me>",
    to,
    subject: `Order ${orderNumber} confirmed — ParkTag`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;background:#F5A623;border-radius:8px;padding:8px 16px">
            <span style="color:#fff;font-weight:800;font-size:1.1rem">ParkTag</span>
          </div>
        </div>
        <h2 style="color:#111;margin-bottom:8px">Thanks for your order!</h2>
        <p style="color:#555;line-height:1.6">Your order is confirmed. Here are the details:</p>
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0">
          <p style="margin:0 0 6px;color:#111"><strong>Order:</strong> ${orderNumber}</p>
          <p style="margin:0 0 6px;color:#111"><strong>Item:</strong> ${productName}</p>
          <p style="margin:0;color:#111"><strong>Amount:</strong> ${rupees}</p>
        </div>
        ${codBlock}
        ${trackBlock}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
        <p style="color:#ccc;font-size:0.75rem;margin-top:8px">ParkTag · parktag.me</p>
      </div>
    `
  });
}

export async function sendPasswordResetEmail(env, { to, resetUrl }) {
  if (!isEmailConfigured(env)) {
    if (env.runtimeMode !== "production") {
      // Dev-only fallback so the flow is testable without SMTP configured.
      // Identifier is masked; the link itself must stay intact to be usable.
      console.log(`\n[ParkTag] Dev password reset link for ${maskIdentifier(to)}:\n${resetUrl}\n`);
      return;
    }
    throw new Error("Email is not configured on this server. Contact support.");
  }

  const transporter = createTransport(env);

  await transporter.sendMail({
    from: env.emailFrom || "ParkTag <noreply@parktag.me>",
    to,
    subject: "Reset your ParkTag password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;background:#F5A623;border-radius:8px;padding:8px 16px">
            <span style="color:#fff;font-weight:800;font-size:1.1rem">ParkTag</span>
          </div>
        </div>
        <h2 style="color:#111;margin-bottom:8px">Reset your password</h2>
        <p style="color:#555;line-height:1.6">You requested a password reset for your ParkTag owner account. Click the button below to set a new password. This link expires in <strong>15 minutes</strong>.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${resetUrl}" style="background:#F5A623;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:1rem;display:inline-block">Reset Password</a>
        </div>
        <p style="color:#888;font-size:0.85rem">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color:#888;font-size:0.8rem;word-break:break-all">${resetUrl}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
        <p style="color:#bbb;font-size:0.75rem">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        <p style="color:#ccc;font-size:0.75rem;margin-top:8px">ParkTag · parktag.me</p>
      </div>
    `
  });
}

// A paid membership, confirmed in writing.
//
// The WhatsApp goes to a mobile; this goes to whatever address the account
// holds. Both are sent, not one or the other: an owner who signed up by e-mail
// and never added a number had NO confirmation at all before this existed —
// the WhatsApp path had nothing to send to, logged "undeliverable", and
// returned, on a purchase that had already taken their money.
export async function sendMembershipConfirmationEmail(env, { to, name, planLabel, endsOn, orderNumber }) {
  if (!isEmailConfigured(env)) {
    if (env.runtimeMode !== "production") {
      console.log(`
[ParkTag] Dev membership confirmation for ${maskIdentifier(to)}: ${planLabel} until ${endsOn}
`);
      return;
    }
    throw new Error("Email is not configured on this server.");
  }

  const transporter = createTransport(env);
  const safeName = escapeHtml(name || "there");
  const safePlan = escapeHtml(planLabel);
  const safeEnds = escapeHtml(endsOn);
  const orderLine = orderNumber
    ? `<p style="margin:6px 0 0;color:#111"><strong>Order:</strong> ${escapeHtml(orderNumber)}</p>`
    : "";

  await transporter.sendMail({
    from: env.emailFrom || "ParkTag <noreply@parktag.me>",
    to,
    subject: `Your ParkTag membership is active — ${planLabel}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;background:#F5A623;border-radius:8px;padding:8px 16px">
            <span style="color:#fff;font-weight:800;font-size:1.1rem">ParkTag</span>
          </div>
        </div>
        <h2 style="color:#111;margin-bottom:8px">Hi ${safeName}, your membership is active</h2>
        <p style="color:#555;line-height:1.6">Premium features are switched on for your tag — masked calls, scanner location, the document vault and WhatsApp alerts.</p>
        <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:16px;margin:16px 0">
          <p style="margin:0 0 6px;color:#065F46"><strong>Plan:</strong> ${safePlan}</p>
          <p style="margin:0;color:#065F46"><strong>Active until:</strong> ${safeEnds}</p>
          ${orderLine}
        </div>
        <div style="text-align:center;margin:22px 0">
          <a href="${appBase(env)}/owner-welcome" style="background:#03162D;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:.95rem;display:inline-block">Open my dashboard</a>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
        <p style="color:#ccc;font-size:0.75rem;margin-top:8px">ParkTag · parktag.me</p>
      </div>
    `
  });
}

// Someone scanned an owner's tag and reported something about their vehicle.
//
// The most time-critical message this app sends — lights left on, a car
// blocking a gate, a window open — so it goes to every channel the owner has
// rather than only the one they are most likely to read. The reason is chosen
// from a fixed server-side list (see core/contact-actions.js): the scanner
// picks from a menu and can never author a word of it.
export async function sendOwnerAlertEmail(env, { to, ownerName, reason, plateNumber }) {
  if (!isEmailConfigured(env)) {
    if (env.runtimeMode !== "production") {
      console.log(`
[ParkTag] Dev owner alert for ${maskIdentifier(to)}: ${reason}
`);
      return;
    }
    throw new Error("Email is not configured on this server.");
  }

  const transporter = createTransport(env);
  const safeName = escapeHtml(ownerName || "there");
  const safeReason = escapeHtml(reason);
  const vehicleLine = plateNumber
    ? `<p style="margin:0 0 6px;color:#9A3412"><strong>Vehicle:</strong> ${escapeHtml(plateNumber)}</p>`
    : "";

  await transporter.sendMail({
    from: env.emailFrom || "ParkTag <noreply@parktag.me>",
    to,
    subject: "Someone reported an issue with your vehicle — ParkTag",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;background:#F5A623;border-radius:8px;padding:8px 16px">
            <span style="color:#fff;font-weight:800;font-size:1.1rem">ParkTag</span>
          </div>
        </div>
        <h2 style="color:#111;margin-bottom:8px">Hi ${safeName}, please check your vehicle</h2>
        <p style="color:#555;line-height:1.6">Someone scanned the ParkTag sticker on your vehicle and reported an issue.</p>
        <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:16px;margin:16px 0">
          ${vehicleLine}
          <p style="margin:0;color:#9A3412;line-height:1.6"><strong>Reported:</strong> ${safeReason}</p>
        </div>
        <div style="text-align:center;margin:22px 0">
          <a href="${appBase(env)}/owner-welcome" style="background:#03162D;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:.95rem;display:inline-block">See the details</a>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
        <p style="color:#ccc;font-size:0.75rem;margin-top:8px">ParkTag · parktag.me</p>
      </div>
    `
  });
}
