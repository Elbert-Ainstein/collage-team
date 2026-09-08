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

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { BriefText } from "@/checkins/BriefText";
import { briefFiles } from "@/checkins/briefLinks";
import { ensureTeamResult } from "@/checkins/studentData";
import { getMyMarks, SCALE_LABEL, type StudentMark } from "@/checkins/tutorial";
import {
  listTeamResources,
  previewable,
  resourceUrls,
  type TeamResource,
} from "@/checkins/resources";
import { RESIGN_MS } from "@/checkins/storage";
import { listMyQuestions } from "@/checkins/studentData";
import type { Assignment, AssignmentStatus, Enrolment } from "@/checkins/studentData";
import type {
  Activity,
  ActivityQuestion,
  ActivityType,
  CheckInResult,
  FileRef,
  Scope,
  Student,
} from "@/checkins/types";
import { INDIV_ELSEWHERE, SCOPE_LABEL, SCOPE_OF, TYPE_LABEL } from "@/checkins/types";
// The activity's attachments are the instructor's file, read here rather than
// written: the rules and the signing live with the side that uploads them, and
// a second copy of "is this a PDF" on the reading side is how the two surfaces
// come to disagree about what a student is looking at.
import { kindOf } from "@/faculty/activityFiles";
import { activityFileUrls } from "@/faculty/facultyData";
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
  // Neutral, not amber: there is nothing here for the student to act on.
  "Answered elsewhere": "outline",
  Graded: "success",
  Discussing: "warning",
  Excused: "secondary",
};

/**
 * Where the individual half is answered, when it is not here — "Amplify".
 * Null for everything a student hands in through this app.
 */
function elsewhereName(a: Assignment): string | null {
  if (SCOPE_OF[a.activity.type] === "team") return null;
  return INDIV_ELSEWHERE[a.activity.type];
}

/**
 * The badge's words.
 *
 * The status is generic — the model has no opinion about which platform — and
 * a badge reading "Answered elsewhere" would make a student go looking for the
 * elsewhere. Name it.
 */
function statusLabel(a: Assignment): string {
  if (a.status !== "Answered elsewhere") return a.status;
  const place = elsewhereName(a);
  return place ? `Answered in ${place}` : a.status;
}

/**
 * What the marker wrote back, if anything, and only once it is theirs to read.
 *
 * Gated on `status === "scored"` — the same condition gradeOf uses to stop
 * returning "—". A note is written while marking, often days before release and
 * often edited in between, so showing it any earlier would put a half-finished
 * judgement in front of the person it is about and break the rule that a grade
 * reaches a student when it is RELEASED, not when it is typed.
 *
 * Faculty had been writing these into a box labelled "Comments for this
 * student" that no student-facing screen read.
 */
function MarkerNote({ result }: { result: CheckInResult | null }): JSX.Element | null {
  const note = result?.status === "scored" ? result.feedback?.trim() : null;
  if (!note) return null;
  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "var(--cream-200)",
        border: "1px solid var(--cream-500)",
      }}
    >
      <Eyebrow>From your instructor</Eyebrow>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: "var(--text-xs)",
          lineHeight: 1.6,
          // Their line breaks are theirs; a marker's note is often a short list.
          whiteSpace: "pre-wrap",
        }}
      >
        {note}
      </p>
    </div>
  );
}

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
      // "Answered elsewhere" is deliberately absent: To do is the list of
      // things the student still has to do, and this is not one of them.
      return s === "Not started" || s === "Late";
    case "submitted":
      return s === "Turned in" || s === "Discussing";
    case "graded":
      return s === "Graded";
  }
}

// ------------------------------------------------------------- derivations

/**
 * "Thu Oct 9, 9:00am". Fixed locale so the server and the client agree.
 *
 * This printed the weekday alone, on the grounds that a row sits under a week
 * heading carrying the date range. It does not: dates_label is optional and
 * mostly unset, so the heading is usually a bare "Week 9" — and the same string
 * is printed on the detail card's due badge and on every "Submitted"/"Handed in"
 * stamp, none of which have a heading above them at all. A student looking at
 * week 9 could not tell which Thursday. Comma rather than "·" between the date
 * and the time: dueLine already spends "·" separating two deadlines, and one
 * separator doing both jobs turns "Due X · Y · discussion Z · W" into a list of
 * four things.
 */
function fmtWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const h24 = d.getHours();
  const suffix = h24 >= 12 ? "pm" : "am";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${weekday} ${day}, ${h}:${String(d.getMinutes()).padStart(2, "0")}${suffix}`;
}

/**
 * The deadline the individual hand-in is judged against.
 *
 * due_at is what the faculty app writes (migration 0007) and it is the
 * INDIVIDUAL deadline — the editor over there says so in as many words. The
 * older per-scope column is still honoured so activities authored before 0007
 * keep their date, but it is the fallback now, not the source.
 */
function indivDueAt(act: Activity): string | null {
  return act.due_at ?? act.individual_due_at;
}

/** The due line under a row title, and the warning badge on the detail card. */
function dueLine(a: Assignment): string {
  const act = a.activity;
  const scope = SCOPE_OF[act.type];
  const closed = act.stage >= 4;
  const verb = closed ? "Closed" : "Due";
  const indiv = fmtWhen(indivDueAt(act));
  // Not due_at, except where there is no individual half for it to belong to.
  // Printing the individual deadline as the discussion date told a team its
  // answer was owed on the day its members' own work was — two different
  // deadlines reported as one.
  const team = fmtWhen(scope === "team" ? (act.team_due_at ?? indivDueAt(act)) : act.team_due_at);

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

/**
 * The instant work arrived — null whenever nothing did, whatever timestamp the
 * row happens to carry.
 *
 * submitted_at is stamped when a student hands in. `a.submitted` is the row's
 * updated_at, which a marker also moves, so on its own it answers "when was
 * this last touched" and shows a student a submission time that drifts to the
 * day they were graded. Kept behind it for rows handed in before the stamp
 * existed.
 */
function handedInAt(a: Assignment): string | null {
  if (!handedIn(a)) return null;
  const lead = SCOPE_OF[a.activity.type] === "team" ? a.teamResult : a.myResult;
  return lead?.submitted_at ?? a.submitted;
}

/** When it arrived, ready to print. */
function submittedAt(a: Assignment): string | null {
  const iso = handedInAt(a);
  if (!iso) return null;
  return fmtWhen(iso) ?? iso;
}

/**
 * Handed in, but after the deadline.
 *
 * Against the INDIVIDUAL deadline and nothing else. A team hands its answer in
 * once, on a date of its own, and judging that against the date each member's
 * own work was due would mark whole teams late for a deadline that was never
 * theirs — so a team-only activity is never late here, and on an activity with
 * both halves this reads the student's own row.
 *
 * Different from the "Late" STATUS, which statusOf gives to a row with nothing
 * in it once the activity is past its stage and which means
 * missing-and-overdue. This one means the work is in.
 */
function lateHandIn(a: Assignment): boolean {
  if (SCOPE_OF[a.activity.type] === "team") return false;
  const due = indivDueAt(a.activity);
  const when = handedInAt(a);
  if (!due || !when) return false;
  const cutoff = Date.parse(due);
  const arrived = Date.parse(when);
  if (Number.isNaN(cutoff) || Number.isNaN(arrived)) return false;
  return arrived > cutoff;
}

function statusStamp(a: Assignment): string {
  const when = submittedAt(a);
  if (when) return `Submitted ${when}`;
  if (a.status === "Graded") return "Marked in session";
  // Nothing came here, and nothing was meant to.
  const place = elsewhereName(a);
  if (place) return `Answered in ${place} — nothing to hand in here`;
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

// ------------------------------------------------------------------- atoms

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="sv-eyebrow">{children}</div>;
}

const CARD_BODY: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "var(--text-sm)",
  lineHeight: 1.6,
  color: "var(--navy)",
  maxWidth: "68ch",
  // A brief is written in a textarea, and the breaks someone put there are
  // meaning: "bring these three things" is a list, not a paragraph. Default
  // HTML collapses every newline to a space and turns the list back into
  // prose. pre-wrap keeps the breaks and still wraps at the measure above.
  whiteSpace: "pre-wrap",
};

// -------------------------------------------------------------------- list

function ActivityRow({ a, onSelect }: { a: Assignment; onSelect: (id: string) => void }) {
  const act = a.activity;
  const scope = SCOPE_OF[act.type];
  // A count, never the files themselves. Six names and six thumbnails on every
  // row of a term is a wall, and this row is a thing you scan past; the point
  // here is only that there IS something to open one tap away.
  const fileCount = act.files?.length ?? 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(act.id)}
      className="sv-row"
      // The row's layout is in student.css, because a phone has to restack it
      // and no media query can reach an inline style object. Type is the only
      // thing left here: it varies per row, so it travels as a custom property.
      style={{ "--row-accent": ACCENT[act.type] } as CSSProperties}
    >
      <span className="sv-rowtype">{TYPE_LABEL[act.type]}</span>

      <span className="sv-rowmain">
        <span className="sv-rowhead">
          <span className="sv-rowtitle">{act.title}</span>
          <span className="sv-badge outline sv-rowscope">{SCOPE_LABEL[scope]}</span>
          {fileCount > 0 ? (
            <span className="sv-badge outline sv-rowfiles">
              <SIcon name="attachFile" size={12} />
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </span>
          ) : null}
        </span>
        <span className="sv-rowdue">{dueLine(a)}</span>
      </span>

      <span className={`sv-badge ${STATUS_BADGE[a.status]} sv-rowstatus`}>{statusLabel(a)}</span>

      <span className="sv-num sv-rowgrade">{a.grade}</span>

      <span className="sv-rowchev">
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
    <section className="sv-screen">
      <div className="sv-head">
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
      </div>

      <div className="sv-scroll">
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
      </div>
    </section>
  );
}

/** How many of a team's photos preview on the activity page. The rest are one click away. */
const STRIP_MAX = 3;

/** "Aug 5, 2:14pm" — same shape the folder uses, so a tile reads the same in both places. */
function resourceStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${day}, ${h}:${String(d.getMinutes()).padStart(2, "0")}${h24 >= 12 ? "pm" : "am"}`;
}

// ------------------------------------------------------------- attachments

interface Signed {
  /** Path -> URL. A path the backend refused is absent; so is a ref that has none. */
  urls: Map<string, string>;
  /** Has the first attempt finished? Distinguishes "loading" from "could not open". */
  ready: boolean;
}

/**
 * Signed URLs for one activity's attachments, kept alive while the page is open.
 *
 * Keyed on the PATHS, not on the array: StudentApp re-fetches every assignment
 * every two minutes and on every focus, so `activity.files` arrives as a fresh
 * array carrying the identical six refs, and keying on identity would re-sign
 * all six on that timer forever.
 */
function useSignedFiles(refs: FileRef[]): Signed {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [ready, setReady] = useState(false);
  const signedAt = useRef(0);

  const key = refs
    .map((r) => r.path)
    .filter((p): p is string => Boolean(p))
    .join("\n");

  useEffect(() => {
    if (!key) {
      setUrls(new Map());
      setReady(true);
      return;
    }
    let alive = true;
    setReady(false);

    // `refs` is read from the closure rather than declared a dependency, and
    // that is the whole point of keying on `key`: the key IS the list of paths,
    // so a run that was not re-triggered is holding an array whose paths are
    // the same ones. Adding refs to the deps puts the two-minute re-fetch back.
    const sign = () => {
      signedAt.current = Date.now();
      activityFileUrls(refs)
        .then((m) => {
          if (alive) setUrls(m);
        })
        // Silent. Every row still renders its name and says it could not be
        // opened; a red box over the brief is not the place to say it again.
        .catch(() => undefined)
        .finally(() => {
          if (alive) setReady(true);
        });
    };
    sign();

    const tick = window.setInterval(sign, RESIGN_MS);
    // A background tab's timers are throttled to whole minutes, so the interval
    // is not a promise that anything ran. Coming back to the page is also the
    // moment a stale link is about to be clicked, so check the age there too.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - signedAt.current >= RESIGN_MS) sign();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);

  return { urls, ready };
}

/**
 * What the instructor attached to this activity.
 *
 * The bucket is private and 0012's policy only lets a student read it once the
 * activity has opened, which by the time this renders it has. Images show
 * themselves, because a diagram nobody clicks is a diagram nobody sees; a PDF
 * is a named row, because the browser cannot show it here anyway and a
 * thumbnail of page one is not what anyone came for.
 */
function Attachments({ refs, signed }: { refs: FileRef[]; signed: Signed }) {
  if (!refs.length) return null;
  return (
    <div className="sv-attach">
      <div className="sv-eyebrow">
        {refs.length === 1 ? "Attachment" : `Attachments · ${refs.length}`}
      </div>
      <ul className="sv-attachlist">
        {refs.map((ref, i) => (
          <Attachment key={ref.path ?? `${i}:${ref.name}`} attachment={ref} signed={signed} />
        ))}
      </ul>
    </div>
  );
}

// `attachment` rather than the obvious `ref`: React reserves that prop name and
// would eat it before this component ever saw it.
function Attachment({ attachment, signed }: { attachment: FileRef; signed: Signed }) {
  const kind = kindOf(attachment);
  const url = attachment.path ? signed.urls.get(attachment.path) : undefined;

  // Three ways there is nothing to click, and they are not the same sentence.
  // A ref written before 0012 recorded a NAME and no path: there are no bytes
  // anywhere and there never were, so it is listed and that is all anyone can
  // do with it. A ref WITH a path is either still being signed or was refused.
  const note = !attachment.path
    ? "No file was stored for this one."
    : !signed.ready
      ? "Loading…"
      : !url
        ? "This one would not open. Reload the page to try again."
        : null;

  return (
    <li className="sv-attachitem">
      <div className="sv-attachhead">
        <span className="sv-attachicon">
          <SIcon name={kind === "image" ? "image" : "attachFile"} size={16} />
        </span>
        <span className="sv-attachname">
          {url ? (
            <a className="sv-attachlink" href={url} target="_blank" rel="noreferrer">
              {attachment.name}
            </a>
          ) : (
            attachment.name
          )}
          {attachment.size ? <span className="sv-attachsize">{attachment.size}</span> : null}
        </span>
      </div>

      {note ? <div className="sv-attachnote">{note}</div> : null}

      {/* Only an image, and only once it has a URL — an <img> with no src is a
          broken-image glyph, and a 4000px photograph at its own size would take
          the brief off the side of the page. The alt is the filename, which is
          the only description of it anybody wrote.

          Deliberately not a link, though clicking a picture to enlarge it is
          the habit: the name above already opens the same file in a new tab,
          and wrapping the image too would put six more tab stops in a card
          whose links all lead where the first six already did. */}
      {kind === "image" && url ? (
        <img className="sv-attachimg" src={url} alt={attachment.name} loading="lazy" />
      ) : null}
    </li>
  );
}

// ------------------------------------------------------------------ detail

/**
 * The brief, plus what the activity is out of.
 *
 * No invented fallback. This used to print "Work the problem set on your own,
 * then bring your answers to the discussion." for an activity whose instructor
 * wrote nothing — badged Sample, but it still read like an assignment, and a
 * student following it is following something nobody set. The question count
 * beside it was a hard-coded "5 questions"; it is the real rubric now.
 */
function DescriptionCard({
  a,
  questions,
  files,
  signed,
}: {
  a: Assignment;
  questions: number;
  files: FileRef[];
  signed: Signed;
}) {
  const brief = a.activity.source_text?.trim();
  return (
    <div className="sv-card" style={{ marginTop: 14 }}>
      <div className="sv-eyebrow">Description</div>
      {brief ? (
        <p style={CARD_BODY}>
          {/* The same signed URLs the attachment list below is holding, so a
              phrase pointing at the case study and the row naming it expire
              together and are re-minted together. */}
          <BriefText text={brief} files={briefFiles(files, signed.urls)} />
        </p>
      ) : (
        <p style={{ ...CARD_BODY, color: "var(--muted-foreground)" }}>
          Your instructor hasn&rsquo;t written a brief for this one. Ask in the session if
          you&rsquo;re not sure what it asks for.
        </p>
      )}
      <Attachments refs={files} signed={signed} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {questions > 0 ? (
          <span className="sv-badge secondary">
            {questions} {questions === 1 ? "question" : "questions"}
          </span>
        ) : null}
        <span className="sv-badge warning wrap">{dueLine(a)}</span>
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

/**
 * The team's photos for THIS activity, on the activity page.
 *
 * Real rows (0017). This used to render three invented tiles — "Final board",
 * "Thursday session", "Trials 1-3" — behind a Sample badge, which was
 * defensible while nothing was real and became a lie the moment the folder
 * was: a student saw three artefacts here that were not in their folder.
 */
function ResourceStrip({
  activityId,
  teamId,
  onOpenResources,
}: {
  activityId: string;
  teamId: string | null;
  onOpenResources: () => void;
}) {
  const [items, setItems] = useState<TeamResource[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!teamId) {
      setItems([]);
      return;
    }
    let alive = true;
    setLoading(true);
    listTeamResources(activityId, teamId)
      .then(async (rows) => {
        if (!alive) return;
        setItems(rows);
        // Only what is shown gets a signed URL — the strip is a preview of the
        // folder, not the folder. And only the PICTURES: a folder can hold a
        // PDF now, and a signed URL for one would buy a grey box either way.
        const shown = rows.slice(-STRIP_MAX).filter((r) => previewable(r.mime, r.path));
        setUrls(await resourceUrls(shown.map((r) => r.path)));
      })
      // Silent: the folder is one click away and says what went wrong there.
      // A red box on the activity page over a preview strip is not the place.
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activityId, teamId]);

  // Newest first — the photo anyone wants is the one just taken.
  const shown = items.slice(-STRIP_MAX).reverse();
  const more = items.length - shown.length;

  return (
    <div className="sv-card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div className="sv-eyebrow" style={{ flex: 1 }}>
          Team files
        </div>
        <button
          type="button"
          className="sv-btn link"
          onClick={onOpenResources}
          style={{ color: "var(--navy-700)" }}
        >
          {items.length ? (more > 0 ? `Open all · ${items.length}` : "Open all") : "Add files"}
        </button>
      </div>

      {loading && !items.length ? (
        <div className="sv-sub" style={{ fontSize: "var(--text-xs)" }}>
          Loading…
        </div>
      ) : !items.length ? (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
            lineHeight: 1.55,
            maxWidth: "60ch",
          }}
        >
          {teamId
            ? "Nothing here yet. Whatever your team keeps for this activity — a whiteboard photo, the data you worked from — goes in Team files, in this assignment's folder."
            : "You are not on a team yet, and these belong to a team."}
        </p>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {shown.map((r) => {
            const url = urls.get(r.path);
            return (
              <button
                key={r.id}
                type="button"
                onClick={onOpenResources}
                title={`Open ${r.title} in Team files`}
                style={{
                  width: 150,
                  padding: 0,
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  border: "1px solid var(--neutral-200)",
                  background: "var(--cream-300)",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 62,
                    fontSize: "var(--text-2xs)",
                    letterSpacing: "var(--tracking-wide)",
                    color: "var(--muted-foreground)",
                    background: url
                      ? `var(--neutral-100) url("${url}") center/cover no-repeat`
                      : "var(--neutral-100)",
                  }}
                >
                  {/* A file that is not a picture says what it is, rather than
                      sitting there as an empty grey rectangle. */}
                  {url ? "" : (/\.([a-z0-9]{1,5})$/i.exec(r.path)?.[1] ?? "file").toUpperCase()}
                </span>
                <span style={{ display: "block", padding: "8px 10px" }}>
                  <span
                    className="sv-ellip"
                    style={{
                      display: "block",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-semibold)",
                      lineHeight: 1.3,
                    }}
                  >
                    {r.title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "var(--text-2xs)",
                      color: "var(--muted-foreground)",
                      marginTop: 2,
                    }}
                  >
                    {resourceStamp(r.created_at)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusCard({ a, scope }: { a: Assignment; scope: Scope }) {
  const when = submittedAt(a);
  const arrived = handedIn(a);
  const late = lateHandIn(a);
  /**
   * Nothing was handed in HERE, so nothing here may talk about one.
   *
   * Three lines did. "Submitted Tue Sep 8, 3:25pm" was the worst of them: no
   * submission exists, so the stamp fell back to the row's updated_at, and the
   * time it printed was the moment the INSTRUCTOR marked it — a hand-in the
   * student never made, at a time they were nowhere near it. "Open your work to
   * replace it" points at a screen this half does not have, and the team
   * discussion is the other tab's business.
   */
  const elsewhere = elsewhereName(a) !== null;
  return (
    <div className="sv-card" style={{ padding: "16px 18px" }}>
      <Eyebrow>Status</Eyebrow>
      <div style={{ marginTop: 8 }}>
        <span className={`sv-badge ${STATUS_BADGE[a.status]}`}>{statusLabel(a)}</span>
      </div>
      {/* The stamp and the late marker sit together because they are one fact:
          the badge above says the work is in, and this says when — and whether
          that was in time. Late here is not the "Late" status, which means
          nothing came at all. */}
      {elsewhere ? null : (
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}
        >
          <span
            className="sv-num"
            style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}
          >
            {statusStamp(a)}
          </span>
          {late ? <span className="sv-badge warning">Late</span> : null}
        </div>
      )}

      {/* Nothing about a grade until something has actually been handed in.
          "Pending — released after grading" over work that was never submitted
          reads as though it is with a marker and the student is waiting, when
          in fact nothing has been sent and the deadline is still theirs to
          meet. Same for a Resubmit button with nothing to resubmit. */}
      {arrived || elsewhere ? (
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
              {/* "Pending" is about waiting on a marker who has the work. On a
                  half answered elsewhere nothing is with anybody yet, so this
                  says what is true of the grade: there isn't one. */}
              {a.grade !== "—" ? a.grade : elsewhere ? "Not graded" : "Pending"}
            </span>
          </div>
          {elsewhere ? null : (
            <div
              style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: 4 }}
            >
              {GRADE_NOTE[scope]}
            </div>
          )}

          <MarkerNote result={a.myResult} />

          {when && !elsewhere ? (
            <div
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--muted-foreground)",
                marginTop: 12,
                textAlign: "center",
              }}
            >
              Handed in {when}
              {late ? ", after the deadline" : ""}. Open your work to replace it.
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

/**
 * What the instructor recorded for THIS team during the session.
 *
 * THEIR score, not the team's. The team's mark and this student's score are the
 * same number right up until they were away — 0031 lets a student read their own
 * absence rows, and getMyMarks folds that in, so a student who missed a check-in
 * sees the 0 they actually got rather than the 5 their team was sitting on.
 *
 * Who ELSE on the team was away stays invisible, exactly as 0016 left it: that
 * is a fact about them.
 */
function LiveGrading({
  marks,
  members,
  loading,
}: {
  marks: StudentMark[];
  members: Student[];
  loading: boolean;
}) {
  const nameOf = (id: string | null) =>
    (id && members.find((m) => m.id === id)?.name) || "Not recorded";

  // A row exists as soon as anything is touched, so "has a row" is not the
  // question — an all-null row means the instructor opened the sheet, nothing
  // more, and showing empty bars for it would read as a score of zero.
  const filled = marks
    .filter((m) => m.presenter_id !== null || m.accuracy !== null || m.discussion !== null)
    .sort((x, y) => x.slot - y.slot);

  return (
    <div style={{ borderLeft: "1px solid var(--neutral-200)", padding: "2px 0 2px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="sv-eyebrow" style={{ flex: 1 }}>
          Live grading
        </div>
        {filled.length ? (
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: 999,
              background: "var(--emerald-500)",
            }}
          />
        ) : null}
      </div>
      <div style={{ fontSize: "var(--text-2xs)", color: "var(--muted-foreground)", marginTop: 5 }}>
        Marked by your instructor during the session
      </div>

      {loading ? (
        <div className="sv-sub" style={{ marginTop: 14, fontSize: "var(--text-xs)" }}>
          Loading…
        </div>
      ) : !filled.length ? (
        <div
          style={{
            marginTop: 14,
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
            lineHeight: 1.55,
          }}
        >
          Nothing recorded for your team on this activity yet. It appears here during or
          after the tutorial.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
          {filled.map((m) => (
            <div key={m.slot} style={{ borderTop: "1px solid var(--neutral-200)", paddingTop: 11 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontSize: "var(--text-2xs)",
                    color: "var(--muted-foreground)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Check-in {m.slot}
                </span>
                <span
                  className="sv-ellip"
                  style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}
                >
                  {nameOf(m.presenter_id)}
                </span>
              </div>
              {/* Label above its bar, not beside it. These two were one-word
                  labels in a 78px column; the words the instructor wants are
                  "Preparation and understanding" and "Engagement and
                  reflection", and no fixed column holds either in a 270px side
                  card, let alone at 320px. Above the bar the label has the
                  whole width and wraps to a second line when it needs one,
                  which is the one thing a scale label must never do badly —
                  "Preparation and und…" says less than "Accuracy" did. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 9 }}>
                {(
                  [
                    { label: SCALE_LABEL.accuracy, value: m.accuracy },
                    { label: SCALE_LABEL.discussion, value: m.discussion },
                  ] as const
                ).map((s) => (
                  <div key={s.label}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: "var(--text-xs)",
                          lineHeight: 1.35,
                          color: "var(--muted-foreground)",
                        }}
                      >
                        {s.label}
                      </span>
                      <span
                        className="sv-num"
                        style={{ flex: "none", fontSize: "var(--text-xs)" }}
                      >
                        {s.value != null ? `${s.value}/5` : "—"}
                      </span>
                    </div>
                    <span
                      style={{
                        display: "block",
                        marginTop: 5,
                        height: 6,
                        borderRadius: 3,
                        background: "var(--neutral-200)",
                        overflow: "hidden",
                      }}
                    >
                      {s.value != null ? (
                        <span
                          style={{
                            display: "block",
                            width: `${(s.value / 5) * 100}%`,
                            height: "100%",
                            borderRadius: 3,
                            background: s.value === 5 ? "var(--emerald-600)" : "var(--navy-700)",
                          }}
                        />
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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
  onOpenSubmit,
  onOpenResources,
  showLiveGrading,
}: {
  enrolment: Enrolment;
  a: Assignment;
  tab: "indiv" | "team";
  onBack: () => void;
  onTabChange: (t: "indiv" | "team") => void;
  /** The team answer screen. The individual half hands in on its own screen. */
  onOpenWork: (id: string, mode: "team") => void;
  /** The PDF hand-in, on its own screen. */
  onOpenSubmit: (id: string) => void;
  onOpenResources: () => void;
  showLiveGrading: boolean;
}) {
  const act = a.activity;
  const scope = SCOPE_OF[act.type];
  /** Named when the individual half is answered on another platform. */
  const elsewhere = elsewhereName(a);
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

  // The activity's questions. Real rows (0014) — the count on the description
  // card, and what the hand-in maps pages to.
  const [questions, setQuestions] = useState<ActivityQuestion[]>([]);

  useEffect(() => {
    let alive = true;
    listMyQuestions(act.id)
      .then((qs) => {
        if (alive) setQuestions(qs);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [act.id]);

  // What the instructor recorded for this team in the session. Loaded on the
  // team half only, which is the only place it is shown.
  const [marks, setMarks] = useState<StudentMark[]>([]);
  const [marksLoading, setMarksLoading] = useState(false);

  /**
   * Poll while the team half is open.
   *
   * This is called LIVE grading and it was fetched exactly once, on mount — so a
   * student watching the card during their own tutorial saw "nothing recorded
   * yet" until they navigated away and back, while the instructor was marking
   * them in the same room. Twenty seconds is the useful cadence there; the
   * request is one row per team per slot, and it only runs while the card that
   * shows it is actually on screen.
   */
  useEffect(() => {
    if (!onTeam || !teamId) {
      setMarks([]);
      return;
    }
    let alive = true;

    const read = (showSpinner: boolean) => {
      if (showSpinner) setMarksLoading(true);
      return getMyMarks(act.id, teamId, enrolment.student.id)
        .then((rows: StudentMark[]) => {
          if (alive) setMarks(rows);
        })
        .catch(() => {
          // The rest of the activity is readable without it, and the card says
          // "nothing recorded yet" — which is what a student sees anyway when
          // the instructor has not marked them. A failed POLL must not blank
          // marks already on screen, so only the first read clears them.
          if (alive && showSpinner) setMarks([]);
        })
        .finally(() => {
          if (alive && showSpinner) setMarksLoading(false);
        });
    };

    void read(true);

    // A tab in the background is not being watched, so it does not need to ask.
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") void read(false);
    }, 20_000);
    // ...and coming back to it should not wait out the rest of an interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") void read(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      alive = false;
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [onTeam, teamId, act.id]);

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

  // Signed once for the whole detail, not once per tab. The Individual and Team
  // halves show the same attachments and only ever one of them is mounted, so
  // signing inside either would re-sign all six every time somebody switched.
  const files = act.files ?? [];
  const signedFiles = useSignedFiles(files);

  const teamSavedLine = !enrolment.team
    ? "You are not on a team yet"
    : a.teamResult?.status === "scored"
      ? `Graded · ${a.teamGrade}`
      : a.teamResult?.text
        ? `Submitted ${fmtWhen(a.teamResult.updated_at) ?? "recently"} by your team`
        : "Your team has not submitted yet";

  // The INDIVIDUAL half's own state. handedIn() reads the lead result, which is
  // the team's on a team-only activity — the wrong row to label this button by.
  const indivStatus = a.myResult?.status;
  const arrivedIndiv =
    indivStatus === "submitted" || indivStatus === "needs_review" || indivStatus === "scored";

  // Seeing an activity and being able to hand work in are separate things: an
  // activity is visible from the moment it opens, but its check-in is a
  // separate row the instructor may not have added yet.
  const savedLine = !a.indivCheckIn
    ? "Not open for submissions yet"
    : a.myResult?.status === "draft"
      ? `Draft saved ${fmtWhen(a.myResult.updated_at) ?? "recently"}`
      : submittedAt(a)
        ? `Submitted ${submittedAt(a)}${lateHandIn(a) ? " · Late" : ""}`
        : "Nothing saved yet";

  return (
    <section className="sv-screen">
      <div className="sv-head">
        <button type="button" className="sv-btn link" onClick={onBack} style={{ gap: 4 }}>
          <SIcon name="chevronLeft" size={15} />
          All assignments
        </button>
      </div>

      <div className="sv-scroll sv-detailgrid">
        <div className="sv-detailmain">
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
              <DescriptionCard
                a={a}
                questions={questions.length}
                files={files}
                signed={signedFiles}
              />
              {/* One door to the individual half: the hand-in. "Open my work"
                  sat beside it and led to a second screen for a written note,
                  which is two places to go for one piece of work and a question
                  ("which one am I meant to press?") with no good answer.

                  Unless the answers are not here at all. An Amplify half is
                  answered on Amplify and marked from Amplify, so a hand-in
                  button would be asking for the same work a second time — and
                  the students who obliged would be uploading a screenshot of
                  what the marker is already looking at. */}
              {elsewhere ? (
                <div className="sv-card" style={{ marginTop: 14 }}>
                  <div className="sv-eyebrow">Where this one is answered</div>
                  <p style={CARD_BODY}>
                    Complete this assignment in <strong>{elsewhere}.</strong> Put effort into
                    every slide, then click &ldquo;Hand in&rdquo; on the final slide.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
                  <button
                    type="button"
                    className="sv-btn primary"
                    onClick={() => onOpenSubmit(act.id)}
                    disabled={!a.indivCheckIn}
                    title={
                      a.indivCheckIn
                        ? "Upload your work as a PDF and mark which pages answer which question"
                        : "Your instructor has not opened this for submissions yet"
                    }
                  >
                    {arrivedIndiv ? "View submission" : "Submit assignment"}
                  </button>
                  <span className="sv-sub">{savedLine}</span>
                </div>
              )}
            </div>
          ) : null}

          {onTeam ? (
            <div>
              <div className="sv-card" style={{ marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="sv-eyebrow" style={{ flex: 1 }}>
                    Instructions
                  </div>
                </div>
                {brief ? (
                  <p style={CARD_BODY}>
                    <BriefText text={brief} files={briefFiles(files, signedFiles.urls)} />
                  </p>
                ) : (
                  <p style={{ ...CARD_BODY, color: "var(--muted-foreground)" }}>
                    Your instructor hasn&rsquo;t written instructions for this one.
                  </p>
                )}
                <Attachments refs={files} signed={signedFiles} />
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

              {/* The team's mark is written on the team's row, so its note is a
                  different one from the individual half's and belongs here
                  rather than beside a grade it was not about. */}
              <MarkerNote result={a.teamResult} />

              <ResourceStrip
                activityId={act.id}
                teamId={teamId}
                onOpenResources={onOpenResources}
              />
            </div>
          ) : null}
        </div>

        <div className="sv-detailside">
          {onIndiv ? <StatusCard a={a} scope={scope} /> : null}
          {onTeam && showLiveGrading ? (
            <LiveGrading marks={marks} members={enrolment.teammates} loading={marksLoading} />
          ) : null}
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
  /** The team answer screen. The individual half hands in on its own screen. */
  onOpenWork: (id: string, mode: "team") => void;
  /** The PDF hand-in, on its own screen. */
  onOpenSubmit: (id: string) => void;
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
    onOpenSubmit,
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
        onOpenSubmit={onOpenSubmit}
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
