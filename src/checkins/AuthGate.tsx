"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Logo } from "./Logo";
import { requireSupabase } from "@/lib/supabaseClient";
import { Icon } from "./icons";
import { redeemInviteCode, type JoinedCourse } from "./invites";

// The client is created with detectSessionInUrl, so it consumes the recovery
// fragment itself and can announce PASSWORD_RECOVERY before React's first
// effect has attached a listener. Read the fragment once at module load, before
// the client can strip it, and use that as the backstop.
const initialHash = typeof window === "undefined" ? "" : window.location.hash;

// A class link (?join=…) lands here first, because a code can only be redeemed
// as somebody. Read once at module load, for the same reason as the fragment
// above: sign-up fills the code field from it, and arriving at a bare password
// box after clicking "join my class" needs a sentence or it reads as the wrong
// page.
function codeOnUrl(): string {
  if (typeof window === "undefined") return "";
  const q = new URLSearchParams(window.location.search);
  return (q.get("join") ?? q.get("code") ?? "").trim();
}
const linkedCode = codeOnUrl();
const cameByClassLink = linkedCode !== "";

/**
 * Leave the code on the URL, or take it off once it has been spent.
 *
 * Where a code waits matters. When the project requires email confirmation,
 * sign-up returns no session, so there is nothing to redeem as — and by the
 * time there is, this component has been through a link, a new tab and at
 * least one reload, which React state does not survive. The query string does,
 * and the join screen already reads ?join= on mount (StudentApp.tsx:224), so
 * parking it there hands the code to something downstream that was going to
 * look for it anyway.
 *
 * `code` is dropped alongside because the join screen accepts either spelling,
 * and two params disagreeing about which code you meant is worse than one.
 */
function parkCode(code: string | null) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  q.delete("join");
  q.delete("code");
  if (code) q.set("join", code);
  const qs = q.toString();
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + (qs ? "?" + qs : ""),
  );
}

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
  // A code collected at sign-up, waiting for a session to be redeemed as. It
  // lives up here rather than in the form because signUp() returning a session
  // makes the gate render its children on the spot, and the form goes with it.
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  useEffect(() => {
    // Whichever of the two still has it. `initialHash` is the backstop for a
    // client that consumed the fragment before this effect ran; the live hash
    // is the backstop for the other order — a recovery link that lands on `/`
    // and is forwarded here, where this module is first evaluated part-way
    // through the redirect rather than with the URL already settled.
    const params = hashParams(initialHash || window.location.hash);
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

  if (!session) return <SignIn linkError={linkError} onCodeCollected={setPendingCode} />;

  // Before the children, so the roster row exists before anything asks which
  // app this account gets: app/ck resolves that on mount from what the account
  // is enrolled in, and redeeming underneath it would race the answer.
  if (pendingCode !== null) {
    return <RedeemCollectedCode code={pendingCode} onDone={() => setPendingCode(null)} />;
  }

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
      {/* The mark leads, because sign-in is the one screen with nothing else on
          it to say what this is. */}
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Logo size={34} />
        <div style={{ fontFamily: "var(--serif)", fontSize: 27, fontWeight: 700 }}>
          Collage-Team
        </div>
      </div>
      <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 7 }}>
        Team-based learning prototype.
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

/**
 * A password box you can read back.
 *
 * Typing a password blind is where sign-in actually fails: the address is
 * visible and checkable and the password is eight dots, so a stuck caps lock or
 * a phone keyboard's autocorrect looks identical to a wrong account. The reveal
 * is per field and starts off — it is for checking what you typed, not a
 * setting — and it never travels with the value, so nothing about it is
 * remembered between visits.
 *
 * Its own component because there are three of these across two screens, and a
 * toggle that shows one field while leaving another masked is worse than none.
 */
function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="t-fld">
      {label}
      <div className="t-pw">
        <input
          className="t-in"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          minLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {/* Inside the label, and deliberately a button: clicking interactive
            content inside a label does not activate the label's control, so
            this cannot also focus and re-focus the box it sits in. */}
        <button
          type="button"
          className="t-pwbtn"
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

type Mode = "in" | "up" | "forgot";
type Role = "faculty" | "student";

function SignIn({
  linkError,
  onCodeCollected,
}: {
  linkError: string | null;
  /** Hands a sign-up code to the gate, which outlives this form. */
  onCodeCollected: (code: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("in");
  // The fork is about what happens NEXT, not about what you are called. Naming
  // the roles — Faculty / Teaching fellow / Student — asked people to classify
  // themselves and then decided nothing they could see: a student who read
  // "Faculty" as "I go to a faculty" landed in an empty gradebook with no
  // sentence anywhere explaining it. So the two buttons are the two things that
  // actually happen: you present a code somebody gave you, or you stand up a
  // course of your own.
  //
  // A teaching fellow belongs on the code side. Their instructor's TF code is
  // what makes them a TF, and redeeming it routes them into her course — which
  // is the same journey a student takes, so it is the same button.
  //
  // Defaults to the code side: in a course of eighty there is one of her and
  // eighty of them.
  const [pick, setPick] = useState<"join" | "teach">("join");
  const role: Role = pick === "join" ? "student" : "faculty";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  // Seeded from the link that brought them here. Safe to read a module const
  // computed from `window` — the gate renders "Loading…" until an effect has
  // run, so this form never server-renders and there is nothing to mismatch.
  const [classCode, setClassCode] = useState(linkedCode);
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
        const wanted = pick === "join" ? classCode.trim() : "";
        // Handed over BEFORE the account exists, and deliberately. If signUp
        // comes back with a session it announces it on the way, and the gate
        // replaces this form mid-await; anything passed up afterwards is passed
        // up by a component that is already gone. Handing it over early costs
        // nothing when sign-up then fails: a code is only ever spent once there
        // is a session, and join_with_code enrols auth.uid() and nobody else,
        // so the worst a leftover does is enrol the next account to sign in on
        // this browser — which is the account of the person who typed it.
        if (wanted) {
          parkCode(wanted);
          onCodeCollected(wanted);
        }

        // Role and name both travel in user metadata; handle_new_user() turns
        // them into the profiles row (0006). full_name is the name 0030 writes
        // onto the roster when the code is redeemed, so this field and that
        // insert are the same feature.
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { role, full_name: fullName.trim() } },
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
          // Genuine new signup, email confirmation required. There is no
          // session, so there is nothing to redeem the code as yet — it stays
          // parked on the URL and the join screen picks it up on the far side
          // of the confirmation link.
          setNotice(
            "Account created. Check your email for the confirmation link, then sign in." +
              (wanted ? " Your class code is saved for when you get back." : ""),
          );
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
              ? pick === "teach"
                ? "Your name is what students see on the courses you set up."
                : "Your name and email go on your instructor's roster when you enter their class code."
              : "We'll email you a link that lets you set a new password."}
        </div>

        {cameByClassLink && mode !== "forgot" && (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink2)",
              lineHeight: 1.55,
              marginTop: -6,
              marginBottom: 14,
              padding: "9px 11px",
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--paper3)",
            }}
          >
            You followed a class link. Creating an account? The code it carries is filled in below
            — check it matches the one you were given. Signing in? It&rsquo;s waiting for you on the
            join screen.
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {mode === "up" && (
            <div className="t-fld">
              Which one are you?
              <div className="t-seg2" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={"t-segbtn" + (pick === "join" ? " on" : "")}
                  onClick={() => setPick("join")}
                >
                  I have a class code
                </button>
                <button
                  type="button"
                  className={"t-segbtn" + (pick === "teach" ? " on" : "")}
                  onClick={() => setPick("teach")}
                >
                  I&rsquo;m teaching a course
                </button>
              </div>
              {/* The second sentence on the teaching side is a promise the app
                  has to keep — app/ck/page.tsx offers the code box to a
                  teaching account that owns no course, before anything is
                  created in their name. Change one and change the other. */}
              <span style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 4 }}>
                {pick === "join"
                  ? "Students and teaching fellows. Enter the code your instructor handed out and you are on their roster — or leave it blank and enter one on the next screen."
                  : "Sets up a course of your own: rosters, teams, weeks and grading. Taking the course, or a TF on it? Pick the other one — and if you pick this by mistake, the next screen still offers the code box."}
              </span>
            </div>
          )}

          {mode === "up" && (
            <label className="t-fld">
              Your name
              {/* Required, because this is the name that goes on the roster —
                  0030 reads profiles.full_name and only falls back to the email
                  address, and there is no rename-a-student screen anywhere in
                  the app for Kelly to fix it with afterwards.

                  The placeholder follows the fork above, because on the teaching
                  side the person's instructor is nobody: it asked someone
                  standing up their own course how their instructor should see
                  them. Same name, opposite end of it. */}
              <input
                className="t-in"
                type="text"
                autoComplete="name"
                autoCapitalize="words"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={
                  pick === "teach"
                    ? "How your students should see you"
                    : "How your instructor should see you"
                }
              />
            </label>
          )}

          {!sent && (
            <label className="t-fld">
              Email
              {/* college.harvard.edu, which is the address eighty of the eighty-one
                  people who see this screen actually have. Faculty type over it,
                  and a placeholder has never rejected anything. */}
              <input
                className="t-in"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@college.harvard.edu"
              />
            </label>
          )}

          {mode !== "forgot" && (
            <PasswordField
              label="Password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={setPassword}
              placeholder={mode === "up" ? "at least 6 characters" : undefined}
            />
          )}

          {mode === "up" && pick === "join" && (
            <label className="t-fld">
              Class code (optional)
              {/* Typed on a phone off a whiteboard. The alphabet mixes letters
                  and digits, so a numeric keypad would be the wrong one;
                  autocorrect would try to make eight consonants into a word;
                  autocapitalize costs nothing because normalise_invite_code()
                  upper-cases whatever arrives. The value is left exactly as
                  typed — upper-casing it on every keystroke sends the caret to
                  the end on some phone keyboards, which turns fixing the third
                  character of eight into a fight. */}
              <input
                className="t-in"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
                placeholder="ABCD-EFGH"
                style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}
              />
              <span style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 4 }}>
                Eight characters, from the board or an email. Don&rsquo;t have it yet? Leave this
                empty — you can enter one any time, and your account is made either way.
              </span>
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
 * The code from the sign-up form, spent now that there is a session to spend it
 * as.
 *
 * A separate screen, and separate from sign-up's try block, because of the one
 * rule this path has: a bad code must never cost somebody the account they just
 * made. By the time this renders the account exists and they are signed in, so
 * a typo, a rotated string or a dropped connection is a sentence to read and a
 * button to press — not a failed sign-up, which is what it would look like if
 * the redeem threw where the signUp call could catch it.
 *
 * Both outcomes leave by the same button, into an app whose first screen is a
 * box for a class code.
 */
function RedeemCollectedCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [joined, setJoined] = useState<JoinedCourse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Raw, not trimmed to some other shape: normalise_invite_code() already
    // strips case, spaces and hyphens, and a second definition of what a code
    // looks like is a second thing to drift.
    redeemInviteCode(code)
      .then((j) => {
        if (!alive) return;
        // Spent. Leaving it on the URL would prefill the join box with a code
        // this account has already redeemed, and make the next visit to this
        // tab announce a class link that is no longer going anywhere.
        parkCode(null);
        setJoined(j);
      })
      .catch((err: unknown) => alive && setError(String((err as Error)?.message ?? err)));
    return () => {
      alive = false;
    };
  }, [code]);

  if (!joined && !error) {
    return (
      <Shell>
        <div style={{ color: "var(--ink2)" }}>Joining your course…</div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700 }}>
        {joined
          ? `You're on ${joined.course_name}${joined.course_code ? ` · ${joined.course_code}` : ""}`
          : "Your account is ready"}
      </div>
      <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6, lineHeight: 1.55 }}>
        {joined ? (
          joined.kind === "tf" ? (
            "You joined as a teaching fellow."
          ) : (
            "Your name and email are on the roster."
          )
        ) : (
          // The database keeps its refusals apart on purpose — no such code, a
          // code that has been replaced, a TF address nobody listed — and each
          // sends you somewhere different. Shown as-is, then the part only this
          // screen knows: the account survived.
          <>
            {error} Your account is made and you are signed in — you can enter a code on the next
            screen.
          </>
        )}
      </div>
      <button className="t-btn primary" style={{ marginTop: 14 }} onClick={onDone}>
        Continue
      </button>
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
          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            placeholder="at least 6 characters"
          />
          <PasswordField
            label="Confirm new password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />

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
