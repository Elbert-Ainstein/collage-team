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
import { BriefText, safeHref } from "@/checkins/BriefText";
import { briefFiles, fileToken, filePath } from "@/checkins/briefLinks";
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
  type FileRef,
} from "@/checkins/types";
import {
  addActivityFile,
  countWorkForActivity,
  ensureCheckIn,
  removeActivityFileAt,
  seedRubricTemplate,
  setActivityPoints,
} from "./facultyData";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, kindOf, refuseFile } from "./activityFiles";
import { type SignedFiles, useSignedActivityFiles } from "./useSignedActivityFiles";
import { briefAnchor, briefFromNode, briefToFragment, CARET_SPACE } from "./richBrief";
import { COMBO_TEMPLATE } from "./comboRubric";
import { pointsLabel, nextPositionIn, pointsTotal, questionCount, questionsFor, statFor } from "./model";
import { ConfirmDialog } from "./ConfirmDialog";
import { FAvatar, FIcon } from "./icons";
import { linkToActivity } from "./FacultyApp";
import type { FacultyData } from "./FacultyApp";
import { ActivityTeamPanel } from "./ActivityTeamPanel";
import { NEW_ACTIVITY_STEPS, Steps } from "./Steps";

/**
 * The deadline the INDIVIDUAL hand-in is judged against, and the one this
 * screen's date field writes.
 *
 * 0007's `due_at` wins; rows created before it have only the older per-half
 * column. team_due_at is not a fallback here at any point: the two halves are
 * handed in separately, by different people, and a team answer measured against
 * the date its members' own work was due is a whole team marked late for a
 * deadline that was never theirs.
 */
/**
 * How wide the link dialog is drawn, in px — kept here as well as in the CSS
 * because the popover has to be held inside the description rather than run off
 * the side of it, and the arithmetic that does that needs the number.
 */
const LINK_POP_WIDTH = 320;

function indivDueOf(a: Activity): string | null {
  return a.due_at ?? a.individual_due_at;
}

/**
 * The one due date this screen shows.
 *
 * A team-only activity has no individual half for the date to belong to, so
 * there — and only there — its own team date leads.
 */
function dueOf(a: Activity): string | null {
  return SCOPE_OF[a.type] === "team" ? (a.team_due_at ?? indivDueOf(a)) : indivDueOf(a);
}

/** One person or team in the right-hand lists. */
interface Subject {
  id: string;
  name: string;
  tint: string | null;
  stamp: string | null;
  /** Handed in after the individual deadline. Never true on the team list. */
  late: boolean;
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

/**
 * "Mar 3, 11:47pm" — narrow enough to sit in the list column.
 *
 * The date rather than the weekday it used to name. Nothing on this list stays
 * within a week of today: by week 9 "Fri" is one of nine of them, and the row
 * anyone is squinting at is a late hand-in they are deciding what to do about.
 */
function fmtStamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${fmtTime(d)}`;
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
 * When it arrived, and whether that was in time.
 *
 * One component for both lists, because "who is done" and "who was late" are
 * the same question asked of a graded row and an ungraded one, and answering it
 * twice is how the two lists start disagreeing.
 */
function Stamp({ s }: { s: Subject }): JSX.Element | null {
  // Late is only ever set from a stamp that parsed, so there is no late-without-
  // a-time case to render.
  if (!s.stamp) return null;
  return (
    <span
      className="fv-num"
      style={{
        fontSize: "var(--fv-2xs)",
        color: s.late ? "var(--fv-amber)" : "var(--fv-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {s.late ? `Late · ${s.stamp}` : s.stamp}
    </span>
  );
}

/** Mirrors model.statFor's notion of "handed in", so the lists and the counts agree. */
const isIn = (r: Pick<ResultRow, "status">) =>
  r.status === "submitted" || r.status === "needs_review" || r.status === "scored";

/**
 * How an attachment is addressed on the row.
 *
 * A ref written before 0012 has a NAME and no path. removeActivityFileAt
 * matches on whichever it is handed, so this is the one key both kinds answer
 * to — and only a real path has bytes behind it to delete.
 */
const keyOf = (ref: FileRef) => ref.path ?? ref.name;

/**
 * What is attached to this activity, under the words that describe it.
 *
 * Uploading is not part of Save, and the drop zone says so in the one line it
 * has. The moment a file lands it is bytes in a private bucket and a name on the
 * row; the alternative is a Save that has to be able to un-upload and a Cancel
 * that has to delete objects a student may already have opened.
 *
 * A TF sees the list and none of the controls — they mark against what is
 * attached, and 0012's policies would refuse the write anyway.
 */
function ActivityFiles({
  activity,
  editing,
  canEdit,
  onChanged,
  signed,
}: {
  activity: Activity;
  /** Whether the page is in its edit mode. The list itself shows in both. */
  editing: boolean;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
  /**
   * Owned by the page, because the description links at these files too. Two
   * copies of the hook would mint every URL twice on two timers.
   */
  signed: SignedFiles;
}) {
  const held = useMemo<FileRef[]>(() => activity.files ?? [], [activity.files]);
  const { urls, ready } = signed;
  /** Which file of how many is in the air, so a drop of four says where it has got to. */
  const [going, setGoing] = useState<{ name: string; at: number; of: number } | null>(null);
  /** What the last batch would not take, in the order the files were picked. */
  const [notes, setNotes] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  /** The ref Remove was pressed against, carried from the press to the answer. */
  const [confirming, setConfirming] = useState<FileRef | null>(null);
  const [removing, setRemoving] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  // A ref rather than the two pieces of state, because both of those are set
  // asynchronously: two clicks landing in one tick would each read the old
  // value and start a batch, and two batches interleave their read-modify-write
  // of the files column and lose an upload.
  const working = useRef(false);

  // Set on the way IN as well as cleared on the way out. A ref initialised at
  // its declaration is initialised once per mount, and StrictMode mounts,
  // unmounts and mounts again — which leaves this false for the whole life of
  // the real component and silently drops every state set after an await.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const take = (picked: FileList | null) => {
    const files = Array.from(picked ?? []);
    if (!files.length || working.current) return;
    working.current = true;
    setNotes([]);
    void (async () => {
      const refused: string[] = [];
      // The count is carried through the loop by hand. `activity` cannot grow
      // until the refetch at the end, so asking held.length once per file would
      // wave a seventh past a cap the sixth had already reached — and would do
      // it after paying for the upload.
      let count = held.length;
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const no = refuseFile(file, count);
        if (no) {
          refused.push(no);
          continue;
        }
        setGoing({ name: file.name, at: i + 1, of: files.length });
        try {
          // Awaited one at a time. addActivityFile re-reads the row immediately
          // before it writes, but two of them in flight still interleave
          // read/read/write/write, and the second write is a list that never
          // had the first file in it.
          count = (await addActivityFile(activity, file)).length;
        } catch (e) {
          // Collected, not thrown: a fourth file that fails must not take the
          // screen away from the three that landed.
          refused.push(e instanceof Error ? e.message : `"${file.name}" was not uploaded.`);
        }
        if (!alive.current) {
          working.current = false;
          return;
        }
      }
      working.current = false;
      setGoing(null);
      setNotes(refused);
      // One refetch, at the end. Each file is already on the row before the
      // next one starts, so a batch that gave up halfway still reads back
      // everything it did manage.
      await onChanged();
    })();
  };

  const drop = (target: FileRef) => {
    if (working.current) return;
    working.current = true;
    setRemoving(true);
    setNotes([]);
    removeActivityFileAt(activity, keyOf(target))
      .then(() => onChanged())
      .catch((e) => {
        if (alive.current) {
          setNotes([e instanceof Error ? e.message : `"${target.name}" was not removed.`]);
        }
      })
      .finally(() => {
        working.current = false;
        if (!alive.current) return;
        setRemoving(false);
        setConfirming(null);
      });
  };

  // Only the course owner adds and drops files, and only while the page is
  // being edited. With neither the controls nor an attachment there is nothing
  // to put under the brief at all.
  const showTools = canEdit && editing;
  if (!held.length && !showTools) return null;
  const busy = going !== null || removing;

  return (
    <div className="fv-attach">
      <div className="fv-eyebrow">
        {held.length === 0
          ? "Attachments"
          : held.length === 1
            ? "Attachment"
            : `Attachments · ${held.length}`}
      </div>

      {held.length ? (
        <ul className="fv-attachlist">
          {held.map((ref, i) => {
            const url = ref.path ? urls.get(ref.path) : undefined;
            // Three ways there is nothing to open, and they are three different
            // sentences. No path at all is a row written before 0012: there are
            // no bytes anywhere and there never were, so it is listed and that
            // is the whole of what anyone can do with it.
            const note = !ref.path
              ? "Nothing was stored for this one. The activity kept the name and no file."
              : !ready
                ? "Opening…"
                : !url
                  ? "This one would not open just now. Reload the page to try again."
                  : null;
            return (
              <li className="fv-attachitem" key={ref.path ?? `${i}:${ref.name}`}>
                <div className="fv-attachrow">
                  <span className="fv-attachname">
                    {ref.name}
                    {ref.size ? <span className="fv-attachsize">{ref.size}</span> : null}
                  </span>
                  {url ? (
                    <a
                      className="fv-btn ghost sm fv-attachopen"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FIcon name="openInNew" size={14} />
                      Open
                    </a>
                  ) : null}
                  {showTools ? (
                    // Named after the file it takes, because six of these read
                    // "Remove" and a screen reader hears the list, not the row.
                    <button
                      type="button"
                      className="fv-btn ghost sm fv-attachdrop"
                      disabled={busy}
                      aria-label={`Remove ${ref.name}`}
                      onClick={() => setConfirming(ref)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                {note ? <div className="fv-attachnote">{note}</div> : null}
                {/* Only an image, and only once it has a URL: an <img> with no
                    src is a broken-image glyph, and a 4000px photograph at its
                    own size takes the brief off the side of the page. The alt
                    is the filename, which is the only description of it anybody
                    wrote.

                    Deliberately not wrapped in a link, though clicking a
                    picture to enlarge it is the habit — the name above already
                    opens the same file, and doing it twice puts six more tab
                    stops between the brief and the buttons under it. */}
                {kindOf(ref) === "image" && url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="fv-attachimg" src={url} alt={ref.name} loading="lazy" />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {showTools ? (
        <>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => {
              take(e.target.files);
              // Cleared, or choosing the same file twice fires no change event.
              e.target.value = "";
            }}
          />

          {held.length >= MAX_ATTACHMENTS ? (
            // No zone at all rather than one that refuses everything dropped on
            // it. The rule is the same sentence refuseFile would have said.
            <div className="fv-attachnote">
              {MAX_ATTACHMENTS} attachments is the most an activity carries. Remove one to add
              another.
            </div>
          ) : (
            <button
              type="button"
              className={`fv-dz sm${over ? " over" : ""}`}
              onClick={() => picker.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                take(e.dataTransfer.files);
              }}
            >
              <span style={{ color: "var(--fv-muted)" }}>
                <FIcon name="fileUpload" size={22} />
              </span>
              <span style={{ fontWeight: 600 }}>Add a PDF, PNG or JPG</span>
              <span className="fv-sub" style={{ fontSize: "var(--fv-xs)", lineHeight: 1.5 }}>
                Drop them here or click to choose. These go up as you add them — Save is for the
                words. Students read them once the activity is visible.
              </span>
            </button>
          )}

          {going ? (
            <div className="fv-attachgoing" role="status">
              {going.of > 1
                ? `Uploading ${going.at} of ${going.of} — ${going.name}`
                : `Uploading ${going.name}`}
            </div>
          ) : null}
          {removing ? (
            <div className="fv-attachgoing" role="status">
              Removing…
            </div>
          ) : null}
        </>
      ) : null}

      {notes.length ? (
        <ul className="fv-attachrefused" role="alert">
          {notes.map((n, i) => (
            <li key={`${i}:${n}`}>{n}</li>
          ))}
        </ul>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Remove this attachment?"
          body={
            <>
              <div style={{ color: "var(--fv-navy)", fontWeight: 600 }}>{confirming.name}</div>
              <div style={{ marginTop: 6 }}>
                {confirming.path
                  ? "It comes off this activity for everyone, students included, and the file is deleted. Uploading it again is the only way back."
                  : "Nothing was ever stored for this one, so only its name comes off the activity."}
              </div>
            </>
          }
          confirmLabel="Remove attachment"
          busy={removing}
          onConfirm={() => drop(confirming)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}

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

  // Owned here rather than inside the attachment list, because the description
  // links at these same files: the phrase in the brief and the row underneath
  // it get one URL each from one batched call, re-minted on one timer.
  const held = useMemo<FileRef[]>(() => activity.files ?? [], [activity.files]);
  const signedFiles = useSignedActivityFiles(held);
  const linkableFiles = useMemo(
    () => briefFiles(held, signedFiles.urls),
    [held, signedFiles.urls],
  );

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
  const brief = activity.source_text?.trim() ?? "";

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

    // Only the individual half has a deadline to be late against. The team half
    // is handed in once, by a team, on its own date — and is marked at the
    // check-in rather than by a clock — so nothing on a team list is ever
    // flagged late.
    const cutoff = kind === "team" ? NaN : Date.parse(indivDueOf(activity) ?? "");

    const people: Subject[] =
      kind === "team"
        ? data.teams.map((t) => ({
            id: t.id,
            name: t.name,
            tint: tintFor(t.name),
            stamp: null,
            late: false,
          }))
        : data.roster.map((s) => ({
            id: s.id,
            name: s.name,
            tint: s.avatar_tint,
            stamp: null,
            late: false,
          }));

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
      // submitted_at, never updated_at: grading writes to the row, so the
      // fallback GradingScreen uses to show *something* would turn every
      // student marked after the deadline into a late one.
      const arrived = r.submitted_at ? Date.parse(r.submitted_at) : NaN;
      const late = !Number.isNaN(cutoff) && !Number.isNaN(arrived) && arrived > cutoff;
      // Graded means RELEASED — status 'scored' is the same state the student's
      // own screen reads to show them a number. So somebody on this list can see
      // their grade, which is the only reading of "graded" that is useful to the
      // person deciding whether they still owe the class something.
      if (r.status === "scored") {
        doneList.push({
          ...p,
          stamp,
          late,
          grade: r.is_ci
            ? isCompletionMet(r)
              ? "Complete"
              : "Not complete"
            : outOf
              ? `${r.score ?? 0} / ${outOf}`
              : String(r.score ?? 0),
        });
      } else {
        inList.push({ ...p, stamp, late });
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
  // Says so on the button for a beat. window.alert is suppressed here and a
  // toast would be a whole mechanism for one word.
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(linkToActivity(activity.id, data.course.id));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      // Clipboard access can be refused — an insecure origin, a browser that
      // wants a user gesture it did not see. Say so rather than flashing
      // "Copied" over a clipboard that did not change.
      onError(e instanceof Error ? e : new Error("Could not copy the link"));
    }
  }
  // Deleting an activity cascades its check-ins, every submission against them,
  // and every mark. Counted while the question is on screen, not after it.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteCost, setDeleteCost] = useState<string | null>(null);

  // The title is the heading, so the caret goes there rather than into the
  // first field of a form — there is no form.
  const titleRef = useRef<HTMLInputElement | null>(null);
  const descRef = useRef<HTMLDivElement | null>(null);

  /**
   * The Cmd-K dialog, and where in the description it will write.
   *
   * The box is contentEditable, so "where" is a live Range rather than a pair
   * of offsets. It is captured when the dialog OPENS, not when it closes:
   * focusing the URL field takes the caret out of the box, and by the time
   * anyone presses Insert the browser has forgotten what was highlighted.
   */
  const [linking, setLinking] = useState<
    {
      text: string;
      url: string;
      /** Whether an existing link is being rewritten, not a gap filled. */
      replacing: boolean;
      /** Where to draw it, in the description wrapper's own coordinates. */
      top: number;
      left: number;
    } | null
  >(null);
  const [linkBad, setLinkBad] = useState(false);
  /** Where a new link goes. */
  const linkRange = useRef<Range | null>(null);
  /** The link the caret is in, or the one being edited. */
  const linkNode = useRef<HTMLAnchorElement | null>(null);
  /** Positioned parent for the two popovers, so they can sit by the words. */
  const descWrap = useRef<HTMLDivElement | null>(null);
  /**
   * The bar that appears when the caret lands in a link.
   *
   * This is what replaces having to KNOW that ⌘K works a second time: put the
   * caret in a link and its address and its two buttons are simply there.
   */
  const [chip, setChip] = useState<{ top: number; left: number; label: string; file: boolean } | null>(
    null,
  );

  /** The filename behind a `file:` token, for a link that was given no words. */
  const fileNameFor = (target: string): string | null => {
    const path = filePath(target);
    if (!path) return null;
    return held.find((r) => r.path === path)?.name ?? path.slice(path.lastIndexOf("/") + 1);
  };

  /**
   * Take out links that have lost their words.
   *
   * Delete the text of a link and the anchor stays behind, empty and invisible
   * — and the bar still appears when the caret lands in it, offering to change
   * a link that is not there. Worse, it is a link the box is only pretending to
   * have: briefFromNode already refuses to write one with nothing legible in
   * it, so it would vanish on save with no warning. Removing it as it empties
   * makes the box agree with what can actually be stored.
   *
   * The caret keeps its place, because this fires mid-sentence while somebody
   * is deleting, and a caret that jumps to the top of the box on the last
   * backspace is worse than the link it was cleaning up.
   */
  const dropEmptyLinks = () => {
    const el = descRef.current;
    if (!el) return;
    const sel = window.getSelection();
    const caretIn =
      sel && sel.rangeCount ? anchorAround(sel.getRangeAt(0).commonAncestorContainer, el) : null;
    const dead = Array.from(el.querySelectorAll<HTMLAnchorElement>("a[data-target]")).filter(
      (a) => !(a.textContent ?? "").split(CARET_SPACE).join("").trim(),
    );
    for (const anchor of dead) {
      const holder = document.createTextNode(CARET_SPACE);
      anchor.parentNode?.replaceChild(holder, anchor);
      if (anchor !== caretIn) continue;
      const range = document.createRange();
      range.setStart(holder, CARET_SPACE.length);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  /** Read the box back into the value that gets saved. */
  const syncDesc = () => {
    const el = descRef.current;
    if (el) setDesc(briefFromNode(el));
  };

  /** The link the caret is inside, or null. */
  const anchorAround = (node: Node | null, root: HTMLElement): HTMLAnchorElement | null => {
    for (let n = node; n && n !== root; n = n.parentNode) {
      if (n.nodeType === 1) {
        const el = n as HTMLElement;
        if (el.tagName === "A" && el.dataset.target) return el as HTMLAnchorElement;
      }
    }
    return null;
  };

  /**
   * Where a range actually is on screen.
   *
   * A COLLAPSED range — a caret with nothing selected — measures as a rect of
   * all zeros in Chrome. Subtracting the wrapper's own offset from zero then
   * gives a large negative number, and the card is drawn hundreds of pixels
   * above the description, off the top of the page. That is the cut-off card.
   *
   * Widening the range by one character to the left puts it on the same line in
   * the same place and gives it something to measure, without touching the DOM
   * — inserting and removing a marker node would invalidate the very range that
   * is about to be saved.
   */
  const measure = (range: Range, box: HTMLElement): DOMRect => {
    const direct = range.getBoundingClientRect();
    if (direct.width || direct.height) return direct;
    if (range.startContainer.nodeType === 3 && range.startOffset > 0) {
      const probe = range.cloneRange();
      probe.setStart(range.startContainer, range.startOffset - 1);
      const widened = probe.getBoundingClientRect();
      if (widened.width || widened.height) return widened;
    }
    // An empty box, or a caret somewhere with nothing to measure either side.
    return box.getBoundingClientRect();
  };

  /** Where a popover goes, in the wrapper's coordinates rather than the page's. */
  const posFor = (rect: DOMRect): { top: number; left: number } => {
    const wrap = descWrap.current;
    if (!wrap) return { top: 0, left: 0 };
    const base = wrap.getBoundingClientRect();
    // Held inside the wrapper, so a link at the right-hand end of a line does
    // not open a card that runs off the side of the page.
    const room = Math.max(0, wrap.clientWidth - LINK_POP_WIDTH);
    return {
      // Never above the wrapper. Whatever went wrong with the measurement, a
      // card the instructor can see and dismiss beats one they cannot reach.
      top: Math.max(0, rect.bottom - base.top + 8),
      left: Math.max(0, Math.min(rect.left - base.left, room)),
    };
  };

  /** A link's address as something a person reads: a filename, or a host. */
  const readableTarget = (target: string): string => {
    const name = fileNameFor(target);
    if (name) return name;
    const href = safeHref(target);
    if (!href) return target;
    const url = new URL(href);
    const tail = url.pathname === "/" ? "" : url.pathname;
    return `${url.host}${tail}`;
  };

  /** Open the dialog on the link the caret is in. */
  const editLink = () => {
    const anchor = linkNode.current;
    if (!anchor) return;
    setLinkBad(false);
    setChip(null);
    linkRange.current = null;
    setLinking({
      text: anchor.textContent ?? "",
      url: anchor.dataset.target ?? "",
      replacing: true,
      ...posFor(anchor.getBoundingClientRect()),
    });
  };

  /**
   * Show or hide the bar for whatever the caret is in now.
   *
   * Called from the box's own click and key handlers rather than from a
   * document-wide selectionchange listener: this only has to be right while
   * somebody is in the box, and a global listener would fire on every selection
   * anywhere on the page for the whole time the editor is open.
   */
  const refreshChip = () => {
    const el = descRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return setChip(null);
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return setChip(null);
    const anchor = anchorAround(range.commonAncestorContainer, el);
    if (!anchor) {
      linkNode.current = null;
      return setChip(null);
    }
    linkNode.current = anchor;
    const target = anchor.dataset.target ?? "";
    setChip({
      ...posFor(anchor.getBoundingClientRect()),
      label: readableTarget(target),
      file: Boolean(filePath(target)),
    });
  };

  const openLink = () => {
    const el = descRef.current;
    if (!el) return;
    let sel = window.getSelection();
    // Pressed from the toolbar with the caret somewhere else on the page. Put
    // it at the end of the description rather than doing nothing: a button that
    // sometimes ignores you is worse than one that always writes somewhere.
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      el.focus();
      const end = document.createRange();
      end.selectNodeContents(el);
      end.collapse(false);
      sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(end);
    }
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    setLinkBad(false);

    // Cmd-K with the caret inside a link EDITS that link, which is what every
    // editor does and what people press it expecting. Without this the second
    // Cmd-K nests a link inside the words of the first and breaks both.
    const found = anchorAround(range.commonAncestorContainer, el);
    if (found) {
      linkNode.current = found;
      editLink();
      return;
    }
    linkNode.current = null;
    linkRange.current = range.cloneRange();
    setChip(null);
    setLinking({
      text: range.toString(),
      url: "",
      replacing: false,
      ...posFor(measure(range, el)),
    });
  };

  /**
   * The same dialog, reached from the paperclip.
   *
   * With one attachment there is no choice to make, so it is made: the button
   * says "File" and one press links the file. With several, the dialog's own
   * list is the choice.
   */
  const openFileLink = () => {
    openLink();
    const only = held.length === 1 ? held[0] : null;
    if (!only?.path) return;
    const path = only.path;
    setLinking((cur) =>
      cur ? { ...cur, url: fileToken(path), text: cur.text.trim() ? cur.text : only.name } : cur,
    );
  };

  /**
   * Put the caret after a link that was just written, and read the box back.
   *
   * The zero-width space is doing real work: with the caret merely placed after
   * the anchor, a browser will happily carry on typing INSIDE it and the next
   * word joins the link. A text node of its own to land in is the reliable way
   * out, and briefFromNode strips the character so it never reaches the column.
   */
  const caretAfter = (anchor: HTMLAnchorElement) => {
    const el = descRef.current;
    if (!el) return;
    let after = anchor.nextSibling;
    // Offset 0 of the text that already follows — the far end of it is the end
    // of the sentence, which is not where anybody was writing.
    let offset = 0;
    if (!after || after.nodeType !== 3) {
      after = document.createTextNode(CARET_SPACE);
      anchor.parentNode?.insertBefore(after, anchor.nextSibling);
      // Past the spacer rather than in front of it, so the caret is clear of
      // the link's boundary and the next word does not join it.
      offset = CARET_SPACE.length;
    }
    const range = document.createRange();
    range.setStart(after, offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.focus();
    syncDesc();
  };

  const insertLink = () => {
    if (!linking) return;
    const target = linking.url.trim();
    // Checked with the SAME functions the renderer uses, so the editor cannot
    // author a link that would come out as dead text in front of the class:
    // either a web address it will open, or a file this activity carries.
    if (!safeHref(target) && !filePath(target)) {
      setLinkBad(true);
      return;
    }
    // A link with no words falls back to the filename for an attachment and to
    // the address for the web — in both cases the most readable thing to hand.
    const label = linking.text.trim() || fileNameFor(target) || target;

    const existing = linkNode.current;
    if (existing) {
      existing.textContent = label;
      existing.dataset.target = target;
      if (filePath(target)) existing.dataset.kind = "file";
      else delete existing.dataset.kind;
      setLinking(null);
      caretAfter(existing);
      return;
    }
    const range = linkRange.current;
    if (!range) return;
    const anchor = briefAnchor(document, label, target);
    range.deleteContents();
    range.insertNode(anchor);
    setLinking(null);
    caretAfter(anchor);
  };

  /**
   * Enter, done by hand.
   *
   * Left to the browser, a break taken at the end of a link is taken INSIDE it:
   * the anchor is carried onto the new line and everything typed there comes
   * out blue and linked to the same place. Stepping the caret past the anchor
   * first is what stops that.
   *
   * The break itself still goes through execCommand, which is what keeps ⌘Z
   * working — and it does not matter whether the browser writes a newline, a
   * <br> or a <div>, because briefFromNode reads all three as one line break.
   */
  const newLine = () => {
    const el = descRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // Only for a caret. A selection spanning a link is being REPLACED by the
    // break, so where it starts is not where the new line belongs.
    if (range.collapsed) {
      const anchor = anchorAround(range.commonAncestorContainer, el);
      if (anchor) {
        const out = document.createRange();
        out.setStartAfter(anchor);
        out.collapse(true);
        sel.removeAllRanges();
        sel.addRange(out);
      }
    }
    document.execCommand("insertText", false, "\n");
    syncDesc();
    setChip(null);
  };

  /** Unwrap a link back to its words, leaving the sentence intact. */
  const removeLink = () => {
    const anchor = linkNode.current;
    const el = descRef.current;
    if (!anchor || !el) return;
    anchor.parentNode?.replaceChild(document.createTextNode(anchor.textContent ?? ""), anchor);
    setLinking(null);
    setChip(null);
    syncDesc();
    el.focus();
  };

  /** Point the dialog at one of the activity's attachments. */
  const pickFile = (ref: FileRef) => {
    if (!linking || !ref.path) return;
    setLinkBad(false);
    setLinking({
      ...linking,
      url: fileToken(ref.path),
      // Only when nothing was selected and nothing typed: a phrase the
      // instructor chose always outranks a filename.
      text: linking.text.trim() ? linking.text : ref.name,
    });
  };

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

  // Fill the box, once, when the editor opens — turning the stored
  // `[label](target)` into the anchors somebody can actually read.
  //
  // Deliberately NOT keyed on `desc`. That is rewritten on every keystroke, and
  // refilling the box would put the caret back at the start of it each time;
  // the box owns its own contents while the editor is open, and syncDesc reads
  // them back out. Keyed on the activity as well as on `editing` so moving
  // between activities cannot leave the previous one's words behind.
  useEffect(() => {
    const el = descRef.current;
    if (!editing || !el) return;
    el.replaceChildren(briefToFragment(document, activity.source_text ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, activity.id]);

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
      const patch: Partial<Activity> = {
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

        // Picking Combo hands over the course's combo rubric, already written:
        // two challenge problems marked for effort and mark-up, and the two
        // tutorial screens. It writes nothing unless the rubric is completely
        // empty, so switching an activity that has been set up keeps what is
        // there, and everything it does write is editable on the Rubric page.
        if (kind === "combo") {
          await seedRubricTemplate({ ...withKind, points_total: nextPoints }, COMBO_TEMPLATE);
        }
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
        <span style={{ flex: 1 }} />
        {/* The link this page now has. Built here rather than copied out of the
            address bar because the bar carries whatever else the session put
            there — a course id, a tab — and a link with those on it sends the
            next person somewhere subtly different from this page. */}
        <button
          type="button"
          className="fv-btn ghost sm"
          title="Copy a link that opens this activity — paste it into Canvas"
          onClick={() => void copyLink()}
        >
          <FIcon name="copy" size={15} />
          {copied ? "Copied" : "Copy link"}
        </button>
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
                {/* "Individual work due", not "Due": on an activity with both
                    halves there are two hand-ins and only one of them is
                    measured against this date. */}
                {dueLine
                  ? `${scope === "team" ? "Due" : "Individual work due"} ${dueLine}`
                  : "No due date set"}
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
              in it.

              An activity with no brief SAYS so. This slot used to print a
              sentence generated from the type and the title, in the same face
              and measure as written prose, so an activity nobody had described
              looked described — and pressing Edit opened a box holding the
              nothing that was really there, which reads as the description
              having been wiped. That sentence was never on a student's screen
              either: the student side stopped inventing one for the same
              reason. */}
          {editing ? (
            /* The description and everything that acts on it, in one positioned
               box so the two popovers can sit beside the words they are about
               rather than at the bottom of the page. */
            <div className="fv-descwrap" ref={descWrap}>
              {/* The toolbar carries the whole explanation. A chain and a
                  paperclip are the two marks everyone already reads as "link"
                  and "file", the shortcut is printed on the button that owns it
                  rather than in a sentence underneath, and the paperclip says
                  for itself that it is unavailable until something is attached.
                  The paragraph of instructions this replaces was the tell that
                  none of it was findable. */}
              <div className="fv-descbar">
                <button
                  type="button"
                  className="fv-descbtn"
                  onClick={openLink}
                  // The selection has to survive the press, and a button takes
                  // focus on mousedown — which collapses it before the click.
                  onMouseDown={(e) => e.preventDefault()}
                  title="Turn the selected words into a link"
                >
                  <FIcon name="link" size={15} />
                  Link
                  <kbd className="fv-kbd">⌘K</kbd>
                </button>
                <button
                  type="button"
                  className="fv-descbtn"
                  onClick={openFileLink}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={!held.length}
                  title={
                    held.length
                      ? "Link the selected words to a file — students click the words and it downloads"
                      : "Attach a file below first, then you can link words to it"
                  }
                >
                  <FIcon name="attachFile" size={15} />
                  File
                </button>
              </div>

              <div
                id="fv-ed-desc"
                ref={descRef}
                className="fv-descin"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label="Description"
                data-placeholder="Describe what they do. Leave it empty and students see no description."
                // UNCONTROLLED on purpose. Re-rendering the box's children from
                // state on every keystroke puts the caret back at the start on
                // every keystroke; the effect above fills it once when the
                // editor opens, and the DOM is the live copy until it is read
                // back.
                data-empty={desc ? undefined : "true"}
                onInput={() => {
                  // Order matters: clear out the empties first, so what is read
                  // back and what the bar is drawn from are the same box.
                  dropEmptyLinks();
                  syncDesc();
                  refreshChip();
                }}
                onBlur={syncDesc}
                onClick={refreshChip}
                onKeyUp={refreshChip}
                onKeyDown={(e) => {
                  // The shortcut every editor uses for this, so nobody has to
                  // be told it exists. Meta on a Mac, Ctrl elsewhere.
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                    e.preventDefault();
                    openLink();
                    return;
                  }
                  // Shift-Enter too: in a box with no paragraphs, both mean
                  // "next line", and only one of them working is a papercut.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    newLine();
                  }
                }}
                onPaste={(e) => {
                  // Paste the WORDS, never the markup. A paste out of a web
                  // page otherwise arrives with its spans, its styling and its
                  // own anchors, and a brief slowly turns into somebody's
                  // stylesheet. execCommand is the deprecated call every
                  // browser still implements and the only one that keeps the
                  // native undo stack — losing ⌘Z in a writing box is worse
                  // than the deprecation.
                  e.preventDefault();
                  document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
                }}
              />

              {/* Put the caret in a link and this says where it goes and offers
                  the only two things anyone wants to do to it. Nothing to know
                  and nothing to read first. */}
              {chip && !linking ? (
                <div className="fv-linkchip" style={{ top: chip.top, left: chip.left }}>
                  <FIcon name={chip.file ? "attachFile" : "link"} size={13} />
                  <span className="fv-linkchipname" title={chip.label}>
                    {chip.label}
                  </span>
                  <button
                    type="button"
                    className="fv-chipbtn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={editLink}
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    className="fv-chipbtn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={removeLink}
                  >
                    <FIcon name="linkOff" size={13} />
                    Remove
                  </button>
                </div>
              ) : null}

              {linking ? (
                <div className="fv-linkpop" style={{ top: linking.top, left: linking.left }}>
                  <div className="fv-linkrow">
                    <span className="fv-linkkey">Text</span>
                    <input
                      className="fv-in"
                      placeholder="Words students will see"
                      value={linking.text}
                      onChange={(e) => setLinking({ ...linking, text: e.target.value })}
                      // Enter and Escape work from EITHER field. Having them on
                      // only one is how a dialog feels half-finished: you tab
                      // back to fix the words, press Enter, and nothing happens.
                      onKeyDown={(e) => {
                        if (e.key === "Enter") insertLink();
                        if (e.key === "Escape") setLinking(null);
                      }}
                    />
                  </div>
                  <div className="fv-linkrow">
                    <span className="fv-linkkey">Link</span>
                    <input
                      className="fv-in"
                      placeholder="Paste a web address"
                      autoFocus
                      // A file's token is machine-written and unreadable, so the
                      // field shows the filename instead. What is stored
                      // underneath is unchanged.
                      value={fileNameFor(linking.url) ?? linking.url}
                      readOnly={Boolean(filePath(linking.url))}
                      onChange={(e) => {
                        setLinkBad(false);
                        setLinking({ ...linking, url: e.target.value });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") insertLink();
                        if (e.key === "Escape") setLinking(null);
                        // Backspace on a chosen file clears it rather than
                        // doing nothing, so there is a way back out.
                        if (e.key === "Backspace" && filePath(linking.url)) {
                          e.preventDefault();
                          setLinking({ ...linking, url: "" });
                        }
                      }}
                    />
                  </div>

                  {held.length ? (
                    <div className="fv-linkfiles">
                      {held.map((ref, i) => {
                        const chosen = Boolean(ref.path) && linking.url === fileToken(ref.path ?? "");
                        return (
                          <button
                            key={ref.path ?? `${i}:${ref.name}`}
                            type="button"
                            className={`fv-filechip${chosen ? " on" : ""}`}
                            // A ref written before 0012 has a name and no bytes
                            // anywhere, so there is nothing for a link to reach.
                            disabled={!ref.path}
                            title={ref.path ? ref.name : "No file was stored for this one."}
                            onClick={() => pickFile(ref)}
                          >
                            <FIcon name="attachFile" size={12} />
                            {ref.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {linkBad ? (
                    <div className="fv-linkbad">
                      That is not a web address this will open — links have to start with http or
                      https. To point at a file, pick one above.
                    </div>
                  ) : null}

                  <div className="fv-linkactions">
                    <button type="button" className="fv-btn primary sm" onClick={insertLink}>
                      {linking.replacing ? "Save" : "Add link"}
                    </button>
                    <button
                      type="button"
                      className="fv-btn ghost sm"
                      onClick={() => setLinking(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : brief ? (
            <p
              style={{
                margin: "20px 0 0",
                fontSize: 16,
                lineHeight: 1.65,
                maxWidth: "64ch",
                // Matches the student card: the line breaks typed into the box
                // above are kept, so what is written here is what the class reads.
                whiteSpace: "pre-wrap",
              }}
            >
              {/* Same renderer the class reads it through, so a link that works
                  here works there and one that was refused is visibly dead to
                  the only person who can fix it. */}
              <BriefText text={brief} files={linkableFiles} />
            </p>
          ) : (
            <p
              style={{
                margin: "20px 0 0",
                fontSize: 16,
                lineHeight: 1.65,
                maxWidth: "64ch",
                color: "var(--fv-muted)",
              }}
            >
              No description yet — students see a line saying you haven&rsquo;t written one.
            </p>
          )}

          {/* Under the brief, because that is what they belong to: the sheet
              the description is describing, the photograph of the board it
              refers to. A TF reads them here too — they mark against them. */}
          <ActivityFiles
            activity={activity}
            editing={editing}
            canEdit={data.can.author}
            onChanged={onChanged}
            signed={signedFiles}
          />

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
                    {SCOPE_OF[kind] === "team" ? "Due" : "Individual work due"}
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

              {/* Said here rather than left to be inferred from a field
                  labelled "Due". One column holds one date, and which half of
                  the work it governs was the question — a team that discusses
                  on Thursday is not late for a Tuesday hand-in. */}
              {SCOPE_OF[kind] === "team" ? null : (
                <div
                  className="fv-sub"
                  style={{ marginTop: 8, fontSize: "var(--fv-2xs)", lineHeight: 1.5 }}
                >
                  This is the deadline for the individual hand-in, and the only one anything is
                  marked late against.
                  {SCOPE_OF[kind] === "both"
                    ? " The team half is marked at the check-in, on its own schedule."
                    : ""}
                </div>
              )}

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
                      {/* When it came in sits beside what it got: a released
                          grade does not stop the hand-in time mattering, and a
                          late one is exactly the row anyone goes looking for. */}
                      <Stamp s={s} />
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
                      <Stamp s={s} />
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
