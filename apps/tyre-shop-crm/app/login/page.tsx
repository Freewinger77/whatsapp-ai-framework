"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get("password") || "");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("Wrong password");
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 80, background: "url(/rapidscreen-mark.png) center / cover no-repeat" }} />
          <span style={{ font: "400 14px/20px Inter,sans-serif", fontStyle: "italic", color: "var(--text-sidebar)" }}>TYRES4U.WASUP</span>
        </div>
        <h1>Tyres 4 U</h1>
        <p className="hint">Password gate for the SMT CRM dashboard. Same password as the Dundee inbox.</p>
        <input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
        {error ? <p className="err">{error}</p> : null}
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Checking…" : "Open dashboard"}
        </button>
      </form>
    </div>
  );
}
