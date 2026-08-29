import React from "react";
import { LoginScreen } from "./LoginScreen.jsx";
import { DashboardScreen } from "./DashboardScreen.jsx";
import { ActivateScreen } from "./ActivateScreen.jsx";

export function OwnerApp({ initial = "login" }) {
  const [screen, setScreen] = React.useState(initial);
  return (
    <div style={{ fontFamily: "var(--font-ui)", color: "var(--text-strong)" }}>
      <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 200, display: "flex", gap: 6, background: "rgba(255,255,255,0.92)", border: "1px solid var(--border-admin)", borderRadius: 999, padding: 5, boxShadow: "var(--shadow-soft)" }}>
        {[["login", "Sign in"], ["activate", "Activate"], ["dashboard", "Dashboard"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setScreen(id)}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "6px 12px",
              fontFamily: "var(--font-ui)",
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
              background: screen === id ? "var(--accent)" : "transparent",
              color: screen === id ? "#fff" : "var(--text-admin-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {screen === "login" ? <LoginScreen onSignedIn={() => setScreen("dashboard")} /> : null}
      {screen === "activate" ? <ActivateScreen onActivated={() => setScreen("dashboard")} /> : null}
      {screen === "dashboard" ? <DashboardScreen onSignOut={() => setScreen("login")} /> : null}
    </div>
  );
}
