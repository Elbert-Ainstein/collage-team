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
type Role = "faculty" | "student";

function SignIn() {
  const [mode, setMode] = useState<Mode>("in");
  // What the person says they are. A teaching fellow becomes a faculty account
  // — the TF roster is what actually grants them anything — so this is three
  // buttons over two roles.
  const [pick, setPick] = useState<"faculty" | "tf" | "student">("faculty");
  const role: Role = pick === "student" ? "student" : "faculty";
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
        // The role travels in user metadata; a database trigger turns it into a
        // profiles row (see migration 0006).
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { role } },
        });
        if (error) throw error;
        // With email-enumeration protection on (the default), signing up with an
        // address that already exists returns no error and no session — the only
        // signal is an empty identities array. Without this check the user is
        // told to watch for a confirmation email that will never arrive.
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          setError("That email already has an account — sign in instead.");
          setMode("in");
        } else if (!data.session) {
          // Genuine new signup, email confirmation required.
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
          {mode === "up" && (
            <div className="t-fld">
              I am
              <div className="t-seg2" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={"t-segbtn" + (pick === "faculty" ? " on" : "")}
                  onClick={() => setPick("faculty")}
                >
                  Faculty
                </button>
                {/* A teaching fellow is a faculty ACCOUNT — what makes them a TF
                    is being on the instructor's list, not this button. But
                    nothing told them that, and the Faculty copy ("you run the
                    sessions") reads like the wrong answer, so they need a button
                    of their own. */}
                <button
                  type="button"
                  className={"t-segbtn" + (pick === "tf" ? " on" : "")}
                  onClick={() => setPick("tf")}
                >
                  Teaching fellow
                </button>
                <button
                  type="button"
                  className={"t-segbtn" + (pick === "student" ? " on" : "")}
                  onClick={() => setPick("student")}
                >
                  Student
                </button>
              </div>
              <span style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 4 }}>
                {pick === "faculty"
                  ? "You run the sessions: rosters, teams, weeks and grading."
                  : pick === "tf"
                    ? "Use the address your instructor added you under — that is what links you to their course."
                    : "Use the email address your instructor has on the roster, so we can find you."}
              </span>
            </div>
          )}
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
