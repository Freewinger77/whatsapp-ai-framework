"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: signError } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email") || ""),
      password: String(formData.get("password") || ""),
    });
    if (signError) {
      setError(signError.message);
      setPending(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="login-wrap">
      <form className="login-card" action={onSubmit}>
        <p className="eyebrow">Isolated sandbox</p>
        <h1>Dundee inbox</h1>
        <p className="muted">Operator login for Tyre Fighter Dundee chats. Not the wasup fleet dashboard.</p>
        <input name="email" type="email" placeholder="Email" required autoComplete="username" />
        <input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Open inbox"}
        </button>
      </form>
    </div>
  );
}
