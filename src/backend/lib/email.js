import nodemailer from "nodemailer";

export function isEmailConfigured(env) {
  return !!(env.emailSmtpHost && env.emailSmtpUser && env.emailSmtpPass);
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

export async function sendOtpEmail(env, { to, code }) {
  if (!isEmailConfigured(env)) {
    if (env.runtimeMode !== "production") {
      console.log(`\n[ParkTag] OTP for ${to}: ${code}\n`);
      return;
    }
    throw new Error("Email is not configured on this server.");
  }

  const transporter = createTransport(env);

  await transporter.sendMail({
    from: env.emailFrom || "ParkTag <noreply@parktag.me>",
    to,
    subject: `${code} — your ParkTag verification code`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;background:#F5A623;border-radius:8px;padding:8px 16px">
            <span style="color:#fff;font-weight:800;font-size:1.1rem">ParkTag</span>
          </div>
        </div>
        <h2 style="color:#111;margin-bottom:8px">Your verification code</h2>
        <p style="color:#555;line-height:1.6">Use the code below to sign in to your ParkTag owner account. It expires in <strong>10 minutes</strong>.</p>
        <div style="text-align:center;margin:28px 0">
          <div style="display:inline-block;background:#F9FAFB;border:2px solid #E5E7EB;border-radius:12px;padding:20px 40px">
            <span style="font-size:2.2rem;font-weight:800;letter-spacing:0.18em;color:#111">${code}</span>
          </div>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
        <p style="color:#bbb;font-size:0.75rem">If you didn't request this, you can safely ignore this email.</p>
        <p style="color:#ccc;font-size:0.75rem;margin-top:8px">ParkTag · parktag.me</p>
      </div>
    `
  });
}

export async function sendPasswordResetEmail(env, { to, resetUrl }) {
  if (!isEmailConfigured(env)) {
    if (env.runtimeMode !== "production") {
      console.log(`\n[ParkTag] Password reset link for ${to}:\n${resetUrl}\n`);
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
        <p style="color:#555;line-height:1.6">You requested a password reset for your ParkTag owner account. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
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
