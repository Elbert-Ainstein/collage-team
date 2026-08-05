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
 * The student half of the app. The shell is persistent; a single `screen` value
 * drives which panel shows, exactly as the handoff specifies.
 */
export function StudentApp({
  account,
  onSignOut,
}: {
  account: string;
  onSignOut: () => Promise<void>;
}) {
  const [screen, setScreen] = useState<Screen>("list");
  const [selId, setSelId] = useState<string | null>(null);
  const [trId, setTrId] = useState<string | null>(null);
  const [tab, setTab] = useState<"indiv" | "team">("indiv");
  // Which half of a check-in the work screen is editing.
  const [workMode, setWorkMode] = useState<"indiv" | "team">("indiv");

  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const load = useCallback(async () => {
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

  // Signed in, but no roster row carries this address.
  if (!enrolment) {
    return shell(
      <div className="sv-card" style={{ maxWidth: 620 }}>
        <div className="sv-h1" style={{ fontSize: "var(--text-xl)" }}>
          You&rsquo;re not on a roster yet
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
          We matched your account to the class list by email, and{" "}
          <strong style={{ color: "var(--navy)" }}>{account}</strong> isn&rsquo;t on it. Ask your
          instructor to add that exact address to the roster — once they do, reload this page and
          your assignments will appear.
        </p>
        {claimError ? (
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--muted-foreground)",
              lineHeight: 1.6,
              marginTop: 12,
              maxWidth: "62ch",
            }}
          >
            Matching also reported an error, which your instructor may need:{" "}
            <span style={{ color: "var(--navy)" }}>{claimError}</span>
          </p>
        ) : null}
        <button className="sv-btn outline" style={{ marginTop: 16 }} onClick={() => location.reload()}>
          Check again
        </button>
      </div>,
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
