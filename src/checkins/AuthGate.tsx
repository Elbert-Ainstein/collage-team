"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { requireSupabase } from "@/lib/supabaseClient";
import { Icon } from "./icons";

// The client is created with detectSessionInUrl, so it consumes the recovery
// fragment itself and can announce PASSWORD_RECOVERY before React's first
// effect has attached a listener. Read the fragment once at module load, before
// the client can strip it, and use that as the backstop.
const initialHash = typeof window === "undefined" ? "" : window.location.hash;

function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ""));
}

/** Drop the auth fragment so a reload does not land back in recovery. */
function clearAuthHash() {
  if (typeof window === "undefined") return;
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
}

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
  const [recovering, setRecovering] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const params = hashParams(initialHash);
    // A TOKEN is required, not just the marker. `type=recovery` alone is not a
    // callback as far as auth-js is concerned — it restores whatever session was
    // already in storage — so trusting the bare marker meant anyone could open
    // /ck#type=recovery on a machine that is already signed in and be handed
    // "set a new password" over somebody else's live session, with no knowledge
    // of the current one. That is the exact lockout this feature exists to
    // prevent, pointed the other way.
    if (params.get("type") === "recovery" && params.get("access_token")) {
      setRecovering(true);
    }
    // An expired or already-used link comes back as an error fragment and no
    // session, and the client leaves that fragment on the URL. Without this the
    // person clicks the link, lands on a plain sign-in form, and is told
    // nothing about why.
    const desc = params.get("error_description");
    if (desc) {
      setLinkError(desc);
      clearAuthHash();
    }

    const sb = requireSupabase();
    // No .catch here meant a rejected getSession — an unreachable network, a
    // token refresh that fails — left the WHOLE app on "Loading…" forever, with
    // no error and no way to sign in. Treat a failure as "not signed in": the
    // sign-in form is the right place to be when we cannot tell.
    sb.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setReady(true));
    const { data: sub } = sb.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <Shell>
        <div style={{ color: "var(--ink2)" }}>Loading…</div>
      </Shell>
    );
  }

  // A recovery link signs you in, so this has to come before the session check
  // — otherwise the link drops straight into the app and the password is never
  // reset.
  if (recovering) {
    return (
      <SetNewPassword
        onLeave={() => {
          clearAuthHash();
          setRecovering(false);
        }}
      />
    );
  }

  // A dead or already-used link opened on a machine that is already signed in
  // would otherwise drop straight into the app: auth-js deliberately keeps the
  // existing session on a URL-login failure, and SignIn is the only thing that
  // renders linkError. Say it here too, rather than nowhere.
  if (session && linkError) {
    return (
      <Shell>
        <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700 }}>
          That reset link didn&rsquo;t work
        </div>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6, lineHeight: 1.55 }}>
          {linkError} You are still signed in as before — request a new link from the sign-in
          screen if you want to change your password.
        </div>
        <button className="t-btn primary" style={{ marginTop: 14 }} onClick={() => setLinkError(null)}>
          Continue
        </button>
      </Shell>
    );
  }

  if (!session) return <SignIn linkError={linkError} />;

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

function Heading() {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: "var(--serif)", fontSize: 27, fontWeight: 700 }}>
        Class Check-ins
      </div>
      <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 5 }}>
        Weekly team-based learning check-ins.
      </div>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, color: "var(--amber)" }}>{text}</div>;
}

function NoticeLine({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 12.5,
        color: "var(--green)",
        display: "flex",
        gap: 6,
        alignItems: "flex-start",
      }}
    >
      <Icon name="check" size={15} />
      {text}
    </div>
  );
}

type Mode = "in" | "up" | "forgot";
type Role = "faculty" | "student";

function SignIn({ linkError }: { linkError: string | null }) {
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
  const [sent, setSent] = useState(false);

  // Arrives a tick after this form mounts (the gate reads it from the URL), so
  // it cannot simply seed the initial state.
  useEffect(() => {
    if (linkError) {
      setMode("forgot");
      setError(linkError);
    }
  }, [linkError]);

  const goto = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setSent(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sb = requireSupabase();
      if (mode === "forgot") {
        // Back to this same page: the gate here is what catches the recovery
        // event. This exact URL must be allow-listed in the Supabase dashboard
        // under Authentication -> URL Configuration.
        const redirectTo = window.location.origin + window.location.pathname;
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        // With email-enumeration protection on (the default) an unknown address
        // comes back clean, and the confirmation below is deliberately the same
        // either way. If a project has that protection off, Supabase answers
        // "user not found" — which is precisely the thing we must not repeat
        // back — so that one shape is swallowed on purpose. Everything else (a
        // rate limit, a dead SMTP sender) is a real failure to send and the
        // person needs to know their link is not coming.
        if (error && !/user not found/i.test(String(error.message))) throw error;
        setSent(true);
      } else if (mode === "in") {
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
      <Heading />

      <form className="t-card" style={{ padding: 22 }} onSubmit={submit}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700 }}>
          {mode === "in" ? "Sign in" : mode === "up" ? "Create an account" : "Reset your password"}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4, marginBottom: 14 }}>
          {mode === "in"
            ? "Your sessions, rosters and grades are private to your account."
            : mode === "up"
              ? "A new account starts empty — useful as a sandbox for placeholder data."
              : "We'll email you a link that lets you set a new password."}
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

          {!sent && (
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
          )}

          {mode !== "forgot" && (
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
          )}

          {mode === "in" && (
            <div style={{ marginTop: -4 }}>
              <button
                type="button"
                className="t-btn ghost"
                style={{ padding: "2px 0", fontSize: 12, color: "var(--ink2)" }}
                onClick={() => goto("forgot")}
              >
                Forgot your password?
              </button>
            </div>
          )}

          {error && <ErrorLine text={error} />}
          {notice && <NoticeLine text={notice} />}
          {sent && (
            <NoticeLine
              text={
                "If that address has an account, a reset link is on its way to it. " +
                "Check your spam folder — and use the link soon, it expires in about an hour " +
                "and only works once."
              }
            />
          )}

          {!sent && (
            <button className="t-btn primary" type="submit" disabled={busy}>
              {busy
                ? "…"
                : mode === "in"
                  ? "Sign in"
                  : mode === "up"
                    ? "Create account"
                    : "Send reset link"}
            </button>
          )}
        </div>
      </form>

      <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink2)" }}>
        {mode === "in" ? "No account yet?" : mode === "up" ? "Already have one?" : "Remembered it?"}{" "}
        <button
          className="t-btn ghost"
          style={{ padding: "2px 6px", textDecoration: "underline" }}
          onClick={() => goto(mode === "in" ? "up" : "in")}
        >
          {mode === "in" ? "Create one" : "Sign in"}
        </button>
      </div>
    </Shell>
  );
}

/**
 * Reached only by following the emailed link, which signs this browser in as
 * the person who asked for it. There is deliberately no email field: you can
 * only ever set the password of the account whose link you are holding.
 */
function SetNewPassword({ onLeave }: { onLeave: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Leaving this screen consumes the link without changing anything, and there
  // is no change-password UI anywhere else — so the only way back is another
  // email. Worth a second click.
  const [armedSkip, setArmedSkip] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await requireSupabase().auth.updateUser({ password });
      if (error) throw error;
      // The recovery session is already a signed-in session, so clearing the
      // fragment and leaving this screen lands in the app.
      onLeave();
    } catch (err: unknown) {
      const m = String((err as Error)?.message ?? err);
      setError(
        /auth session missing|session_not_found|jwt expired/i.test(m)
          ? "That reset link has expired or was already used. Request a new one from the sign-in screen."
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
      <Heading />

      <form className="t-card" style={{ padding: 22 }} onSubmit={submit}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700 }}>
          Set a new password
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4, marginBottom: 14 }}>
          You followed a reset link. Choose a new password and you&apos;ll be signed in.
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <label className="t-fld">
            New password
            <input
              className="t-in"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="at least 6 characters"
            />
          </label>
          <label className="t-fld">
            Confirm new password
            <input
              className="t-in"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>

          {error && <ErrorLine text={error} />}

          <button className="t-btn primary" type="submit" disabled={busy}>
            {busy ? "…" : "Set password and continue"}
          </button>
        </div>
      </form>

      {/* Deliberately vague: a good link has already signed this browser in, so
          skipping lands in the app, while an expired one leaves no session and
          lands on the sign-in form. Naming either destination would be wrong
          half the time. */}
      <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink2)" }}>
        Don&apos;t want to change it?{" "}
        <button
          className="t-btn ghost"
          style={{ padding: "2px 6px", textDecoration: "underline" }}
          onClick={() => (armedSkip ? onLeave() : setArmedSkip(true))}
          onBlur={() => setArmedSkip(false)}
        >
          {armedSkip ? "Skip — the link only works once?" : "Skip"}
        </button>
      </div>
    </Shell>
  );
}
