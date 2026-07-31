"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { requireSupabase } from "@/lib/supabaseClient";
import { Icon } from "./icons";

/**
 * Sign-in wall. Each account has its own workspace — a second account is how you
 * get a sandbox with placeholder data, since no account can see another's rows.
 */
export function AuthGate({
  children,
}: {
  children: (session: Session, signOut: () => Promise<void>) => React.ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = requireSupabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <Shell>
        <div style={{ color: "var(--ink2)" }}>Loading…</div>
      </Shell>
    );
  }

  if (!session) return <SignIn />;

  return <>{children(session, async () => void (await requireSupabase().auth.signOut()))}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div id="tbl-app" className="ck-root">
      <div className="ck-canvas" style={{ maxWidth: 520 }}>
        {children}
      </div>
    </div>
  );
}

type Mode = "in" | "up";

function SignIn() {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sb = requireSupabase();
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        // With email confirmation on, there is no session until the link is clicked.
        if (!data.session) {
          setNotice("Account created. Check your email for the confirmation link, then sign in.");
          setMode("in");
        }
      }
    } catch (err: unknown) {
      const m = String((err as Error)?.message ?? err);
      setError(
        /invalid login credentials/i.test(m)
          ? "That email and password don't match an account."
          : /already registered/i.test(m)
            ? "That email already has an account — sign in instead."
            : /at least 6/i.test(m)
              ? "Password must be at least 6 characters."
              : m,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 27, fontWeight: 700 }}>
          Class Check-ins
        </div>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 5 }}>
          Weekly team-based learning check-ins.
        </div>
      </div>

      <form className="t-card" style={{ padding: 22 }} onSubmit={submit}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700 }}>
          {mode === "in" ? "Sign in" : "Create an account"}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4, marginBottom: 14 }}>
          {mode === "in"
            ? "Your sessions, rosters and grades are private to your account."
            : "A new account starts empty — useful as a sandbox for placeholder data."}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <label className="t-fld">
            Email
            <input
              className="t-in"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@harvard.edu"
            />
          </label>
          <label className="t-fld">
            Password
            <input
              className="t-in"
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "up" ? "at least 6 characters" : ""}
            />
          </label>

          {error && (
            <div style={{ fontSize: 12.5, color: "var(--amber)" }}>{error}</div>
          )}
          {notice && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--green)",
                display: "flex",
                gap: 6,
                alignItems: "center",
              }}
            >
              <Icon name="check" size={15} />
              {notice}
            </div>
          )}

          <button className="t-btn primary" type="submit" disabled={busy}>
            {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </div>
      </form>

      <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink2)" }}>
        {mode === "in" ? "No account yet?" : "Already have one?"}{" "}
        <button
          className="t-btn ghost"
          style={{ padding: "2px 6px", textDecoration: "underline" }}
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "in" ? "Create one" : "Sign in"}
        </button>
      </div>
    </Shell>
  );
}
