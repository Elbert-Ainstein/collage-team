"use client";

// Student view — sections 2 (Assignments list) and 3 (Assignment detail) of
// docs/team-module/design-handoff-student-view/README.md.
//
// The modelling rule the whole screen hangs off: SCOPE, not type. The activity
// type only picks a label and an accent colour; SCOPE_OF[type] decides whether
// the detail shows Individual/Team tabs and which layout renders.
//
// Real data arrives via props (activities, weeks, due dates, status, grade,
// submissions, the team), and the Audio card is real too — it records, stores
// and replays through src/checkins/audio.ts. The regions with no schema behind
// them yet — the team-resource tiles, the live-grading rubric, the question
// count — are rendered from the handoff's seed copy and are labelled "Sample"
// in their section header so nobody mistakes them for live data.

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { ensureTeamResult } from "@/checkins/studentData";
import type { Assignment, AssignmentStatus, Enrolment } from "@/checkins/studentData";
import type { ActivityType, Scope, Student } from "@/checkins/types";
import { SCOPE_LABEL, SCOPE_OF, TYPE_LABEL } from "@/checkins/types";
import { SIcon } from "./icons";
import { Recorder } from "./Recorder";

// ------------------------------------------------------------------ tokens

/** Accent per type — the only thing type controls, besides its label. */
const ACCENT: Record<ActivityType, string> = {
  challenge: "var(--orange-500)",
  combo: "var(--navy-700)",
  skills: "var(--sky-700)",
  amplify: "var(--lavender-600)",
};

const TYPE_BADGE: Record<ActivityType, string> = {
  challenge: "orange",
  combo: "sky",
  skills: "sky",
  amplify: "lavender",
};

const STATUS_BADGE: Record<AssignmentStatus, string> = {
  "Turned in": "sky",
  Late: "warning",
  "Not started": "outline",
  Graded: "success",
  Discussing: "warning",
  Excused: "secondary",
};

const GRADE_NOTE: Record<Scope, string> = {
  team: "Team mark",
  both: "Your mark, plus the team discussion",
  indiv: "Released after grading",
};

type Filter = "all" | "todo" | "submitted" | "graded";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "todo", label: "To do" },
  { value: "submitted", label: "Submitted" },
  { value: "graded", label: "Graded" },
];

function inFilter(f: Filter, s: AssignmentStatus): boolean {
  switch (f) {
    case "all":
      return true;
    case "todo":
      return s === "Not started" || s === "Late";
    case "submitted":
      return s === "Turned in" || s === "Discussing";
    case "graded":
      return s === "Graded";
  }
}

// ------------------------------------------------------------- derivations

/**
 * "Thu 9:00am". Fixed locale so the server and the client agree. Rows always
 * sit under a week heading carrying the date range, so the weekday is enough.
 */
function fmtWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const h24 = d.getHours();
  const suffix = h24 >= 12 ? "pm" : "am";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${weekday} ${h}:${String(d.getMinutes()).padStart(2, "0")}${suffix}`;
}

/** The due line under a row title, and the warning badge on the detail card. */
function dueLine(a: Assignment): string {
  const act = a.activity;
  const scope = SCOPE_OF[act.type];
  const closed = act.stage >= 4;
  const verb = closed ? "Closed" : "Due";
  // due_at is what the faculty app writes (migration 0007). The older per-scope
  // columns are still honoured so activities authored before it keep their
  // dates, but they are the fallback now, not the source.
  const indiv = fmtWhen(act.due_at ?? act.individual_due_at);
  const team = fmtWhen(act.due_at ?? act.team_due_at);

  if (scope === "team") {
    return team ? `${verb} ${team}` : act.dates_label ?? "No due date set";
  }
  if (scope === "indiv") {
    return indiv ? `${verb} ${indiv}` : act.dates_label ?? "No due date set";
  }
  if (indiv && team) {
    return closed ? `${verb} ${indiv}` : `${verb} ${indiv} · discussion ${team}`;
  }
  const only = indiv ?? team;
  return only ? `${verb} ${only}` : act.dates_label ?? "No due date set";
}

/**
 * Whether work actually arrived.
 *
 * Deliberately one definition, because two would drift: a draft result row is
 * created the moment the hand-in screen is opened, so "is there a result" and
 * "is there a timestamp" both answer yes for a student who has submitted
 * nothing. And "Late" is not a late submission — statusOf gives it to a row
 * with nothing in it once the activity is past its stage, so it means
 * missing-and-overdue.
 */
function handedIn(a: Assignment): boolean {
  return a.status === "Turned in" || a.status === "Graded" || a.status === "Discussing";
}

/** When it arrived — null whenever nothing did, whatever timestamp the row carries. */
function submittedAt(a: Assignment): string | null {
  if (!a.submitted || !handedIn(a)) return null;
  return fmtWhen(a.submitted) ?? a.submitted;
}

function statusStamp(a: Assignment): string {
  const when = submittedAt(a);
  if (when) return `Submitted ${when}`;
  if (a.status === "Graded") return "Marked in session";
  // Including "Late": saying "submitted late" over work that never came would
  // tell a student the deadline is behind them when it is the thing they still
  // have to act on.
  return "Nothing submitted yet";
}

interface WeekGroup {
  key: string;
  label: string;
  dates: string;
  items: Assignment[];
}

/** Newest week first; the top two groups get the friendly labels. */
function groupByWeek(list: Assignment[]): WeekGroup[] {
  const buckets = new Map<number | null, Assignment[]>();
  for (const a of list) {
    const week = a.activity.week;
    const bucket = buckets.get(week);
    if (bucket) bucket.push(a);
    else buckets.set(week, [a]);
  }

  const keys = [...buckets.keys()].sort((x, y) => {
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });

  return keys.map((week, i) => {
    const items = (buckets.get(week) ?? []).slice().sort((p, q) => p.activity.position - q.activity.position);
    const named = i === 0 ? "This week" : i === 1 ? "Last week" : null;
    const weekLabel = week === null ? "Undated" : `Week ${week}`;
    const range = items.find((it) => it.activity.dates_label)?.activity.dates_label ?? null;
    const parts: string[] = [];
    if (named && week !== null) parts.push(weekLabel);
    if (range) parts.push(range);
    return {
      key: week === null ? "none" : String(week),
      label: named ?? weekLabel,
      dates: parts.join(" · "),
      items,
    };
  });
}

/** First names of the student's teammates, excluding the student themselves. */
function teammateNames(enrolment: Enrolment): string[] {
  return enrolment.teammates
    .filter((s: Student) => s.id !== enrolment.student.id)
    .map((s) => s.name.trim().split(/\s+/)[0])
    .filter((n) => n.length > 0);
}

// ------------------------------------------------------------------- atoms

/** Honest marker for a region rendered from the handoff's seed copy. */
function SampleTag({ what }: { what: string }) {
  return (
    <span className="sv-badge outline" title={`Sample content — ${what}`}>
      Sample
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="sv-eyebrow">{children}</div>;
}

const CARD_BODY: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "var(--text-sm)",
  lineHeight: 1.6,
  color: "var(--navy)",
  maxWidth: "68ch",
};

// -------------------------------------------------------------------- list

function ActivityRow({ a, onSelect }: { a: Assignment; onSelect: (id: string) => void }) {
  const act = a.activity;
  const scope = SCOPE_OF[act.type];
  return (
    <button
      type="button"
      onClick={() => onSelect(act.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        width: "100%",
        padding: "13px 16px",
        border: "1px solid var(--neutral-200)",
        borderLeft: `3px solid ${ACCENT[act.type]}`,
        background: "var(--cream-100)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        font: "inherit",
        color: "var(--navy)",
        textAlign: "left",
        cursor: "pointer",
        transition: "background 140ms ease, box-shadow 140ms ease",
      }}
    >
      <span
        style={{
          flex: "none",
          width: 82,
          fontSize: "var(--text-2xs)",
          letterSpacing: "var(--tracking-wide)",
          textTransform: "uppercase",
          fontWeight: "var(--weight-semibold)",
          color: ACCENT[act.type],
        }}
      >
        {TYPE_LABEL[act.type]}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-base)",
              fontWeight: "var(--weight-bold)",
              letterSpacing: "var(--tracking-tight)",
            }}
          >
            {act.title}
          </span>
          <span className="sv-badge outline">{SCOPE_LABEL[scope]}</span>
        </span>
        <span
          style={{
            display: "block",
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
            marginTop: 3,
          }}
        >
          {dueLine(a)}
        </span>
      </span>

      <span className={`sv-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span>

      <span
        className="sv-num"
        style={{ width: 74, flex: "none", textAlign: "right", fontSize: "var(--text-xs)", color: "var(--navy)" }}
      >
        {a.grade}
      </span>

      <span style={{ color: "var(--muted-foreground)", display: "flex", alignItems: "center" }}>
        <SIcon name="chevronRight" size={18} />
      </span>
    </button>
  );
}

function AssignmentsList({
  enrolment,
  assignments,
  filter,
  onFilter,
  onSelect,
}: {
  enrolment: Enrolment;
  assignments: Assignment[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  onSelect: (id: string) => void;
}) {
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: assignments.length, todo: 0, submitted: 0, graded: 0 };
    for (const a of assignments) {
      if (inFilter("todo", a.status)) c.todo += 1;
      if (inFilter("submitted", a.status)) c.submitted += 1;
      if (inFilter("graded", a.status)) c.graded += 1;
    }
    return c;
  }, [assignments]);

  const groups = useMemo(
    () =>
      groupByWeek(assignments)
        .map((g) => ({ ...g, items: g.items.filter((a) => inFilter(filter, a.status)) }))
        .filter((g) => g.items.length > 0),
    [assignments, filter],
  );

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 className="sv-h1">Assignments</h1>
        <span className="sv-sub">Everything you owe, and everything your team owes together.</span>
      </div>

      <div style={{ margin: "14px 0 18px" }}>
        <div className="sv-tabs" role="tablist" aria-label="Filter assignments">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              className={`sv-tab${filter === f.value ? " on" : ""}`}
              onClick={() => onFilter(f.value)}
            >
              {f.value === "all" ? f.label : `${f.label} · ${counts[f.value]}`}
            </button>
          ))}
        </div>
      </div>

      {assignments.length === 0 ? (
        <div className="sv-card" style={{ padding: "34px 20px", textAlign: "center" }}>
          <div className="sv-h2">Nothing assigned yet</div>
          <p className="sv-sub" style={{ margin: "8px 0 0" }}>
            When your instructor posts an activity in {enrolment.course.name}, it shows up here.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="sv-card" style={{ padding: "26px 20px", textAlign: "center" }}>
          <p className="sv-sub" style={{ margin: 0 }}>
            Nothing in this filter. {counts.all} assignment{counts.all === 1 ? "" : "s"} in total.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {groups.map((g) => (
            <div key={g.key}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: "var(--text-base)",
                    fontWeight: "var(--weight-bold)",
                    letterSpacing: "var(--tracking-tight)",
                  }}
                >
                  {g.label}
                </span>
                {g.dates ? <span className="sv-sub">{g.dates}</span> : null}
                <span className="sv-rule" style={{ flex: 1 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.items.map((a) => (
                  <ActivityRow key={a.activity.id} a={a} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ detail

const STRIP: { icon: string; title: string; meta: string; bg: string }[] = [
  { icon: "image", title: "Final board", meta: "Thu 2:14pm", bg: "var(--neutral-100)" },
  { icon: "mic", title: "Thursday session", meta: "12:41", bg: "var(--sky-100)" },
  { icon: "assignment", title: "Trials 1–3", meta: "Generated", bg: "var(--cream-400)" },
];

/** Seed copy from the handoff, used only when the activity carries no brief. */
const SEED_DESCRIPTION = "Work the problem set on your own, then bring your answers to the discussion.";
const SEED_INSTRUCTIONS = "Record the discussion. Rotate who presents each problem.";
const SEED_QUESTION_COUNT = "5 questions";
const SEED_PRESENTERS = ["Ellie", "Caleb"];
const RUBRIC: [number, number][] = [
  [5, 4],
  [4, 5],
];

function DescriptionCard({ a }: { a: Assignment }) {
  const brief = a.activity.source_text?.trim();
  const sampleOf = brief
    ? "the question count has no schema behind it yet"
    : "no brief has been posted, and the question count has no schema behind it yet";
  return (
    <div className="sv-card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="sv-eyebrow" style={{ flex: 1 }}>
          Description
        </div>
        <SampleTag what={sampleOf} />
      </div>
      <p style={CARD_BODY}>{brief || SEED_DESCRIPTION}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <span className="sv-badge secondary">{SEED_QUESTION_COUNT}</span>
        <span className="sv-badge warning">{dueLine(a)}</span>
      </div>
    </div>
  );
}

/**
 * Why this activity cannot hold audio, or null when it can.
 *
 * Only two things can stop it now, and neither is the student's doing: no team
 * check-in on the activity, and no team to own the recording. The third reason
 * this used to give — "your team hasn't submitted yet" — was wrong about the
 * order people work in. A team records the discussion and then writes the
 * answer, so requiring the answer first meant the recorder was dark on every
 * activity except the ones already finished.
 */
function whyNoAudio(enrolment: Enrolment, a: Assignment): string | null {
  if (!a.teamCheckIn) {
    return (
      "This activity has no team check-in, so there is no shared submission for a " +
      "recording to belong to. Your instructor adds one when the discussion is part " +
      "of the work."
    );
  }
  if (!enrolment.team) {
    return (
      "You are not on a team yet, and a recording belongs to a team rather than to " +
      "one person. Your instructor assigns teams — once you are on one, the recorder " +
      "appears here."
    );
  }
  return null;
}

function ResourceStrip({ onOpenResources }: { onOpenResources: () => void }) {
  return (
    <div className="sv-card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div className="sv-eyebrow" style={{ flex: 1 }}>
          Team resources
        </div>
        <SampleTag what="team artefacts have no schema behind them yet" />
        <button
          type="button"
          className="sv-btn link"
          onClick={onOpenResources}
          style={{ color: "var(--navy-700)" }}
        >
          Open all
        </button>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {STRIP.map((t) => (
          <div
            key={t.title}
            style={{
              width: 150,
              border: "1px solid var(--neutral-200)",
              background: "var(--cream-300)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 62,
                background: t.bg,
                color: "var(--muted-foreground)",
              }}
            >
              <SIcon name={t.icon} size={20} />
            </div>
            <div style={{ padding: "8px 10px" }}>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", lineHeight: 1.3 }}>
                {t.title}
              </div>
              <div style={{ fontSize: "var(--text-2xs)", color: "var(--muted-foreground)", marginTop: 2 }}>
                {t.meta}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusCard({ a, scope }: { a: Assignment; scope: Scope }) {
  const when = submittedAt(a);
  const arrived = handedIn(a);
  return (
    <div className="sv-card" style={{ padding: "16px 18px" }}>
      <Eyebrow>Status</Eyebrow>
      <div style={{ marginTop: 8 }}>
        <span className={`sv-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span>
      </div>
      <div
        className="sv-num"
        style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: 8 }}
      >
        {statusStamp(a)}
      </div>

      {/* Nothing about a grade until something has actually been handed in.
          "Pending — released after grading" over work that was never submitted
          reads as though it is with a marker and the student is waiting, when
          in fact nothing has been sent and the deadline is still theirs to
          meet. Same for a Resubmit button with nothing to resubmit. */}
      {arrived ? (
        <>
          <div className="sv-rule" style={{ margin: "14px 0" }} />

          <Eyebrow>Grade</Eyebrow>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-lg)",
                fontWeight: "var(--weight-bold)",
                color: "var(--muted-foreground)",
              }}
            >
              {a.grade === "—" ? "Pending" : a.grade}
            </span>
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: 4 }}>
            {GRADE_NOTE[scope]}
          </div>

          {when ? (
            <div
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--muted-foreground)",
                marginTop: 12,
                textAlign: "center",
              }}
            >
              Handed in {when}. Open your work to replace it.
            </div>
          ) : null}
        </>
      ) : (
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
            marginTop: 12,
            lineHeight: 1.55,
          }}
        >
          Nothing has been handed in yet, so there is no mark to wait for.
        </div>
      )}
    </div>
  );
}

function LiveGrading({ names }: { names: string[] }) {
  const presenters = names.slice(0, 2).map((name, i) => ({
    slot: `Presenter ${i + 1}`,
    name,
    scores: [
      { label: "Accuracy", value: RUBRIC[i][0] },
      { label: "Collaboration", value: RUBRIC[i][1] },
    ],
  }));

  return (
    <div style={{ borderLeft: "1px solid var(--neutral-200)", padding: "2px 0 2px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="sv-eyebrow" style={{ flex: 1 }}>
          Live grading
        </div>
        <SampleTag what="the rubric has no schema behind it yet" />
        <span
          style={{
            display: "inline-block",
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "var(--emerald-500)",
          }}
        />
      </div>
      <div style={{ fontSize: "var(--text-2xs)", color: "var(--muted-foreground)", marginTop: 5 }}>
        Marked by your instructor during the session
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
        {presenters.map((p) => (
          <div key={p.slot} style={{ borderTop: "1px solid var(--neutral-200)", paddingTop: 11 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{ fontSize: "var(--text-2xs)", color: "var(--muted-foreground)", whiteSpace: "nowrap" }}
              >
                {p.slot}
              </span>
              <span className="sv-ellip" style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}>
                {p.name}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9 }}>
              {p.scores.map((s) => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      width: 78,
                      flex: "none",
                      fontSize: "var(--text-xs)",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    {s.label}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background: "var(--neutral-200)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: `${(s.value / 5) * 100}%`,
                        height: "100%",
                        borderRadius: 3,
                        background: s.value === 5 ? "var(--emerald-600)" : "var(--navy-700)",
                      }}
                    />
                  </span>
                  <span
                    className="sv-num"
                    style={{ fontSize: "var(--text-xs)", width: 26, textAlign: "right" }}
                  >
                    {s.value}/5
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssignmentDetail({
  enrolment,
  a,
  tab,
  onBack,
  onTabChange,
  onOpenWork,
  onOpenResources,
  showLiveGrading,
}: {
  enrolment: Enrolment;
  a: Assignment;
  tab: "indiv" | "team";
  onBack: () => void;
  onTabChange: (t: "indiv" | "team") => void;
  onOpenWork: (id: string, mode: "indiv" | "team") => void;
  onOpenResources: () => void;
  showLiveGrading: boolean;
}) {
  const act = a.activity;
  const scope = SCOPE_OF[act.type];
  // Tab state is ignored for single-scope activities, so it can never strand
  // the student on a tab that does not exist.
  const effective: "indiv" | "team" = scope === "both" ? tab : scope;
  const onIndiv = effective === "indiv";
  const onTeam = effective === "team";

  // The team's result row, created on demand so the recorder has somewhere to
  // attach. MyWork does the same for the individual side; this is the team twin,
  // and without it audio only ever worked on activities a team had already
  // written an answer into.
  //
  // Only while the team half is actually on screen: an activity a student never
  // opens the Team tab of should not gain a row.
  // Stored WITH the check-in it was made for, and ignored when that does not
  // match. This component is not keyed on the activity, so React keeps the same
  // instance when a student goes back and opens a different one — a bare id
  // would survive that and point the next activity's recorder at the previous
  // activity's row.
  const [made, setMade] = useState<{ checkInId: string; resultId: string } | null>(null);
  const teamCheckInId = a.teamCheckIn?.id ?? null;
  const teamId = enrolment.team?.id ?? null;
  const teamResultId =
    a.teamResult?.id ?? (made && made.checkInId === teamCheckInId ? made.resultId : null);

  useEffect(() => {
    if (!onTeam || !teamCheckInId || !teamId || teamResultId) return;
    let alive = true;
    ensureTeamResult(teamCheckInId, teamId)
      .then((id) => {
        if (alive) setMade({ checkInId: teamCheckInId, resultId: id });
      })
      // Swallowed on purpose: the Recorder shows its own message when it has no
      // row, and a failure here must not take down an activity a student opened
      // to read the brief.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [onTeam, teamCheckInId, teamId, teamResultId]);

  const weekLabel = act.week == null ? act.dates_label ?? "Unscheduled" : `Week ${act.week}`;
  const brief = act.source_text?.trim();
  const names = teammateNames(enrolment);
  const gradingNames = names.length ? names : SEED_PRESENTERS;

  const teamSavedLine = !enrolment.team
    ? "You are not on a team yet"
    : a.teamResult?.status === "scored"
      ? `Graded · ${a.teamGrade}`
      : a.teamResult?.text
        ? `Submitted ${fmtWhen(a.teamResult.updated_at) ?? "recently"} by your team`
        : "Your team has not submitted yet";

  // Seeing an activity and being able to hand work in are separate things: an
  // activity is visible from the moment it opens, but its check-in is a
  // separate row the instructor may not have added yet.
  const savedLine = !a.indivCheckIn
    ? "Not open for submissions yet"
    : a.myResult?.status === "draft"
      ? `Draft saved ${fmtWhen(a.myResult.updated_at) ?? "recently"}`
      : submittedAt(a)
        ? `Submitted ${submittedAt(a)}`
        : "Nothing saved yet";

  return (
    <section>
      <button type="button" className="sv-btn link" onClick={onBack} style={{ gap: 4 }}>
        <SIcon name="chevronLeft" size={15} />
        All assignments
      </button>

      <div style={{ display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap", marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 420 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className={`sv-badge ${TYPE_BADGE[act.type]}`}>{TYPE_LABEL[act.type]}</span>
            <h1 className="sv-h1">{act.title}</h1>
          </div>
          <div className="sv-sub" style={{ marginTop: 5 }}>
            {weekLabel} · {SCOPE_LABEL[scope]}
          </div>

          {scope === "both" ? (
            <div style={{ margin: "16px 0 0" }}>
              <div className="sv-tabs" role="tablist" aria-label="Assignment view">
                {([
                  { value: "indiv" as const, label: "Individual" },
                  { value: "team" as const, label: "Team" },
                ]).map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={effective === t.value}
                    className={`sv-tab${effective === t.value ? " on" : ""}`}
                    onClick={() => onTabChange(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {onIndiv ? (
            <div>
              <DescriptionCard a={a} />
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
                <button
                  type="button"
                  className="sv-btn primary"
                  onClick={() => onOpenWork(act.id, "indiv")}
                  disabled={!a.indivCheckIn}
                  title={
                    a.indivCheckIn
                      ? "Write and submit your own answer"
                      : "Your instructor has not opened this for submissions yet"
                  }
                >
                  Open my work
                </button>
                <span className="sv-sub">{savedLine}</span>
              </div>
            </div>
          ) : null}

          {onTeam ? (
            <div>
              <div className="sv-card" style={{ marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="sv-eyebrow" style={{ flex: 1 }}>
                    Instructions
                  </div>
                  {brief ? null : <SampleTag what="no brief has been posted for this activity" />}
                </div>
                <p style={CARD_BODY}>{brief || SEED_INSTRUCTIONS}</p>
              </div>

              <Recorder resultId={teamResultId} unavailable={whyNoAudio(enrolment, a)} />

              {a.teamCheckIn ? (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginTop: 14,
                  }}
                >
                  <button
                    type="button"
                    className="sv-btn primary"
                    onClick={() => onOpenWork(act.id, "team")}
                    disabled={!enrolment.team}
                    title={
                      enrolment.team
                        ? "Write and submit the answer your team agreed on"
                        : "You are not on a team yet"
                    }
                  >
                    Open team work
                  </button>
                  <span className="sv-sub">{teamSavedLine}</span>
                </div>
              ) : null}

              <ResourceStrip onOpenResources={onOpenResources} />
            </div>
          ) : null}
        </div>

        <div style={{ width: 270, flex: "none", display: "flex", flexDirection: "column", gap: 12 }}>
          {onIndiv ? <StatusCard a={a} scope={scope} /> : null}
          {onTeam && showLiveGrading ? <LiveGrading names={gradingNames} /> : null}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- entry

export function Assignments(props: {
  enrolment: Enrolment;
  assignments: Assignment[];
  selId: string | null;
  tab: "indiv" | "team";
  onSelect: (id: string) => void;
  onBack: () => void;
  onTabChange: (t: "indiv" | "team") => void;
  onOpenWork: (id: string, mode: "indiv" | "team") => void;
  onOpenResources: () => void;
  showLiveGrading?: boolean;
}) {
  const {
    enrolment,
    assignments,
    selId,
    tab,
    onSelect,
    onBack,
    onTabChange,
    onOpenWork,
    onOpenResources,
    showLiveGrading = true,
  } = props;

  const [filter, setFilter] = useState<Filter>("all");

  const selected = selId === null ? null : assignments.find((a) => a.activity.id === selId) ?? null;

  if (selId !== null && !selected) {
    return (
      <section>
        <button type="button" className="sv-btn link" onClick={onBack} style={{ gap: 4 }}>
          <SIcon name="chevronLeft" size={15} />
          All assignments
        </button>
        <div className="sv-card" style={{ marginTop: 14, padding: "26px 20px", textAlign: "center" }}>
          <div className="sv-h2">That assignment is not available</div>
          <p className="sv-sub" style={{ margin: "8px 0 0" }}>
            Your instructor either removed it or has not opened it yet — an activity can be
            scheduled to appear later in the term. Go back to the list to pick another one.
          </p>
        </div>
      </section>
    );
  }

  if (selected) {
    return (
      <AssignmentDetail
        enrolment={enrolment}
        a={selected}
        tab={tab}
        onBack={onBack}
        onTabChange={onTabChange}
        onOpenWork={onOpenWork}
        onOpenResources={onOpenResources}
        showLiveGrading={showLiveGrading}
      />
    );
  }

  return (
    <AssignmentsList
      enrolment={enrolment}
      assignments={assignments}
      filter={filter}
      onFilter={setFilter}
      onSelect={onSelect}
    />
  );
}
