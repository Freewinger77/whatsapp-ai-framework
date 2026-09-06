"use client";

import { useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/brand-logo";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [show, setShow] = useState(false);

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
    <div className="gate">
      <section className="gate-brand">
        <BrandLogo size="login" />
        <div className="gate-copy">
          <h1>
            Every lead and every booking for the <em>tyre fitting</em> shop, in one place.
          </h1>
        </div>
        <p className="gate-foot">Internal tool. Authorised users only.</p>
      </section>

      <section className="gate-form">
        <form onSubmit={onSubmit}>
          <h2>Sign in</h2>
          <p className="gate-sub">Use the shared shop password.</p>
          <label htmlFor="password">Password</label>
          <div className="gate-field">
            <input
              id="password"
              name="password"
              type={show ? "text" : "password"}
              required
              autoComplete="current-password"
              autoFocus
            />
            <button type="button" className="gate-show" onClick={() => setShow((v) => !v)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
          {error ? <p className="err">{error}</p> : null}
          <button className="gate-submit" type="submit" disabled={pending}>
            {pending ? "Checking…" : "Sign in"}
          </button>
        </form>
      </section>
    </div>
  );
}
