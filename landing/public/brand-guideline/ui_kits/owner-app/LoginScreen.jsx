import React from "react";
import { AppHeader } from "../../components/navigation/AppHeader.jsx";
import { Card } from "../../components/data/Card.jsx";
import { IconTile } from "../../components/tag/IconTile.jsx";
import { Icon } from "../../components/icons/Icon.jsx";
import { Field } from "../../components/forms/Field.jsx";
import { Input } from "../../components/forms/Input.jsx";
import { Checkbox } from "../../components/forms/Checkbox.jsx";
import { Button } from "../../components/actions/Button.jsx";
import { GoogleButton, OrDivider } from "../../components/actions/GoogleButton.jsx";
import { StatusText } from "../../components/status/StatusText.jsx";

const LINK = { background: "none", border: "none", color: "var(--accent)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", cursor: "pointer", padding: 0, fontFamily: "inherit" };

export function LoginScreen({ onSignedIn }) {
  const [step, setStep] = React.useState("identifier");
  const [identifier, setIdentifier] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const isPhone = /^[0-9+\s]{6,}$/.test(identifier.trim());

  function next() {
    if (!identifier.trim()) return;
    setBusy(true);
    setTimeout(() => { setBusy(false); setStep("code"); }, 600);
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-page)" }}>
      <AppHeader align="left" />
      <main style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px" }}>
        <Card style={{ width: "100%", maxWidth: "var(--width-auth)", padding: "28px 24px", borderRadius: "var(--radius-4xl)", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border-default)" }}>
          <IconTile tone="accent" style={{ marginBottom: 12 }}><Icon name="user" size={22} /></IconTile>
          <h1 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", color: "var(--text-strong)" }}>
            {step === "identifier" ? "Owner Sign In" : step === "code" ? "Enter your code" : "Enter your password"}
          </h1>
          <p style={{ margin: "0 0 20px", fontSize: "var(--text-md)", lineHeight: "var(--leading-body)", color: "var(--text-muted)" }}>
            {step === "identifier"
              ? "Enter your email or mobile number and we'll send you a verification code."
              : step === "code"
              ? "We sent a 6-digit code to " + identifier + "."
              : "Signing in with the password you set for " + identifier + "."}
          </p>

          {step === "identifier" ? (
            <div style={{ display: "grid", gap: "var(--space-14)" }}>
              <Field label="Email or mobile number">
                <div style={{ position: "relative" }}>
                  <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Enter email or mobile number" />
                  {identifier.trim() ? (
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: "0.7rem", fontWeight: "var(--weight-bold)", letterSpacing: "0.04em", background: "var(--pt-gray-100)", color: "var(--text-admin-muted)", border: "1px solid var(--border-admin)", borderRadius: 20, padding: "2px 8px", pointerEvents: "none" }}>
                      {isPhone ? "MOBILE" : "EMAIL"}
                    </span>
                  ) : null}
                </div>
              </Field>
              <Button variant="primary" full loading={busy} onClick={next}>Continue</Button>
            </div>
          ) : step === "code" ? (
            <div style={{ display: "grid", gap: "var(--space-8)" }}>
              <Field label="Verification code">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" maxLength={6} style={{ textAlign: "center", fontSize: "1.4rem", letterSpacing: "0.25em", fontWeight: "var(--weight-bold)" }} />
              </Field>
              <Button variant="primary" full onClick={onSignedIn} style={{ marginTop: 8 }}>Verify</Button>
              <p style={{ textAlign: "center", margin: "12px 0 0", fontSize: "var(--text-base)", color: "var(--text-admin-muted)" }}>
                Didn't receive the code? <button style={LINK}>Resend</button>
              </p>
              <p style={{ textAlign: "center", margin: "8px 0 0", fontSize: "var(--text-base)", color: "var(--text-admin-muted)" }}>
                Know your password? <button style={LINK} onClick={() => setStep("password")}>Sign in with password</button>
              </p>
              <p style={{ textAlign: "center", margin: "8px 0 0" }}>
                <button style={{ ...LINK, fontWeight: "var(--weight-semibold)" }} onClick={() => setStep("identifier")}>← Back to sign in</button>
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "var(--space-10)" }}>
              <Field label="Password">
                <Input type="password" placeholder="Enter your password" />
              </Field>
              <Checkbox label="Remember me on this device" style={{ fontSize: "0.84rem", fontWeight: "var(--weight-semibold)", color: "var(--pt-gray-700)" }} />
              <Button variant="primary" full onClick={onSignedIn} style={{ marginTop: 4 }}>Sign in</Button>
              <p style={{ textAlign: "center", margin: "8px 0 0" }}>
                <button style={{ ...LINK, fontWeight: "var(--weight-semibold)" }} onClick={() => setStep("code")}>← Back to verification code</button>
              </p>
            </div>
          )}

          <StatusText tone="info" center>{step === "code" ? "Demo code: any six digits." : ""}</StatusText>

          {step === "identifier" ? (
            <>
              <OrDivider />
              <GoogleButton style={{ marginTop: 14 }} onClick={onSignedIn} />
            </>
          ) : null}
        </Card>
      </main>
    </div>
  );
}
