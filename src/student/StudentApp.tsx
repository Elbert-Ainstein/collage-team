"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getEnrolment,
  listAssignments,
  submitMyWork,
  submitTeamWork,
  type Assignment,
  type Enrolment,
} from "@/checkins/studentData";
import {
  acceptTFInvitation,
  declineTFInvitation,
  listMyTFInvitations,
  redeemInviteCode,
  type JoinedCourse,
  type TFInvitation,
} from "@/checkins/invites";
import { initials, tintFor } from "@/checkins/data";
import { SCOPE_OF, type Student } from "@/checkins/types";
import { SIcon } from "./icons";
import { Assignments } from "./Assignments";
import { MyWork } from "./MyWork";
import { TeamResources } from "./TeamResources";
import { SubmitScreen } from "./SubmitScreen";
import "./student.css";

type Screen = "list" | "detail" | "work" | "submit" | "tr" | "trDetail";

const SCREENS: string[] = ["list", "detail", "work", "submit", "tr", "trDetail"];

/** The screens whose `a` is an assignment rather than a team folder. */
const OF_ASSIGNMENT: string[] = ["detail", "work", "submit"];

/**
 * Where you are, written on the URL: /ck?s=<screen>&a=<activity>&m=<half>.
 *
 * The same three params the faculty app uses, and deliberately the same
 * spelling: /ck decides which app you get from your enrolment, so ?s=detail&a=…
 * is ONE link that opens the instructor's activity page for her and the
 * student's assignment page for them. That is what makes it pasteable into
 * Canvas once rather than twice.
 *
 * Params this app does not own are left alone — AuthGate parks a class code at
 * ?join= across sign-in, and rebuilding the query from scratch would eat it.
 */
function readWhere(): {
  screen: Screen | null;
  id: string | null;
  workMode: "indiv" | "team" | null;
} {
  const q = new URLSearchParams(window.location.search);
  const s = q.get("s") ?? "";
  const m = q.get("m");
  return {
    screen: SCREENS.includes(s) ? (s as Screen) : null,
    id: q.get("a"),
    workMode: m === "indiv" || m === "team" ? m : null,
  };
}

/** The page identity a history entry is worth having for: the screen and what is on it. */
function pageOf(screen: Screen, selId: string | null, trId: string | null): string {
  const id = screen === "trDetail" ? trId : OF_ASSIGNMENT.includes(screen) ? selId : null;
  return `${screen}|${id ?? ""}`;
}

function writeWhere(
  at: { screen: Screen; selId: string | null; trId: string | null; workMode: "indiv" | "team" },
  mode: "push" | "replace",
) {
  const q = new URLSearchParams(window.location.search);
  // The assignment list is a bare /ck, so the everyday URL stays short.
  if (at.screen === "list") q.delete("s");
  else q.set("s", at.screen);
  const id =
    at.screen === "trDetail" ? at.trId : OF_ASSIGNMENT.includes(at.screen) ? at.selId : null;
  if (id) q.set("a", id);
  else q.delete("a");
  // The individual and the team answer are two different pieces of work behind
  // one activity id, so a copied work URL that did not say which would reopen
  // the wrong one half the time.
  if (at.screen === "work") q.set("m", at.workMode);
  else q.delete("m");
  const qs = q.toString();
  const url = window.location.pathname + (qs ? "?" + qs : "");
  const state: unknown = window.history.state;
  if (mode === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
}

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
 * For a student the code is now the whole of it: join_with_code (0030) WRITES
 * the roster row rather than hunting for one, so there is no list to be missing
 * from and nothing to have been done before you got here. A TF code is still
 * matched against an address the instructor entered, which is why exactly one
 * of the failures below is about an address at all.
 *
 * The failure sentences come straight from join_with_code() and are shown
 * as-is on purpose. No such code and a code that has been replaced send a
 * person to two different places — back to the board, or back to whoever handed
 * it out — and folding them into "that didn't work" would leave someone
 * retyping a code that was never the problem.
 *
 * INVITATIONS SIT ABOVE THE BOX, and this is the screen they have to sit on. A
 * teaching fellow an instructor added by typing their address has no code — she
 * never sent one, because typing the address used to BE the invite — and with
 * nothing to their name they land here, in the student app, looking at the one
 * door they cannot open. So the offer waiting for them goes first and the code
 * box second: for the person who has one, the code box is the wrong half of the
 * screen.
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
  const [invitations, setInvitations] = useState<TFInvitation[]>([]);
  /** Kept apart from `error`, which belongs to the code field further down the page. */
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [declined, setDeclined] = useState<TFInvitation | null>(null);
  const fieldId = useId();
  const noteId = useId();

  // What is already waiting for this account. Failure is swallowed on purpose:
  // nearly every person who sees this screen has no invitation, so an empty
  // list and a query that did not come back look the same to them, and neither
  // is a reason to put a database error above the box they came here to use.
  useEffect(() => {
    let alive = true;
    listMyTFInvitations()
      .then((list) => {
        if (alive) setInvitations(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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

  /**
   * Take an invitation. It ends the same way redeeming a code does — same
   * confirmation card, same handoff — because to the person pressing it these
   * are one event with two doors, and the router downstream cannot tell them
   * apart either.
   */
  const accept = async (inv: TFInvitation) => {
    if (busy) return;
    setBusy(true);
    setInviteError(null);
    try {
      const j = await acceptTFInvitation(inv.invitation_id);
      setJoined(j);
      await onJoined(j);
    } catch (err: unknown) {
      setInviteError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  /** Drops it from the list here and stops it coming back. Their row on the instructor's list is untouched. */
  const decline = async (inv: TFInvitation) => {
    if (busy) return;
    setBusy(true);
    setInviteError(null);
    try {
      await declineTFInvitation(inv.invitation_id);
      setInvitations((list) => list.filter((i) => i.invitation_id !== inv.invitation_id));
      setDeclined(inv);
    } catch (err: unknown) {
      setInviteError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

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

  // A TF code is the only one left that is checked against an address somebody
  // typed, so it is the only failure here whose fix is a conversation rather
  // than a retype. There is no student equivalent any more: a student code that
  // is live cannot be refused for who is holding it.

  const invitationCards = invitations.map((inv) => (
    <div key={inv.invitation_id} className="sv-card" style={{ maxWidth: 620, marginBottom: 14 }}>
      <div className="sv-eyebrow">Invitation</div>
      <div className="sv-h1" style={{ fontSize: "var(--text-xl)", marginTop: 6 }}>
        {inv.invited_by ? `${inv.invited_by} invited you` : "You have been invited"} to be a
        teaching fellow on {inv.course_name}
        {inv.course_code ? ` · ${inv.course_code}` : ""}
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
        Accepting opens their course for you — the roster, and the marking and check-ins
        they have turned on. You&rsquo;ll be listed under{" "}
        <strong style={{ color: "var(--navy)" }}>{account}</strong>. Nothing happens until you
        press it.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        <button
          className="sv-btn primary"
          type="button"
          disabled={busy}
          onClick={() => void accept(inv)}
        >
          Accept
        </button>
        <button
          className="sv-btn outline"
          type="button"
          disabled={busy}
          onClick={() => void decline(inv)}
        >
          Decline
        </button>
      </div>
    </div>
  ));

  const invitationNote =
    inviteError || declined ? (
      <div className="sv-card" style={{ maxWidth: 620, marginBottom: 14 }}>
        {inviteError ? (
          <p
            role="alert"
            style={{ fontSize: "var(--text-sm)", color: "var(--amber-700)", lineHeight: 1.6 }}
          >
            {inviteError}
          </p>
        ) : null}
        {/* Declining is not a door closing. The TF code still works, and the
            person who added them is the one who can hand it over — so name
            them, rather than leaving "you won't be asked again" as the last
            word to somebody who has just realised they pressed the wrong one. */}
        {declined ? (
          <p className="sv-sub" style={{ lineHeight: 1.6, maxWidth: "62ch" }}>
            You turned down {declined.course_name}, and won&rsquo;t be asked again.{" "}
            {declined.invited_by ?? "Whoever added you"} can send you the teaching fellow code if
            it was meant for you.
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      {invitationCards}
      {invitationNote}
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
          Your instructor hands out a class code — eight characters, on the board or in an email.
          Entering it puts you on their roster. There is no list you have to be on first.
        </p>
        <p id={noteId} className="sv-sub" style={{ lineHeight: 1.6, marginTop: 6, maxWidth: "62ch" }}>
          You&rsquo;ll appear on the roster under the name and address on this account. You&rsquo;re
          signed in as <strong style={{ color: "var(--navy)" }}>{account}</strong>.
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
    </>
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
  /** The activity the URL asked for, so a link that goes nowhere can say so. */
  const linked = useRef<string | null>(null);
  /** The page the restore below decided on, so the URL sync can tell it has landed. */
  const landing = useRef("list|");
  useEffect(() => {
    try {
      // THE URL WINS. sessionStorage is where a plain reload finds its way back;
      // a link is somebody telling us where to go, and running the restore first
      // would have it overwritten a tick later by wherever this tab was before.
      const url = readWhere();
      if (url.screen || url.id) {
        // An `a` with no `s` is a trimmed link, and an activity id can only have
        // meant that assignment.
        const target = url.screen ?? "detail";
        setScreen(target);
        if (target === "trDetail") setTrId(url.id);
        else setSelId(url.id);
        if (url.workMode) setWorkMode(url.workMode);
        linked.current = url.id;
        landing.current = pageOf(
          target,
          target === "trDetail" ? null : url.id,
          target === "trDetail" ? url.id : null,
        );
        return;
      }

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
      landing.current = pageOf(at.screen ?? "list", at.selId ?? null, at.trId ?? null);
    } catch {
      // Unparseable or refused storage: start on the list, which is where the
      // app started before any of this.
    } finally {
      restored.current = true;
    }
  }, []);

  // Back and forward. The URL is applied to state rather than left to the
  // browser, because a reload here refetches the whole enrolment — back must
  // not quietly turn into that.
  const popped = useRef(false);
  useEffect(() => {
    const onPop = () => {
      const at = readWhere();
      const target = at.screen ?? (at.id ? "detail" : "list");
      popped.current = true;
      setScreen(target);
      setTrId(target === "trDetail" ? at.id : null);
      if (target !== "trDetail") setSelId(at.id);
      if (at.workMode) setWorkMode(at.workMode);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Set by a correction, so being sent back to the list is not a place to go back to. */
  const replaceNext = useRef(false);
  const lastPage = useRef<string | null>(null);
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

    const page = pageOf(screen, selId, trId);

    // A state change that CAME from the URL is not written back to it — that is
    // how back turns into a loop that cannot leave the page.
    if (popped.current) {
      popped.current = false;
      lastPage.current = page;
      return;
    }

    if (lastPage.current === null) {
      // Still on the mount commit. This effect runs in the same pass as the
      // restore above, which has QUEUED its state and not had it applied, so the
      // values here are the pre-restore ones — writing them would erase the very
      // link we arrived on. Wait for the commit that matches what the restore
      // asked for, then say it once, as a replace: you are already on that URL,
      // and it must not become somewhere to go back to.
      if (page !== landing.current) return;
      lastPage.current = page;
      writeWhere({ screen, selId, trId, workMode }, "replace");
      return;
    }

    // A history entry per PAGE — the screen and the assignment on it. Switching
    // the individual/team tab replaces instead, because it is one page showing
    // two columns of itself, and so does any bounce off an assignment that
    // turned out not to be there.
    const moved = page !== lastPage.current;
    writeWhere(
      { screen, selId, trId, workMode },
      moved && !replaceNext.current ? "push" : "replace",
    );
    lastPage.current = page;
    replaceNext.current = false;
  }, [screen, selId, trId, tab, workMode]);

  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A sentence about a link that led nowhere. Separate from `error`, which
   * replaces the whole panel — this one has to sit ABOVE the assignment list,
   * because the list is the useful thing on the screen and the reason they are
   * looking at it instead of the page they clicked.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /** The code box, opened from the sidebar rather than only by having nothing. */
  const [joining, setJoining] = useState(false);

  // Returns the enrolment it found, because redeeming a code has to know
  // whether this app now has anything to show — a TF code leaves it null and
  // needs the router, not a re-render.
  const load = useCallback(async (): Promise<Enrolment | null> => {
    // Nothing to claim before reading: an address sweep used to run here, and
    // redeeming a code is the only thing that enrols anyone now.
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
    // NOT until the first load has landed. `assignments` is empty for the whole
    // of it, so a restored — or linked — assignment looks exactly like a deleted
    // one, and this used to bounce it back to the list before it had a chance to
    // arrive: the reload you did to get back to your work always dumped you on
    // the list instead.
    if (!ready) return;
    // Nor while they are on nobody's roster. A Canvas link clicked by a student
    // who has not entered their class code yet lands on the code box, and the
    // assignment it points at has to still be waiting for them on the other side
    // of it rather than have been discarded as missing while they typed.
    if (!enrolment) return;
    if (selected) linked.current = null;
    if (!selId || selected || !OF_ASSIGNMENT.includes(screen)) return;
    // A correction, not a destination: replaced rather than pushed, so back does
    // not lead to the page that just turned out not to be there and bounce again.
    replaceNext.current = true;
    // Say so when a LINK pointed here. Vanishing mid-session is one thing — you
    // were just looking at it — but a link off Canvas gives no clue at all, and
    // hidden and non-existent are the same thing from here: the row is simply
    // not readable, so the sentence must cover both without guessing.
    if (linked.current && linked.current === selId) {
      setNotice(
        "That link points to an assignment you can't open yet. Your instructor may not have posted it, or it may belong to another class.",
      );
    }
    linked.current = null;
    setSelId(null);
    setScreen("list");
  }, [selId, selected, screen, ready, enrolment]);
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
        {/* The code box used to live only on the empty state, which meant it
            vanished the moment you got in — so a student in a second course, or
            one handed a corrected code after their instructor rotated it, had
            nowhere to type it. It is a door, not a greeting. */}
        <button
          type="button"
          className="sv-btn link"
          style={{
            justifyContent: "flex-start",
            padding: "8px 10px",
            margin: "0 0 4px",
            fontSize: "var(--text-xs)",
          }}
          onClick={() => setJoining(true)}
        >
          Join another class
        </button>
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
          {notice && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                marginBottom: 14,
                border: "1px solid var(--neutral-200)",
                borderRadius: "var(--radius-md)",
                background: "var(--cream-100)",
                fontSize: "var(--text-sm)",
                lineHeight: 1.55,
                color: "var(--navy)",
              }}
            >
              <span style={{ flex: 1 }}>{notice}</span>
              <button
                type="button"
                className="sv-btn link"
                style={{ padding: 0, fontSize: "var(--text-xs)" }}
                onClick={() => setNotice(null)}
              >
                Dismiss
              </button>
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
              {/* Not a way in without a code — there is no longer one. It
                  re-reads the account for something that landed elsewhere: a
                  code redeemed in another tab, or an instructor switching a
                  wrongly-picked faculty account back to a student one. */}
              <button className="sv-btn link" type="button" onClick={() => location.reload()}>
                Check again
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
          }
        />
      </JoinScreen>
    );
  }

  // Opened from the sidebar by somebody who is already in a course. Same panel,
  // because a second code is the same act as a first one — the only difference
  // is that this time there is something to go back to.
  if (joining) {
    return (
      <JoinScreen>
        <JoinPanel
          account={account}
          onJoined={async (j) => {
            await load();
            setJoining(false);
            // A TF code, or an invitation accepted from this panel, makes the
            // account staff on a course this app has nothing to show for. The
            // student view they came from is still theirs, so nothing is
            // reloaded out from under them — but the router has to be asked
            // again, or the press appears to have done nothing at all.
            if (j.kind === "tf") onRerouted?.();
          }}
          footer={
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--neutral-200)" }}>
              <button className="sv-btn link" type="button" onClick={() => setJoining(false)}>
                Back to {enrolment.course.name}
              </button>
            </div>
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
