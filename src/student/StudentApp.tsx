"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  claimStudentRows,
  getEnrolment,
  listAssignments,
  submitMyWork,
  submitTeamWork,
  type Assignment,
  type Enrolment,
} from "@/checkins/studentData";
import { redeemInviteCode, type JoinedCourse } from "@/checkins/invites";
import { initials, tintFor } from "@/checkins/data";
import { SCOPE_OF, type Student } from "@/checkins/types";
import { SIcon } from "./icons";
import { Assignments } from "./Assignments";
import { MyWork } from "./MyWork";
import { TeamResources } from "./TeamResources";
import { SubmitScreen } from "./SubmitScreen";
import "./student.css";

type Screen = "list" | "detail" | "work" | "submit" | "tr" | "trDetail";

/** How many faces the stack shows before the count carries the remainder. */
const STACK_CAP = 4;

function StackAvatar({
  student,
  isMe,
  depth = 0,
}: {
  student: Student;
  isMe: boolean;
  /** Higher sits on top; the stack counts down so earlier faces stay whole. */
  depth?: number;
}) {
  const tint = student.avatar_tint || tintFor(student.name);
  return (
    <span
      className={"sv-stack-av" + (isMe ? " me" : "")}
      style={{
        // The pale tint has to sit on an OPAQUE base. As a bare `tint + "22"`
        // the fill was 13% alpha, so the faces the stack overlaps showed
        // straight through the one in front and the initials smeared together.
        // The base is the same variable the separating ring uses, so it tracks
        // whatever is behind the stack — including the button's hover state.
        backgroundColor: "var(--stack-ring, var(--cream-100))",
        backgroundImage: `linear-gradient(0deg, ${tint}22, ${tint}22)`,
        color: tint,
        zIndex: depth,
      }}
    >
      {initials(student.name)}
    </span>
  );
}

/**
 * The team, top right of the panel, the way Slack shows a channel's members.
 * The faces are decoration — the button's label carries the whole meaning, so a
 * screen reader never lands on a bare number.
 */
function TeamStack({ enrolment }: { enrolment: Enrolment }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const popId = useId();

  const { student, team, teammates } = enrolment;
  const members = useMemo(() => {
    const others = teammates.filter((t) => t.id !== student.id);
    // Me first, then roster order (the data layer sorts by position). Two
    // reasons: the order must not shuffle between loads, and putting myself
    // first keeps the marked face inside the cap on a large team.
    return [student, ...others];
  }, [student, teammates]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!team) {
    return <span className="sv-teamnote">You&rsquo;re not on a team yet</span>;
  }
  if (members.length < 2) {
    return (
      <span className="sv-teamnote">
        {team.name} &middot; just you so far
      </span>
    );
  }

  const shown = members.slice(0, STACK_CAP);
  return (
    <div
      className="sv-stackwrap"
      ref={wrap}
      onBlur={(e) => {
        // Tabbing out of the names closes them; clicking inside does not.
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={button}
        className="sv-stackbtn"
        aria-expanded={open}
        aria-controls={popId}
        aria-label={`${team.name}: ${members.length} members including you. Show names.`}
        onClick={() => setOpen((v) => !v)}
        onFocus={(e) => {
          // Reaching it by keyboard reveals the names without a second press.
          // A mouse click is not focus-visible, so it still toggles normally.
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
      >
        <span className="sv-stack" aria-hidden="true">
          {shown.map((m, i) => (
            <StackAvatar
              key={m.id}
              student={m}
              isMe={m.id === student.id}
              depth={shown.length - i}
            />
          ))}
        </span>
        <span className="sv-stackcount sv-num" aria-hidden="true">
          {members.length}
        </span>
      </button>

      {open && (
        <div className="sv-stackpop" id={popId} role="group" aria-label={`${team.name} members`}>
          <div className="sv-eyebrow">{team.name}</div>
          <ul className="sv-stacklist">
            {members.map((m) => (
              <li key={m.id}>
                <StackAvatar student={m} isMe={m.id === student.id} />
                <span className="sv-ellip" style={{ minWidth: 0 }}>
                  {m.name}
                </span>
                {m.id === student.id && <span className="sv-badge secondary">you</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * A page with nothing on it but the code box.
 *
 * Not the app shell: that sidebar names a course and offers Assignments and
 * Team resources, and rendering it around somebody who has joined nothing puts
 * them inside a course they are not in — with "Applied Physics 50" in the
 * corner, which is only the fallback string. `.sv` is what carries the design
 * tokens, so the wrapper is doing work, not decoration.
 */
export function JoinScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="sv" style={{ display: "block", overflowY: "auto" }}>
      <div
        style={{ maxWidth: 660, margin: "0 auto", padding: "clamp(24px, 7vh, 72px) 20px 40px" }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Entering a class code — the only way onto a roster now, so it is the first
 * screen most people meet.
 *
 * The failure sentences come straight from join_with_code() and are shown
 * as-is on purpose. The database keeps three cases apart — no such code, a code
 * that has been replaced, and a good code paired with an address that is not on
 * that roster — and only the third sends you to your instructor rather than
 * back to the board. Folding them into "that didn't work" would leave the
 * student whose address was typed wrong retyping a code that was never the
 * problem.
 */
export function JoinPanel({
  account,
  onJoined,
  footer,
}: {
  account: string;
  /** Runs after a successful redeem; the caller decides where the person lands. */
  onJoined: (joined: JoinedCourse) => Promise<void> | void;
  /** The other way out of this screen, which differs by where the panel is used. */
  footer?: React.ReactNode;
}) {
  const [code, setCode] = useState("");
  const [fromLink, setFromLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<JoinedCourse | null>(null);
  const fieldId = useId();
  const noteId = useId();

  // A code can arrive in a link (?join=…). Prefill it, and say where it came
  // from so the filled box is not a mystery — but never redeem on load. A link
  // that enrols you the moment you open it is a link somebody else can send
  // you, and the press is the only thing standing between the two.
  //
  // After the first render, like the sessionStorage restore below: this
  // component server-renders and window does not exist there.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("join") ?? params.get("code");
    if (!linked) return;
    setCode(linked);
    setFromLink(true);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The raw field value, not a trimmed one. normalise_invite_code() already
      // strips whitespace, hyphens and case; doing it again here would give
      // "what a code looks like" two definitions that could drift apart.
      const j = await redeemInviteCode(code);
      setJoined(j);
      await onJoined(j);
    } catch (err: unknown) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (joined) {
    // Deliberately the same words whether this call enrolled them or they were
    // already on the roster: join_with_code is idempotent and cannot tell those
    // apart, and to the person who pressed the button they are one event.
    return (
      <div className="sv-card" style={{ maxWidth: 620 }}>
        <div className="sv-h1" style={{ fontSize: "var(--text-xl)" }}>
          You&rsquo;re on {joined.course_name}
          {joined.course_code ? ` · ${joined.course_code}` : ""}
        </div>
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            lineHeight: 1.6,
            marginTop: 8,
          }}
        >
          {joined.kind === "tf"
            ? "You joined as a teaching fellow. Opening the course…"
            : "Opening your assignments…"}
        </p>
      </div>
    );
  }

  // The roster misses are the only failures where the fix is a conversation
  // rather than a retype, so they get the extra line about signing in under a
  // different address.
  const rosterMiss = error !== null && /roster|listed as a TF/i.test(error);

  return (
    <form className="sv-card" style={{ maxWidth: 620 }} onSubmit={submit}>
      <div className="sv-h1" style={{ fontSize: "var(--text-xl)" }}>
        Join your course
      </div>
      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--muted-foreground)",
          lineHeight: 1.6,
          marginTop: 8,
          maxWidth: "62ch",
        }}
      >
        There is nothing on this account yet. Your instructor hands out a class code — eight
        characters, on the board or in an email. Enter it and you&rsquo;re on their roster.
      </p>
      <p id={noteId} className="sv-sub" style={{ lineHeight: 1.6, marginTop: 6, maxWidth: "62ch" }}>
        The code only works alongside the address on their list. You&rsquo;re signed in as{" "}
        <strong style={{ color: "var(--navy)" }}>{account}</strong>.
      </p>

      <label
        htmlFor={fieldId}
        className="sv-eyebrow"
        style={{ display: "block", marginTop: 16, marginBottom: 6 }}
      >
        Class code
      </label>
      {/* Typed on a phone, in a hurry, off a whiteboard. The alphabet has
          letters AND digits so a numeric keypad would be the wrong keyboard;
          autocorrect and spellcheck would try to make eight consonants into a
          word; autocapitalize costs nothing, since the database upper-cases
          what arrives either way. */}
      <input
        id={fieldId}
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        enterKeyHint="go"
        aria-describedby={noteId}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={busy}
        placeholder="ABCD-EFGH"
        style={{
          width: "100%",
          maxWidth: 320,
          padding: "11px 13px",
          border: "1px solid var(--neutral-200)",
          borderRadius: "var(--radius-md)",
          background: "var(--cream-100)",
          color: "var(--navy)",
          font: "inherit",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-lg)",
          letterSpacing: "0.14em",
          // Display only. Upper-casing the VALUE on every keystroke moves the
          // caret to the end on some phone keyboards, which makes fixing the
          // third character of eight a fight.
          textTransform: "uppercase",
        }}
      />

      {fromLink && (
        <p className="sv-sub" style={{ marginTop: 8, maxWidth: "62ch" }}>
          This came from the link you opened. Check it matches the code you were given, then join.
        </p>
      )}

      {error && (
        <p
          role="alert"
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--amber-700)",
            lineHeight: 1.6,
            marginTop: 12,
            maxWidth: "62ch",
          }}
        >
          {error}
          {rosterMiss && (
            <>
              {" "}
              If they have a different address for you, sign out and sign in with that one instead.
            </>
          )}
        </p>
      )}

      <button
        className="sv-btn primary"
        type="submit"
        style={{ marginTop: 16 }}
        disabled={busy || !code.trim()}
      >
        {busy ? "Joining…" : "Join course"}
      </button>

      {footer}
    </form>
  );
}

/**
 * The student half of the app. The shell is persistent; a single `screen` value
 * drives which panel shows, exactly as the handoff specifies.
 */
export function StudentApp({
  account,
  onSignOut,
  onRerouted,
  onTeachInstead,
}: {
  account: string;
  onSignOut: () => Promise<void>;
  /** A code was redeemed that this app cannot show — a TF code — so ask the router again. */
  onRerouted?: () => void;
  /** They are here by a wrong pick at sign-up and want the other side. */
  onTeachInstead?: () => void;
}) {
  const [screen, setScreen] = useState<Screen>("list");
  const [selId, setSelId] = useState<string | null>(null);
  const [trId, setTrId] = useState<string | null>(null);
  const [tab, setTab] = useState<"indiv" | "team">("indiv");
  // Which half of a check-in the work screen is editing.
  const [workMode, setWorkMode] = useState<"indiv" | "team">("indiv");

  // Where you were, kept across a reload.
  //
  // sessionStorage rather than localStorage: this is "I refreshed" memory, not
  // a preference. Per-tab and cleared when the tab closes, so opening the app
  // fresh tomorrow lands on the assignment list rather than on some activity
  // from last week that you would have to work out how to leave.
  //
  // Restored AFTER the first render (not as useState's initial value) because
  // this component server-renders, and reading a browser-only store during
  // render makes the server and client markup disagree.
  const restored = useRef(false);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("sv-where");
      if (!raw) return;
      const at = JSON.parse(raw) as Partial<{
        screen: Screen;
        selId: string | null;
        trId: string | null;
        tab: "indiv" | "team";
        workMode: "indiv" | "team";
      }>;
      if (at.screen) setScreen(at.screen);
      if (at.selId !== undefined) setSelId(at.selId);
      if (at.trId !== undefined) setTrId(at.trId);
      if (at.tab) setTab(at.tab);
      if (at.workMode) setWorkMode(at.workMode);
    } catch {
      // Unparseable or refused storage: start on the list, which is where the
      // app started before any of this.
    } finally {
      restored.current = true;
    }
  }, []);

  useEffect(() => {
    // Not before the restore has run, or the initial "list" would overwrite
    // what we are about to read back.
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem(
        "sv-where",
        JSON.stringify({ screen, selId, trId, tab, workMode }),
      );
    } catch {
      // A browser refusing storage just means a reload starts at the list.
    }
  }, [screen, selId, trId, tab, workMode]);

  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Returns the enrolment it found, because redeeming a code has to know
  // whether this app now has anything to show — a TF code leaves it null and
  // needs the router, not a re-render.
  const load = useCallback(async (): Promise<Enrolment | null> => {
    // Claim any roster rows carrying this address first — a student who signs
    // up before the instructor imports them would otherwise be stranded.
    try {
      await claimStudentRows();
      setClaimError(null);
    } catch (err) {
      // Not fatal on its own: an unclaimed account simply has no enrolment yet.
      // But if the claim FAILED rather than matched nothing, that is the reason
      // this student is stuck, and swallowing it leaves them reloading forever
      // with nothing to tell their instructor.
      setClaimError(String((err as Error)?.message ?? err));
    }
    const e = await getEnrolment();
    setEnrolment(e);
    setAssignments(e ? await listAssignments(e) : []);
    return e;
  }, []);

  useEffect(() => {
    load()
      .catch((err: unknown) => setError(String((err as Error)?.message ?? err)))
      .finally(() => setReady(true));
  }, [load]);

  // An activity opens at a time the instructor picked, so a student sitting on
  // this page at 8:59 should not have to know to reload at 9:00. Re-fetch when
  // the tab comes back to the front, and quietly on a timer while it is open.
  // Cheap: the whole list is four queries and this only runs for one student.
  useEffect(() => {
    const again = () => void load().catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", again);
    const t = window.setInterval(again, 120_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", again);
      window.clearInterval(t);
    };
  }, [load]);

  const selected = assignments.find((a) => a.activity.id === selId) ?? null;

  // The instructor can now hide an activity that is already open, so one can
  // vanish from under a student mid-session. Without this the work and detail
  // screens render nothing and leave them on a blank panel with no way back.
  useEffect(() => {
    if (selId && !selected && (screen === "detail" || screen === "work")) {
      setSelId(null);
      setScreen("list");
    }
  }, [selId, selected, screen]);
  const dueCount = assignments.filter(
    (a) => a.status === "Not started" || a.status === "Late",
  ).length;

  const openAssignment = (id: string) => {
    const a = assignments.find((x) => x.activity.id === id);
    setSelId(id);
    setTab(a && SCOPE_OF[a.activity.type] === "team" ? "team" : "indiv");
    setScreen("detail");
  };

  const shell = (body: React.ReactNode) => (
    <div className="sv">
      <aside className="sv-sidebar">
        <div className="sv-title">{enrolment?.course.name ?? "Applied Physics 50"}</div>
        <div className="sv-meta">
          {enrolment?.course.code && <span>{enrolment.course.code}</span>}
          {enrolment?.course.term && <span>· {enrolment.course.term}</span>}
        </div>

        {enrolment?.team && (
          <div className="sv-teamchip">
            <span className="sv-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
              {enrolment.team.name.replace(/[^0-9A-Za-z]/g, "").slice(0, 2).toUpperCase()}
            </span>
            <span className="sv-ellip" style={{ minWidth: 0, fontSize: "var(--text-xs)", fontWeight: 600 }}>
              {enrolment.team.name}
            </span>
          </div>
        )}

        <nav className="sv-nav">
          <button
            className={"sv-navbtn" + (screen === "tr" || screen === "trDetail" ? "" : " on")}
            onClick={() => {
              setScreen("list");
              setSelId(null);
            }}
          >
            <SIcon name="assignment" size={18} />
            <span className="lbl">Assignments</span>
            {dueCount > 0 && (
              <span
                className="sv-num"
                style={{ fontSize: "var(--text-2xs)", color: "var(--amber-700)" }}
              >
                {dueCount} due
              </span>
            )}
          </button>
          <button
            className={"sv-navbtn" + (screen === "tr" || screen === "trDetail" ? " on" : "")}
            onClick={() => {
              setScreen("tr");
              setTrId(null);
            }}
          >
            <SIcon name="groups" size={18} />
            <span className="lbl">Team resources</span>
          </button>
        </nav>

        <div className="sv-spacer" />
        <div className="sv-foot">
          <span
            className="sv-ellip"
            style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}
            title={account}
          >
            {account}
          </span>
          <button
            className="sv-btn outline sm"
            style={{ height: 26, padding: "0 10px", fontSize: "var(--text-2xs)" }}
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="sv-main">
        <div className="sv-panel">
          {enrolment && (
            <div className="sv-panelbar">
              <TeamStack enrolment={enrolment} />
            </div>
          )}
          {body}
        </div>
      </main>
    </div>
  );

  if (!ready) return shell(<div style={{ color: "var(--muted-foreground)" }}>Loading…</div>);

  if (error) {
    return shell(
      <div className="sv-card" style={{ maxWidth: 560 }}>
        <div className="sv-h2">Something went wrong</div>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)" }}>{error}</p>
      </div>,
    );
  }

  // Signed in and on nobody's roster. This used to be a dead end that told them
  // to go and ask, then reload; it is now where they present the code.
  if (!enrolment) {
    return (
      <JoinScreen>
        <JoinPanel
          account={account}
          onJoined={async () => {
            const e = await load();
            // A TF code enrols them somewhere this app has nothing to show, and
            // so does a student row that has not landed by the time we look.
            // Either way the router, not a re-render, decides where they go.
            if (!e) onRerouted?.();
          }}
          footer={
            <>
              {claimError ? (
                <p className="sv-sub" style={{ lineHeight: 1.6, marginTop: 14, maxWidth: "62ch" }}>
                  Matching your address against the class lists also reported an error, which your
                  instructor may need: <span style={{ color: "var(--navy)" }}>{claimError}</span>
                </p>
              ) : null}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  alignItems: "center",
                  marginTop: 18,
                  paddingTop: 14,
                  borderTop: "1px solid var(--neutral-200)",
                }}
              >
                {/* Your instructor can also add you by address, and that lands
                    without a code — worth a button for the student sitting
                    there while she fixes the spreadsheet. */}
                <button className="sv-btn link" type="button" onClick={() => location.reload()}>
                  No code? Check again
                </button>
                {onTeachInstead && (
                  <button className="sv-btn link" type="button" onClick={onTeachInstead}>
                    I&rsquo;m teaching a course, not taking one
                  </button>
                )}
                <button className="sv-btn link" type="button" onClick={() => void onSignOut()}>
                  Sign out
                </button>
              </div>
            </>
          }
        />
      </JoinScreen>
    );
  }

  if (screen === "submit" && selected) {
    return shell(
      <SubmitScreen
        assignment={selected}
        enrolment={enrolment}
        onBack={() => setScreen("detail")}
        onChanged={() => void load().catch(() => undefined)}
      />,
    );
  }

  if (screen === "work" && selected) {
    return shell(
      <MyWork
        assignment={selected}
        enrolment={enrolment}
        mode={workMode}
        onBack={() => setScreen("detail")}
        onSubmit={async (text, expectedUpdatedAt) => {
          // expectedUpdatedAt has to be threaded through, not defaulted: it is
          // the stamp the screen read, and it is what makes a teammate's
          // concurrent submit detectable rather than silently overwritten.
          // Passing null instead would send every re-submit down the INSERT
          // branch, hit the unique index, and read as a permanent conflict.
          if (workMode === "team") {
            // Guarded in MyWork too, but never write a submission we cannot
            // attribute to a team.
            if (!selected.teamCheckIn || !enrolment.team) return;
            await submitTeamWork(
              selected.teamCheckIn.id,
              enrolment.team.id,
              text,
              expectedUpdatedAt,
            );
          } else {
            if (!selected.indivCheckIn) return;
            await submitMyWork(
              selected.indivCheckIn.id,
              enrolment.student.id,
              text,
              expectedUpdatedAt,
            );
          }
          // A refetch failure must not be reported as a failed submit — the
          // write already landed, and telling the student otherwise makes them
          // press Submit again against a stale stamp.
          try {
            await load();
          } catch (e) {
            setError(String((e as Error)?.message ?? e));
          }
        }}
      />,
    );
  }

  if (screen === "tr" || screen === "trDetail") {
    return shell(
      <TeamResources
        enrolment={enrolment}
        assignments={assignments}
        openId={screen === "trDetail" ? trId : null}
        onOpen={(id) => {
          setTrId(id);
          setScreen("trDetail");
        }}
        onBack={() => {
          setTrId(null);
          setScreen("tr");
        }}
        onViewAssignment={(id) => openAssignment(id)}
      />,
    );
  }

  return shell(
    <Assignments
      enrolment={enrolment}
      assignments={assignments}
      selId={screen === "detail" ? selId : null}
      tab={tab}
      onSelect={openAssignment}
      onBack={() => {
        setSelId(null);
        setScreen("list");
      }}
      onTabChange={setTab}
      onOpenWork={(id, mode) => {
        setSelId(id);
        setWorkMode(mode);
        setScreen("work");
      }}
      onOpenSubmit={(id) => {
        setSelId(id);
        setScreen("submit");
      }}
      onOpenResources={() => {
        setTrId(selId);
        setScreen("trDetail");
      }}
    />,
  );
}
