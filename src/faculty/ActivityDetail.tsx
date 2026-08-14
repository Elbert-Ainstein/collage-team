"use client";

// Activity detail: the full-screen view reached by clicking a row on Activities.
//
// Left two-thirds is what the activity IS, right third is who has handed it in.
// Everything on the right is keyed off SCOPE, so a team activity lists teams and
// counts out of the number of teams — type only picks the label and the accent.

import type { ResultRow } from "@/checkins/data";
import { useEffect, useMemo, useRef, useState } from "react";
import { deleteActivity, tintFor, updateActivity } from "@/checkins/data";
import { deleteActivityRecordings } from "@/checkins/audio";
import { purgeActivityStorage } from "@/checkins/purge";
import { isCompletionMet, isOpenToStudents } from "@/checkins/studentData";
import {
  HIDDEN_INSTANT,
  isCompletion,
  SCOPE_LABEL,
  SCOPE_OF,
  TYPE_ACCENT,
  TYPE_LABEL,
  type Activity,
  type ActivityType,
} from "@/checkins/types";
import { countWorkForActivity, ensureCheckIn, setActivityPoints } from "./facultyData";
import { pointsLabel, nextPositionIn, pointsTotal, questionCount, questionsFor, statFor } from "./model";
import { ConfirmDialog } from "./ConfirmDialog";
import { FAvatar, FIcon } from "./icons";
import type { FacultyData } from "./FacultyApp";
import { ActivityTeamPanel } from "./ActivityTeamPanel";
import { NEW_ACTIVITY_STEPS, Steps } from "./Steps";

/**
 * 0007 added `activities.due_at`; the shared row type in checkins/types.ts has
 * not caught up. Read and write it through this shape rather than widening the
 * type here, so the column stays usable and there is one place to delete when
 * the row type does catch up.
 */
type WithDue = { due_at?: string | null };

/**
 * The one due date this screen shows and edits.
 *
 * 0007's `due_at` wins, but rows created before it have only the older
 * per-half columns, so fall back to the half this activity's SCOPE is marked
 * on — a team activity's deadline is its team due date, not its individual one.
 */
function dueOf(a: Activity): string | null {
  const own = (a as Activity & WithDue).due_at;
  if (own) return own;
  return SCOPE_OF[a.type] === "team"
    ? (a.team_due_at ?? a.individual_due_at)
    : (a.individual_due_at ?? a.team_due_at);
}

/** One person or team in the right-hand lists. */
interface Subject {
  id: string;
  name: string;
  tint: string | null;
  stamp: string | null;
  /** What they got, on the graded list. Null everywhere else. */
  grade?: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "11:47pm" — the compact form the design uses next to a name. */
function fmtTime(d: Date): string {
  const h = d.getHours();
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getMinutes())}${suffix}`;
}

/** "Sun 11:47pm" — narrow enough to sit in the list column. */
function fmtStamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${fmtTime(d)}`;
}

/**
 * "Mon, Mar 3, 9:00am" — a whole instant, weekday and date included.
 *
 * Both dated lines on this screen are read out of the context of a week: a due
 * date and the day the class gets to see the activity are equally useless as a
 * bare time.
 */
export function fmtInstant(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}, ${fmtTime(d)}`;
}

/**
 * timestamptz -> the value a <input type="datetime-local"> wants.
 *
 * The column is an absolute instant; the input has no zone at all. Going this
 * way we render the instant in the BROWSER's zone, so an 09:00 written from
 * this desk reads back as 09:00 at this desk.
 */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

/**
 * The datetime-local value -> timestamptz.
 *
 * The reverse of toLocalInput: `new Date("2026-03-10T09:00")` reads the string
 * as local wall-clock time, and toISOString turns it into the UTC instant the
 * column stores. An empty input is null, never epoch zero — for opens_at that
 * distinction is the whole feature, since null means visible.
 */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The one sentence saying what the class can see, read off the same rule the
 * student app applies.
 *
 * Visibility is a switch, not a schedule: it is either on a student's list or it
 * is not. The column still holds an instant — that is what RLS compares — but
 * nothing here asks anyone to pick one.
 */
function visibilityOf(a: Activity): { text: string; open: boolean } {
  return isOpenToStudents(a)
    ? { text: "Visible to students", open: true }
    : { text: "Not visible to students", open: false };
}

/**
 * The blurb shown when an activity carries no source text of its own.
 *
 * Per type rather than per scope: scope decides who is marked, but what a
 * faculty member needs here is how this kind of work is done and how it earns
 * its mark, and that is a property of the type.
 */
/**
 * The stand-in blurb for an activity with no brief.
 *
 * Says how the work is SHAPED, never how it is marked. It used to assert the
 * marking mode from the type — "marked for completion, not for points" on a
 * Challenge — which was true when the type decided that and became a
 * contradiction the moment 0019 made it a choice: an instructor could set a
 * Challenge to points and this paragraph would go on telling students the
 * opposite. Marking is stated once, by the badge that reads the column.
 */
function describe(a: Activity): string {
  const t = a.title.trim().toLowerCase();
  switch (a.type) {
    case "combo":
      return `Tutorial and challenge questions on ${t}. Students work alone and hand in before the deadline.`;
    case "skills":
      return `Timed skills check on ${t}. One attempt each, worked individually.`;
    case "challenge":
      return `Problem set on ${t}. Students work it alone first, then bring their answers to the team discussion.`;
    case "amplify":
      return `Team activity on ${t}. Worked away from Collage and marked once per team at the check-in, so there is one mark per team rather than one per student.`;
  }
}

/** Mirrors model.statFor's notion of "handed in", so the lists and the counts agree. */
const isIn = (r: Pick<ResultRow, "status">) =>
  r.status === "submitted" || r.status === "needs_review" || r.status === "scored";

export function ActivityDetail(props: {
  data: FacultyData;
  activity: Activity;
  /** Just created — open the editor and put the caret in the title. */
  fresh?: boolean;
  onBack: () => void;
  /** The rubric: the assignment document, its questions and their criteria. */
  onRubric: () => void;
  onGrade: () => void;
  /** The Check-in tab, where the team half is actually filled in. */
  onCheckIn: () => void;
  /** Copy this activity into another week, questions and rubric included. */
  onDuplicate: () => void;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}): JSX.Element {
  const {
    data,
    activity,
    fresh = false,
    onBack,
    onRubric,
    onGrade,
    onCheckIn,
    onDuplicate,
    onChanged,
    onError,
  } = props;

  const accent = TYPE_ACCENT[activity.type];
  const scope = SCOPE_OF[activity.type];

  // Every week an activity can be filed under: the course's own weeks, plus any
  // week an activity already names (a week with no course_weeks row still holds
  // work, and dropping it from the list would make that work unreachable to
  // move back to).
  const weeksAvailable = useMemo(() => {
    const set = new Set<number>();
    for (const w of data.weeks) set.add(w.week);
    for (const a of data.activities) if (a.week != null) set.add(a.week);
    return [...set].sort((x, y) => y - x);
  }, [data.weeks, data.activities]);
  // Questions are rows now, written on the rubric page. An activity with none
  // yet still reports the count it was created with, which is what scores it.
  const questions = questionsFor(activity.id, data.questions);
  const qCount = questionCount(activity, questions);

  // The row view and the column view print this number; so does the hint under
  // "Grade now". One object, never recomputed here.
  const stat =
    data.stats.get(activity.id) ??
    statFor(activity, data.checkIns, data.results, data.roster, data.teams);

  const weekLine = useMemo(() => {
    if (activity.week == null) return "Unscheduled";
    const w = data.weeks.find((x) => x.week === activity.week);
    const dates = w?.dates_label ?? activity.dates_label;
    return dates ? `Week ${activity.week} · ${dates}` : `Week ${activity.week}`;
  }, [data.weeks, activity.week, activity.dates_label]);

  const dueAt = dueOf(activity);
  const dueLine = dueAt ? fmtInstant(dueAt) : null;

  // Scheduling is the check-in permission, not authoring: a TF trusted to run
  // check-ins is trusted to decide when the class sees the work.
  const canSchedule = data.can.runCheckIns;
  // The switch answers the moment it is pressed, not when the reload behind it
  // finishes.
  //
  // The write itself is one fast round trip, but what the switch DISPLAYS came
  // from `data`, and `data` only moves when onChanged's whole-course refresh
  // lands — seven round trips including every result row on the course. So the
  // press did nothing visible for about a second, which reads as a dead
  // control, and the second press people give it writes the value back.
  //
  // Undefined means "no press outstanding": null is a real opens_at meaning
  // visible, so it cannot double as the empty case.
  const [pendingOpensAt, setPendingOpensAt] = useState<string | null | undefined>(undefined);
  // Cleared when the refresh catches up. Keyed on the value rather than on a
  // timer, so the optimistic state survives exactly as long as it is still
  // ahead of the server and no longer.
  useEffect(() => {
    setPendingOpensAt(undefined);
  }, [activity.opens_at]);

  const visibility = visibilityOf(
    pendingOpensAt === undefined ? activity : { ...activity, opens_at: pendingOpensAt },
  );

  // Whitespace-only source text is not a description; the editor writes null for
  // it, but rows written elsewhere can still carry "".
  const blurb = activity.source_text?.trim() || describe(activity);

  const { graded, submitted, missing } = useMemo(() => {
    // A `both` activity owns two check-ins; its individual half is the one the
    // stat counts, so the lists have to read the same half.
    const kind = scope === "team" ? "team" : "individual";
    const ids = new Set(
      data.checkIns.filter((c) => c.activity_id === activity.id && c.kind === kind).map((c) => c.id),
    );
    const outOf =
      data.checkIns.find((c) => c.activity_id === activity.id && c.kind === kind)?.max_points ??
      pointsTotal(activity);

    const found = new Map<string, ResultRow>();
    for (const r of data.results) {
      if (!ids.has(r.check_in_id) || !isIn(r)) continue;
      const subjectId = kind === "team" ? r.team_id : r.student_id;
      if (subjectId) found.set(subjectId, r);
    }

    const people: Subject[] =
      kind === "team"
        ? data.teams.map((t) => ({ id: t.id, name: t.name, tint: tintFor(t.name), stamp: null }))
        : data.roster.map((s) => ({ id: s.id, name: s.name, tint: s.avatar_tint, stamp: null }));

    const doneList: Subject[] = [];
    const inList: Subject[] = [];
    const outList: Subject[] = [];
    for (const p of people) {
      const r = found.get(p.id);
      if (!r) {
        outList.push(p);
        continue;
      }
      const stamp = fmtStamp(r.submitted_at);
      // Graded means RELEASED — status 'scored' is the same state the student's
      // own screen reads to show them a number. So somebody on this list can see
      // their grade, which is the only reading of "graded" that is useful to the
      // person deciding whether they still owe the class something.
      if (r.status === "scored") {
        doneList.push({
          ...p,
          stamp,
          grade: r.is_ci
            ? isCompletionMet(r)
              ? "Complete"
              : "Not complete"
            : outOf
              ? `${r.score ?? 0} / ${outOf}`
              : String(r.score ?? 0),
        });
      } else {
        inList.push({ ...p, stamp });
      }
    }
    // Three lists, no overlap: a graded student is not also counted as waiting.
    // The bar above still reads handed-in-at-all, which is a different question
    // and the right one for it.
    return { graded: doneList, submitted: inList, missing: outList };
  }, [data.checkIns, data.results, data.roster, data.teams, activity, scope]);

  const [gradedOpen, setGradedOpen] = useState(true);
  const [subOpen, setSubOpen] = useState(true);
  const [notOpen, setNotOpen] = useState(false);

  // Which half of the activity is on screen. Scope decides which halves exist:
  // an individual-only activity has no team side to look at, and a team-only
  // one has no individual side. `both` is the only case with a choice to make,
  // and it is the only case that shows a tab strip.
  const [half, setHalf] = useState<"indiv" | "team">(scope === "team" ? "team" : "indiv");
  const onTeamHalf = scope === "team" || (scope === "both" && half === "team");

  // ------------------------------------------------------------- the editor

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(activity.title);
  const [desc, setDesc] = useState(activity.source_text ?? "");
  const [due, setDue] = useState(() => toLocalInput(dueAt));
  const [points, setPoints] = useState(String(pointsTotal(activity)));
  const [kind, setKind] = useState<ActivityType>(activity.type);
  // Which week it is filed under. Asked here rather than beside the button that
  // creates it: at that point the activity does not exist yet and the choice
  // has nothing to attach to, and it is the one field you cannot revise
  // afterwards without it.
  const [week, setWeek] = useState<number | null>(activity.week);
  const [visBusy, setVisBusy] = useState(false);
  // Deleting an activity cascades its check-ins, every submission against them,
  // and every mark. Counted while the question is on screen, not after it.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteCost, setDeleteCost] = useState<string | null>(null);

  // The title is the heading, so the caret goes there rather than into the
  // first field of a form — there is no form.
  const titleRef = useRef<HTMLInputElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);

  const openEditor = (opts?: { blankTitle?: boolean }) => {
    setKind(activity.type);
    // Seed from the activity every time rather than once, so a refresh that
    // happened while the editor was closed is not overwritten by stale fields.
    //
    // Except on a brand-new one: "Untitled activity" is a stand-in the create
    // step wrote, not something anyone typed, so arriving with it in the box
    // means the first thing you do is delete it. Start empty and let the
    // placeholder say what belongs there.
    // Only ever the stand-in: once a real title is saved, re-opening the editor
    // must show it. Clearing whatever is there is what made a return trip look
    // like the activity had been wiped.
    setTitle(opts?.blankTitle && activity.title === "Untitled activity" ? "" : activity.title);
    setDesc(activity.source_text ?? "");
    setDue(toLocalInput(dueOf(activity)));
    setWeek(activity.week);
    setPoints(String(pointsTotal(activity)));
    setEditing(true);
  };

  // A freshly created activity is a placeholder title and nothing else. Opening
  // the editor here — rather than making the instructor find "Edit activity" on
  // a page that says "Untitled activity" — is the whole point of creating it
  // from one click and landing them here.
  useEffect(() => {
    if (!fresh) return;
    openEditor({ blankTitle: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, activity.id]);

  // Focus follows the editor opening, however it was opened. autoFocus fires
  // once per mount and this screen re-renders rather than remounting, so
  // pressing "Edit activity" a second time would otherwise leave the caret
  // wherever it was.
  useEffect(() => {
    if (!editing) return;
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [editing]);

  // A description with no box needs its height to follow its content, or the
  // seam shows: a fixed three rows either clips what is written or leaves a
  // hole under a one-line blurb.
  useEffect(() => {
    const el = descRef.current;
    if (!editing || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, desc]);

  /** The visibility switch writes this one column and nothing else. */
  const setOpensAt = async (next: string | null) => {
    setVisBusy(true);
    // Before the await, so the switch has already moved by the time the browser
    // has finished sending the request.
    setPendingOpensAt(next);
    try {
      await updateActivity(activity.id, { opens_at: next });
      onChanged();
    } catch (e) {
      setPendingOpensAt(undefined);
      onError(e);
    } finally {
      setVisBusy(false);
    }
  };

  /** Returns whether it landed — the rubric hand-off must not leave on a failure. */
  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const patch: Partial<Activity> & WithDue = {
        // An empty title keeps the placeholder rather than writing "": a row
        // with no name is worse than one that says it has none.
        title: title.trim() || "Untitled activity",
        source_text: desc.trim() ? desc.trim() : null,
        due_at: fromLocalInput(due),
      };
      if (kind !== activity.type) {
        patch.type = kind;
      }
      if (week !== activity.week) {
        patch.week = week;
        // position orders activities WITHIN a week, so a row arriving from
        // another week has to be given a place in this one. The end is the
        // honest default — it is the newest thing here.
        patch.position = weeksAvailable.length ? nextPositionIn(data.activities, week) : 0;
      }
      // opens_at is deliberately NOT in this patch. Visibility is its own
      // switch, written the moment it is flipped; including it here is how a
      // save of an unrelated field used to put a hidden draft back in front of
      // the class.
      await updateActivity(activity.id, patch);

      // Points go through facultyData rather than the same patch: the write
      // also has to reach check_ins.max_points, which the student view renders.
      const nextPoints = Math.max(0, Math.round(Number(points) || 0));
      if (nextPoints !== pointsTotal(activity)) {
        await setActivityPoints(activity.id, nextPoints);
      }

      // Type picks scope, and scope decides which check-ins have to exist. A
      // widened scope needs its new half created; a narrowed one keeps the old
      // check-in rather than dropping it, because deleting it would cascade
      // away every submission and mark already recorded against it.
      if (kind !== activity.type) {
        const scope = SCOPE_OF[kind];
        const withKind = { ...activity, ...patch, type: kind } as Activity;
        if (scope !== "team") await ensureCheckIn(withKind, "individual", data.checkIns);
        if (scope !== "indiv") await ensureCheckIn(withKind, "team", data.checkIns);
      }
      setEditing(false);
      // Awaited, not fired and forgotten: whoever called this may navigate away
      // next, and the screen they land on reads the same `data`. Leaving before
      // the refetch is how a saved activity came back looking empty.
      await onChanged();
      return true;
    } catch (e) {
      onError(e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const pct = stat.total > 0 ? (stat.submitted / stat.total) * 100 : 0;
  const gradeHint =
    stat.graded > 0
      ? `${stat.graded} of ${stat.submitted} already ${stat.verb}`
      : `${stat.submitted} waiting`;
  const noun = scope === "team" ? "teams" : "students";

  return (
    <div className="fv-panel">
      <div className="fv-topbar">
        <button type="button" className="fv-back" aria-label="Back to activities" onClick={onBack}>
          <FIcon name="chevronLeft" size={18} />
        </button>
        <span className="fv-sub">{weekLine}</span>
      </div>

      {/* Creating an activity is a sequence: its details, then its questions
          and how they are marked. Only while creating — editing one later is
          not a sequence, and a wizard bar over a page somebody came back to
          would suggest there is more to do. */}
      {fresh ? <Steps steps={NEW_ACTIVITY_STEPS} current={0} /> : null}

      {/* Only `both` gets a strip. One tab is not a choice, and rendering it
          anyway would suggest there is another half somewhere. */}
      {scope === "both" ? (
        <div className="fv-seg" style={{ alignSelf: "flex-start", marginBottom: 12 }}>
          <button
            type="button"
            className={half === "indiv" ? "on" : ""}
            onClick={() => setHalf("indiv")}
          >
            Individual
          </button>
          <button
            type="button"
            className={half === "team" ? "on" : ""}
            onClick={() => setHalf("team")}
          >
            Team
          </button>
        </div>
      ) : null}

      <div className={`fv-split${onTeamHalf ? " fv-teamhalf" : ""}`}>
        <div className="fv-left23" style={{ paddingRight: 4 }}>
          {/* Hidden while editing: the Type dropdown three fields down says
              "Combo · Individual" and is the control that CHANGES it, so the
              eyebrow above the title is the same words twice — once where they
              cannot be acted on. On a saved activity there is no dropdown and
              this is the only place the type is stated, so it stays. */}
          {editing ? null : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="fv-type" style={{ width: "auto", color: accent }}>
                {TYPE_LABEL[activity.type]}
              </span>
              <span className="fv-badge">{SCOPE_LABEL[scope]}</span>
            </div>
          )}

          {/* The title IS the field. Editing does not swap the page for a form
              and does not put a box around the heading — you type where the
              words already are, and everything that is not being written stays
              exactly where it was. */}
          {editing ? (
            <>
              <input
                id="fv-ed-title"
                ref={titleRef}
                className="fv-display fv-titlein"
                style={{ fontSize: 32, lineHeight: 1.14, marginTop: 8 }}
                value={title}
                aria-label="Activity title"
                placeholder="What are they working on?"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
              <div className="fv-sub" style={{ marginTop: 8 }}>
                {fresh ? "New activity" : "Editing"} · {weekLine}
              </div>
            </>
          ) : (
            <>
              {data.can.author ? (
                <button
                  type="button"
                  className="fv-display fv-titlebtn"
                  style={{ fontSize: 32, lineHeight: 1.14, marginTop: 8 }}
                  title="Click to edit"
                  onClick={() => openEditor()}
                >
                  {activity.title}
                </button>
              ) : (
                <h1 className="fv-display" style={{ fontSize: 32, lineHeight: 1.14, marginTop: 8 }}>
                  {activity.title}
                </h1>
              )}

              <div className="fv-sub" style={{ marginTop: 8 }}>
                {dueLine ? `Due ${dueLine}` : "No due date set"}
              </div>
            </>
          )}

          {/* One switch, two states. It reads and writes the same opens_at the
              student app reads, so what it says is what the class can see —
              there is no separate "posted" flag behind it, and no date to pick:
              work is either on their list now or it is not. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 8,
            }}
          >
            {canSchedule ? (
              <button
                type="button"
                className={`fv-switch${visibility.open ? " on" : ""}`}
                role="switch"
                aria-checked={visibility.open}
                aria-label="Visible to students"
                disabled={visBusy}
                onClick={() =>
                  // NULL for visible, never now(): RLS compares opens_at against
                  // the DATABASE clock, so a laptop a minute fast would store an
                  // instant it reads back as visible while every student's
                  // policy still hid it. Hidden is an instant that never
                  // arrives, which is the same column saying "not yet".
                  void setOpensAt(visibility.open ? HIDDEN_INSTANT : null)
                }
              />
            ) : (
              <span
                className="fv-dot"
                style={{
                  flex: "none",
                  background: visibility.open ? "var(--fv-emerald)" : "var(--fv-amber)",
                }}
                aria-hidden="true"
              />
            )}
            <span
              className="fv-sub"
              style={{ color: visibility.open ? "var(--fv-muted)" : "var(--fv-amber)" }}
            >
              {/* No "Saving…" — the switch has already moved, and the write it
                  is waiting on is one fast round trip. A word that appears for
                  fifty milliseconds and leaves is noise, not feedback. A
                  failure puts the switch back and says so through onError. */}
              {visibility.text}
            </span>
          </div>

          {/* The description is the same paragraph in both states — same size,
              same measure, same place on the page. Editing just puts a caret
              in it. */}
          {editing ? (
            <textarea
              id="fv-ed-desc"
              ref={descRef}
              className="fv-descin"
              style={{ marginTop: 20, maxWidth: "64ch" }}
              rows={2}
              aria-label="Description"
              // Not the generated blurb as a ghost: it is built from the title,
              // so on a new activity it would read "…on untitled activity".
              placeholder="Describe what they do — or leave it empty for the standard description for this type."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          ) : (
            <p style={{ margin: "20px 0 0", fontSize: 16, lineHeight: 1.65, maxWidth: "64ch" }}>
              {blurb}
            </p>
          )}

          {editing ? null : (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
                <span className="fv-badge secondary">
                  {qCount} {qCount === 1 ? "question" : "questions"}
                </span>
                <span className="fv-badge secondary">{pointsLabel(activity)}</span>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
                {data.can.author ? (
                  <button
                    type="button"
                    className="fv-btn outline sm"
                    aria-expanded={editing}
                    onClick={() => openEditor()}
                  >
                    <FIcon name="edit" size={15} />
                    Edit activity
                  </button>
                ) : null}
                {/* One door to the rubric. There used to be a second — a
                    "Grading criteria" page editing the same rubric_items rows
                    from a screen that could not see the questions they belong
                    to — and two ways into one thing is how they drift. */}
                {/* Here as well as on the list row, because THIS is where you
                    are standing when you think "I want this again next week" —
                    the row's copy icon is a 26px square beside a chevron, which
                    is findable only if you already know it is there. Duplicating
                    is the difference between rebuilding a rubric twelve times a
                    term and once. */}
                {data.can.author ? (
                  <button
                    type="button"
                    className="fv-btn outline sm"
                    disabled={saving}
                    onClick={onDuplicate}
                    title="Make a copy in another week — its questions and rubric come with it, hidden until you open it"
                  >
                    <FIcon name="copy" size={15} />
                    Duplicate
                  </button>
                ) : null}
                <button type="button" className="fv-btn outline sm" onClick={onRubric}>
                  <FIcon name="assignment" size={15} />
                  Rubric
                </button>
              </div>
            </>
          )}

          {/* What is left has no prose to live in — a type, a date, two
              numbers. They sit under a hairline as quiet fields rather than in
              a card: the page is still the activity, not a form about it. */}
          {editing ? (
            <div style={{ maxWidth: "64ch" }}>
              <div className="fv-fields">
                <div className="fv-field" style={{ width: 150 }}>
                  <label className="fv-eyebrow" htmlFor="fv-ed-week">
                    Week
                  </label>
                  <select
                    id="fv-ed-week"
                    className="fv-in quiet"
                    value={week ?? ""}
                    onChange={(e) => setWeek(e.target.value === "" ? null : Number(e.target.value))}
                  >
                    <option value="">Unscheduled</option>
                    {weeksAvailable.map((w) => (
                      <option key={w} value={w}>
                        Week {w}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="fv-field" style={{ minWidth: 210 }}>
                  {/* Type is what picks scope, and scope decides which check-ins
                      exist — so getting it wrong at creation used to be
                      permanent. Changing it here adds whichever half is now
                      needed and leaves the other in place, since dropping a
                      check-in would cascade away everything submitted. */}
                  <label className="fv-eyebrow" htmlFor="fv-ed-type">
                    Type
                  </label>
                  <select
                    id="fv-ed-type"
                    className="fv-in quiet"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as ActivityType)}
                  >
                    {(Object.keys(TYPE_LABEL) as ActivityType[]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]} · {SCOPE_LABEL[SCOPE_OF[t]]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="fv-field" style={{ minWidth: 210 }}>
                  <label className="fv-eyebrow" htmlFor="fv-ed-due">
                    Due
                  </label>
                  <input
                    id="fv-ed-due"
                    type="datetime-local"
                    className="fv-in quiet"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                  />
                </div>

                {/* One number: what the activity is out of. It is not derived
                    from anything — not a count of questions, not a value per
                    question — because those are separate facts and tying them
                    together could not describe a real assignment. */}
                <div className="fv-field" style={{ width: 110 }}>
                  <label className="fv-eyebrow" htmlFor="fv-ed-points">
                    Out of
                  </label>
                  <input
                    id="fv-ed-points"
                    className="fv-in quiet fv-num"
                    inputMode="numeric"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                  />
                </div>
                <span className="fv-sub" style={{ paddingBottom: 8 }}>
                  pts
                  {isCompletion(activity) ? " (marked for completion)" : ""}
                </span>
              </div>

              {kind !== activity.type ? (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: "var(--fv-2xs)",
                    color: "var(--fv-amber)",
                    lineHeight: 1.5,
                  }}
                >
                  Changing to {TYPE_LABEL[kind]} makes this{" "}
                  {SCOPE_LABEL[SCOPE_OF[kind]].toLowerCase()}. Work already submitted stays where
                  it is.
                </div>
              ) : null}

              <div className="fv-editbar">
                <button
                  type="button"
                  className="fv-btn primary sm"
                  disabled={saving}
                  onClick={() =>
                    void save().then((ok) => {
                      // Only on success, and only in the sequence: a failed
                      // save that still walked you to step 2 was how an
                      // activity came back looking empty.
                      if (ok && fresh) onRubric();
                    })
                  }
                >
                  {saving ? "Saving…" : fresh ? "Save and continue" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="fv-btn ghost sm"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                  title={
                    fresh
                      ? "Leaves it as an untitled draft, hidden from students. Delete it below if you don't want it."
                      : undefined
                  }
                >
                  {fresh ? "Not now" : "Cancel"}
                </button>
                {/* Saves first: the rubric is written against this activity,
                    and walking away from an unsaved shape would build it
                    against something nobody committed. In the sequence this is
                    what "Save and continue" already does, so it is only offered
                    on its own once the activity exists. */}
                {fresh ? null : (
                  <button
                    type="button"
                    className="fv-btn outline sm"
                    disabled={saving}
                    title="Save this, then write the questions and how they are marked"
                    onClick={() =>
                      void save().then((ok) => {
                        if (ok) onRubric();
                      })
                    }
                  >
                    <FIcon name="assignment" size={15} />
                    Rubric
                  </button>
                )}

                <span style={{ flex: 1 }} />

                <button
                  type="button"
                  className="fv-btn ghost sm"
                  style={{ color: "var(--fv-destructive)" }}
                  disabled={saving}
                  onClick={() => {
                    setConfirmDelete(true);
                    setDeleteCost(null);
                    void countWorkForActivity(activity.id)
                      .then(({ submissions, graded }) =>
                        setDeleteCost(
                          submissions === 0
                            ? "Nothing has been handed in for this yet."
                            : `${submissions} submission${submissions === 1 ? "" : "s"}` +
                              (graded ? `, ${graded} of them graded,` : "") +
                              " will be deleted with it.",
                        ),
                      )
                      .catch(() => setDeleteCost("Could not check what would be deleted."));
                  }}
                >
                  Delete activity
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Who has handed it in is not part of writing it. While the editor is
            open — and it opens by itself on a brand-new activity — the right
            column would report "0 of 1 submitted" and offer to grade something
            that does not exist yet. It comes back the moment the activity is
            saved and you are looking at it rather than writing it. */}
        {onTeamHalf ? (
          <ActivityTeamPanel
            activityId={activity.id}
            teams={data.teams}
            onOpenCheckIn={onCheckIn}
          />
        ) : editing ? null : (
        <div className="fv-right13">
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                className="fv-display fv-num"
                style={{ fontSize: 32, lineHeight: 1 }}
              >
                {stat.submitted}
              </span>
              <span className="fv-sub" style={{ fontSize: "var(--fv-sm)" }}>
                of {stat.total} submitted
              </span>
            </div>

            <div
              className="fv-track"
              style={{ marginTop: 12 }}
              role="img"
              aria-label={`${stat.submitted} of ${stat.total} ${noun} submitted`}
            >
              <i style={{ width: `${pct}%`, background: "var(--fv-emerald)" }} />
            </div>

            {/* Graded sits first because it is the pile that is DONE. Its count
                is the list's own length, not stat.graded — the bar above counts
                everyone who handed in at all, which is a different question and
                the right one for a bar. */}
            <button
              type="button"
              className="fv-group"
              style={{ marginTop: 18 }}
              aria-expanded={gradedOpen}
              onClick={() => setGradedOpen((v) => !v)}
            >
              <span className="fv-dot" style={{ background: "var(--fv-navy)" }} />
              <span style={{ flex: 1, textAlign: "left", fontWeight: 600 }}>Graded</span>
              <span className="fv-sub fv-num">{graded.length}</span>
              <span
                className={`fv-chev${gradedOpen ? " open" : ""}`}
                style={{ color: "var(--fv-muted)" }}
              >
                <FIcon name="chevronRight" size={16} />
              </span>
            </button>
            {gradedOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 2 }}>
                {graded.length === 0 ? (
                  <div className="fv-sub" style={{ padding: "4px 8px" }}>
                    Nothing released yet. Marking is not the same as releasing — a grade reaches
                    the student when you release it.
                  </div>
                ) : (
                  graded.map((s) => (
                    <div key={s.id} className="fv-person">
                      <FAvatar name={s.name} tint={s.tint} size={22} />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.name}
                      </span>
                      {/* The grade itself, because "who is done" and "what did they
                          get" are the two things anyone opens this list to learn. */}
                      <span
                        className="fv-num"
                        style={{
                          fontSize: "var(--fv-2xs)",
                          color: "var(--fv-navy)",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.grade}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <button
              type="button"
              className="fv-group"
              style={{ marginTop: 12, borderTop: "1px solid var(--fv-neutral-200)" }}
              aria-expanded={subOpen}
              onClick={() => setSubOpen((v) => !v)}
            >
              <span className="fv-dot" style={{ background: "var(--fv-emerald)" }} />
              <span style={{ flex: 1, textAlign: "left", fontWeight: 600 }}>
                Handed in, not graded
              </span>
              <span className="fv-sub fv-num">{submitted.length}</span>
              <span className={`fv-chev${subOpen ? " open" : ""}`} style={{ color: "var(--fv-muted)" }}>
                <FIcon name="chevronRight" size={16} />
              </span>
            </button>
            {subOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 2 }}>
                {submitted.length === 0 ? (
                  <div className="fv-sub" style={{ padding: "4px 8px" }}>
                    Nothing waiting to be graded.
                  </div>
                ) : (
                  submitted.map((s) => (
                    <div key={s.id} className="fv-person">
                      <FAvatar name={s.name} tint={s.tint} size={22} />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.name}
                      </span>
                      {s.stamp ? (
                        <span
                          className="fv-num"
                          style={{
                            fontSize: "var(--fv-2xs)",
                            color: "var(--fv-muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s.stamp}
                        </span>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <button
              type="button"
              className="fv-group"
              style={{ marginTop: 12, borderTop: "1px solid var(--fv-neutral-200)" }}
              aria-expanded={notOpen}
              onClick={() => setNotOpen((v) => !v)}
            >
              <span className="fv-dot" style={{ background: "var(--fv-neutral-300)" }} />
              <span style={{ flex: 1, textAlign: "left", fontWeight: 600 }}>Not submitted</span>
              <span className="fv-sub fv-num">{Math.max(stat.total - stat.submitted, 0)}</span>
              <span className={`fv-chev${notOpen ? " open" : ""}`} style={{ color: "var(--fv-muted)" }}>
                <FIcon name="chevronRight" size={16} />
              </span>
            </button>
            {notOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 2 }}>
                {missing.length === 0 ? (
                  <div className="fv-sub" style={{ padding: "4px 8px" }}>
                    Everyone is in.
                  </div>
                ) : (
                  missing.map((s) => (
                    <div key={s.id} className="fv-person" style={{ color: "var(--fv-muted)" }}>
                      <FAvatar name={s.name} tint={s.tint} size={22} />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.name}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div
            style={{
              paddingTop: 16,
              borderTop: "1px solid var(--fv-neutral-200)",
              marginTop: 14,
            }}
          >
            <button
              type="button"
              className="fv-btn primary full"
              style={{ height: 40 }}
              onClick={onGrade}
              disabled={!data.can.grade}
              title={
                data.can.grade
                  ? undefined
                  : "Grading is turned off for teaching fellows on this course."
              }
            >
              {data.can.grade ? "Grade now" : "Grading not permitted"}
            </button>
            <div
              className="fv-num"
              style={{
                marginTop: 8,
                textAlign: "center",
                fontSize: "var(--fv-2xs)",
                color: "var(--fv-muted)",
              }}
            >
              {gradeHint}
            </div>
          </div>
        </div>
        )}
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Are you sure you'd like to delete this activity?"
          body={
            <>
              <div style={{ color: "var(--fv-navy)", fontWeight: 600 }}>{activity.title}</div>
              <div style={{ marginTop: 6 }}>
                {deleteCost ?? "Checking what would be deleted with it…"} Its check-ins and
                everything recorded against them go too. This cannot be undone.
              </div>
            </>
          }
          confirmLabel="Delete activity"
          busy={saving}
          onCancel={() => {
            setConfirmDelete(false);
            setDeleteCost(null);
          }}
          onConfirm={() =>
            void (async () => {
              setSaving(true);
              try {
                // Every bucket first. A foreign key cascades the ROWS and
                // leaves the objects, so they have to go while the rows that
                // name them still exist. The assignment document is the one
                // that cannot wait at all: its storage policy joins back to
                // the activity row, so once that row is gone nobody can ever
                // delete the object again. Loud on failure — better to stop
                // than to half-delete.
                await deleteActivityRecordings(activity.id);
                // Paths read from the DB, not from this screen's copy: the row
                // may have been re-uploaded elsewhere since it was fetched, and
                // sweeping a stale path strands the real object in a bucket
                // whose delete policy dies with the activity row.
                await purgeActivityStorage(activity.id);
                await deleteActivity(activity.id);
                onChanged();
                onBack();
              } catch (e) {
                onError(e);
                setConfirmDelete(false);
                setDeleteCost(null);
              } finally {
                setSaving(false);
              }
            })()
          }
        />
      ) : null}
    </div>
  );
}
