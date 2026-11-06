"use client";

// Activity detail: the full-screen view reached by clicking a row on Activities.
//
// Left two-thirds is what the activity IS, right third is who has handed it in.
// Everything on the right is keyed off SCOPE, so a team activity lists teams and
// counts out of the number of teams — type only picks the label and the accent.

import type { ResultRow } from "@/checkins/data";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { deleteActivity, tintFor, updateActivity } from "@/checkins/data";
import { deleteActivityRecordings } from "@/checkins/audio";
import { BriefText } from "@/checkins/BriefText";
import { briefFiles } from "@/checkins/briefLinks";
import { pastDeadline } from "@/checkins/handIn";
import { purgeActivityStorage } from "@/checkins/purge";
import { isCompletionMet, isOpenToStudents } from "@/checkins/studentData";
import {
  HIDDEN_INSTANT,
  INDIV_ELSEWHERE,
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
  closeHandIn,
  countWorkForActivity,
  ensureCheckIn,
  handInUpload,
  listReopens,
  listUploads,
  removeActivityFileAt,
  reopenHandIn,
  seedRubricTemplate,
  setActivityPoints,
} from "./facultyData";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, kindOf, refuseFile } from "./activityFiles";
import { type SignedFiles, useSignedActivityFiles } from "./useSignedActivityFiles";
import { DescriptionEditor } from "./DescriptionEditor";
import { COMBO_TEMPLATE } from "./comboRubric";
import { pointsLabel, nextPositionIn, pointsTotal, questionCount, questionsFor, statFor } from "./model";
import { ConfirmDialog } from "./ConfirmDialog";
import { FAvatar, FIcon } from "./icons";
import { teamsOf } from "@/checkins/rosters";
import { linkToActivity } from "./FacultyApp";
import type { FacultyData, GradeFocus } from "./FacultyApp";
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
  /** What they got, on the released and sent-for-review lists. Null elsewhere. */
  grade?: string | null;
  /** Where their work stands, on the Reopened list: handed in, uploaded, nothing. */
  note?: string | null;
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

/** The collapsible heading over one pile of people: dot, label, count, chevron. */
function PileHeader({
  label,
  dot,
  count,
  open,
  onToggle,
  first = false,
}: {
  label: string;
  dot: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  first?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="fv-group"
      style={first ? { marginTop: 18 } : { marginTop: 12, borderTop: "1px solid var(--fv-neutral-200)" }}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="fv-dot" style={{ background: dot }} />
      <span style={{ flex: 1, textAlign: "left", fontWeight: 600 }}>{label}</span>
      <span className="fv-sub fv-num">{count}</span>
      <span className={`fv-chev${open ? " open" : ""}`} style={{ color: "var(--fv-muted)" }}>
        <FIcon name="chevronRight" size={16} />
      </span>
    </button>
  );
}

/**
 * One pile's rows: who, when it came in, and — on the piles that have one —
 * the mark. When it came in sits beside the mark because a grade does not
 * stop the hand-in time mattering, and a late one is exactly the row anyone
 * goes looking for.
 */
function PersonRows({
  list,
  empty,
  gradeColor = "var(--fv-navy)",
  muted = false,
  onOpen,
  action,
}: {
  list: Subject[];
  empty: string;
  /** Navy where the grade is settled; muted where it is still waiting. */
  gradeColor?: string;
  muted?: boolean;
  /**
   * Open this one's work on the grading page. Given on the piles that have
   * work to open and to someone allowed to grade; a row without it is text.
   */
  onOpen?: (s: Subject) => void;
  /**
   * A control at the end of the row — Reopen, Close. Only on a pile whose rows
   * are not themselves buttons: a button inside a button is not something a
   * browser or a screen reader can make sense of, so `onOpen` wins.
   */
  action?: (s: Subject) => React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 2 }}>
      {list.length === 0 ? (
        <div className="fv-sub" style={{ padding: "4px 8px" }}>
          {empty}
        </div>
      ) : (
        list.map((s) => (
          <PersonRow key={s.id} s={s} muted={muted} onOpen={onOpen} action={action}>
            <FAvatar name={s.name} tint={s.tint} size={22} />
            {/* The note goes under the name: the column is narrow, and beside it
                the name and the row's buttons had no room left. */}
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.name}
              </span>
              {s.note ? (
                <span
                  className="fv-sub"
                  style={{
                    fontSize: "var(--fv-2xs)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.note}
                </span>
              ) : null}
            </span>
            <Stamp s={s} />
            {s.grade ? (
              <span
                className="fv-num"
                style={{
                  fontSize: "var(--fv-2xs)",
                  color: gradeColor,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {s.grade}
              </span>
            ) : null}
          </PersonRow>
        ))
      )}
    </div>
  );
}

/**
 * The row itself: a button when there is somewhere to go, a div when there is
 * not, so a name on the Not submitted pile never reads as clickable.
 */
function PersonRow({
  s,
  muted,
  onOpen,
  action,
  children,
}: {
  s: Subject;
  muted: boolean;
  onOpen?: (s: Subject) => void;
  action?: (s: Subject) => React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  const style = muted ? { color: "var(--fv-muted)" } : undefined;
  if (!onOpen) {
    return (
      <div className="fv-person" style={style}>
        {children}
        {action?.(s)}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="fv-person fv-person-open"
      style={style}
      onClick={() => onOpen(s)}
      aria-label={`Open ${s.name}'s work`}
      title="Open on the grading page"
    >
      {children}
    </button>
  );
}

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
  /**
   * Grade this activity. With a focus, the grading page opens on that one
   * student or team instead of the top of the list.
   */
  onGrade: (focus?: GradeFocus) => void;
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
    statFor(activity, data.checkIns, data.results, data.roster, teamsOf(data, activity.id));

  const weekLine = useMemo(() => {
    if (activity.week == null) return "Unscheduled";
    const w = data.weeks.find((x) => x.week === activity.week);
    const dates = w?.dates_label ?? activity.dates_label;
    return dates ? `Week ${activity.week} · ${dates}` : `Week ${activity.week}`;
  }, [data.weeks, activity.week, activity.dates_label]);

  const dueAt = dueOf(activity);
  const dueLine = dueAt ? fmtInstant(dueAt) : null;

  // A name on a pile with work behind it opens that work. Same permission as
  // the button underneath — a TF who cannot grade gets a list they can read
  // and nothing to press.
  const openWork = data.can.grade
    ? (s: Subject) => onGrade({ subjectId: s.id, kind: pileKind })
    : undefined;

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

  const { released, inReview, submitted, missing, pileKind } = useMemo(() => {
    // A `both` activity owns two check-ins; its individual half is the one the
    // stat counts, so the lists have to read the same half.
    const kind: GradeFocus["kind"] = scope === "team" ? "team" : "individual";
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
        ? teamsOf(data, activity.id).map((t) => ({
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

    const gradeOn = (r: ResultRow): string =>
      r.is_ci
        ? isCompletionMet(r)
          ? "Complete"
          : "Not complete"
        : outOf
          ? `${r.score ?? 0} / ${outOf}`
          : String(r.score ?? 0);

    const releasedList: Subject[] = [];
    const reviewList: Subject[] = [];
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
      // Released — status 'scored' is the same state the student's own screen
      // reads to show them a number, so somebody on this list can see their
      // grade. Sent for review sits between: the TF is done with it, the mark
      // exists, and the student still reads "Turned in" until it is released.
      if (r.status === "scored") {
        releasedList.push({ ...p, stamp, late, grade: gradeOn(r) });
      } else if (r.status === "needs_review") {
        reviewList.push({ ...p, stamp, late, grade: gradeOn(r) });
      } else {
        inList.push({ ...p, stamp, late });
      }
    }
    // Four lists, no overlap: everyone with a row is in exactly one stage of
    // submitted → graded and sent for review → released. The bar above still
    // reads handed-in-at-all, which is a different question and the right one
    // for it.
    return {
      released: releasedList,
      inReview: reviewList,
      submitted: inList,
      missing: outList,
      pileKind: kind,
    };
  }, [data.checkIns, data.results, data.roster, data.teams, data.frozenTeams, activity, scope]);

  const [releasedOpen, setReleasedOpen] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(true);
  const [subOpen, setSubOpen] = useState(true);
  const [notOpen, setNotOpen] = useState(false);

  // ------------------------------------------------------ reopened hand-ins
  //
  // A student's own hand-in closes at the individual deadline (0044), and the
  // instructor reopens it one student at a time. Read here, for this activity
  // alone, rather than on the whole-course refresh: no other screen asks.
  //
  // Only where a hand-in can close at all. A team half is handed in at the
  // check-in and never closes, an Amplify half is answered on Amplify, and an
  // activity with no due date never closes — a Reopen button on any of them
  // would open nothing.
  const handsInHere =
    scope !== "team" && INDIV_ELSEWHERE[activity.type] === null && indivDueOf(activity) !== null;
  const [reopened, setReopened] = useState<Set<string>>(() => new Set());
  const [reopenBusy, setReopenBusy] = useState<string | null>(null);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopenedOpen, setReopenedOpen] = useState(true);

  useEffect(() => {
    setReopened(new Set());
    setReopenError(null);
    if (!handsInHere) return;
    let alive = true;
    listReopens(activity.id)
      .then((ids) => {
        if (alive) setReopened(new Set(ids));
      })
      .catch((e: unknown) => {
        if (alive) setReopenError(e instanceof Error ? e.message : "Could not read who this was reopened for.");
      });
    return () => {
      alive = false;
    };
  }, [activity.id, handsInHere]);

  // Reopen is offered once something is closed, and not before: until the
  // deadline every student can hand in, and a button that changes nothing
  // reads as though it does something.
  const closedNow = handsInHere && pastDeadline(activity);
  // Whoever grades (0055): the owner, and a TF when grading is on for TFs.
  const canReopen = data.can.grade;

  async function setHandInOpen(studentId: string, open: boolean) {
    setReopenBusy(studentId);
    setReopenError(null);
    try {
      if (open) await reopenHandIn(activity.id, studentId);
      else await closeHandIn(activity.id, studentId);
      setReopened((prev) => {
        const next = new Set(prev);
        if (open) next.add(studentId);
        else next.delete(studentId);
        return next;
      });
    } catch (e) {
      setReopenError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setReopenBusy(null);
    }
  }

  // Each reopened student's row on the individual half, the only half a reopen
  // opens. Any status: a draft is exactly the case worth seeing here.
  const reopenedRows = useMemo(() => {
    const ids = new Set(
      data.checkIns
        .filter((c) => c.activity_id === activity.id && c.kind === "individual")
        .map((c) => c.id),
    );
    const out = new Map<string, ResultRow>();
    for (const r of data.results) {
      if (ids.has(r.check_in_id) && r.student_id && reopened.has(r.student_id)) {
        out.set(r.student_id, r);
      }
    }
    return out;
  }, [data.checkIns, data.results, activity.id, reopened]);

  // Uploading is not handing in. A reopened student who stopped at the upload
  // has a draft row with a PDF on it, and no pile counted them as in, so they
  // sat here with nothing to press and never reached the grading page.
  const draftIds = [...reopenedRows.values()]
    .filter((r) => !isIn(r))
    .map((r) => r.id)
    .sort()
    .join(",");
  const [uploads, setUploads] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    if (!draftIds) {
      setUploads(new Map());
      return;
    }
    let alive = true;
    listUploads(draftIds.split(","))
      .then((m) => {
        if (alive) setUploads(m);
      })
      .catch((e) => {
        if (alive) setReopenError(e instanceof Error ? e.message : "Could not read what was uploaded.");
      });
    return () => {
      alive = false;
    };
  }, [draftIds]);

  const uploadOf = (studentId: string): { resultId: string; at: string } | null => {
    const r = reopenedRows.get(studentId);
    const at = r && !isIn(r) ? uploads.get(r.id) : undefined;
    return r && at ? { resultId: r.id, at } : null;
  };

  const noteFor = (studentId: string): string => {
    const r = reopenedRows.get(studentId);
    if (r && isIn(r)) return "Handed in";
    return uploadOf(studentId) ? "PDF uploaded" : "Nothing yet";
  };

  // Hand the upload in for them and open it to grade. Stamped with the upload
  // time, so Late still reads the student's own timing.
  const [grading, setGrading] = useState<string | null>(null);
  async function gradeUpload(studentId: string) {
    const up = uploadOf(studentId);
    if (!up) return;
    setGrading(studentId);
    setReopenError(null);
    try {
      await handInUpload(up.resultId, up.at);
      await onChanged();
      onGrade({ subjectId: studentId, kind: "individual" });
    } catch (e) {
      setReopenError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setGrading(null);
    }
  }

  // Off the roster, not off the piles: a reopened student who has since handed
  // in has left Not submitted, and the reopen still stands until it is closed.
  const reopenedList: Subject[] = data.roster
    .filter((st) => reopened.has(st.id))
    .map((st) => ({
      id: st.id,
      name: st.name,
      tint: st.avatar_tint,
      stamp: null,
      late: false,
      note: noteFor(st.id),
    }));

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
                {/* What it is out of, stated here for everyone. The editor's
                    "Out of" field is the only other place this number appears,
                    and a TF who cannot author never opens the editor — so
                    without this line the total was a fact only the owner
                    could see on the assignment page. */}
                {" · "}
                {isCompletion(activity) ? "Marked for completion" : `out of ${pointsLabel(activity)}`}
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
            /* The same box every activity writes its description in: links,
               file links, the lot. Mounted only while editing and keyed on the
               activity, so it fills once from what is stored and cannot carry
               one activity's words into another's. */
            <DescriptionEditor
              key={activity.id}
              initial={activity.source_text ?? ""}
              files={held}
              onChange={setDesc}
              placeholder="Describe what they do. Leave it empty and students see no description."
            />
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
                    {/* Live questions is made from "+ Activity → Live questions" and has its
                        own page; turning a rubric-graded activity into one here
                        would leave it with no questions and no way to write them. */}
                    {(Object.keys(TYPE_LABEL) as ActivityType[]).filter((t) => t !== "live").map((t) => (
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
            teams={teamsOf(data, activity.id)}
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

            {/* Top to bottom is done to not-started, one pile per stage:
                Released the class can already see; Sent for review is marked
                and waiting on the instructor; To grade is waiting on a TF;
                Not submitted is waiting on the student. Each count is its
                list's own length, not stat.graded — the bar above counts
                everyone who handed in at all, which is a different question
                and the right one for a bar. */}
            <PileHeader
              label="Released"
              dot="var(--fv-navy)"
              count={released.length}
              open={releasedOpen}
              onToggle={() => setReleasedOpen((v) => !v)}
              first
            />
            {releasedOpen ? (
              <PersonRows
                list={released}
                empty="Nothing released yet. Marking is not the same as releasing — a grade reaches the student when you release it."
                onOpen={openWork}
              />
            ) : null}

            <PileHeader
              label="Sent for review"
              dot="var(--fv-sky)"
              count={inReview.length}
              open={reviewOpen}
              onToggle={() => setReviewOpen((v) => !v)}
            />
            {reviewOpen ? (
              <PersonRows
                list={inReview}
                empty="Nothing waiting on review. Grading ends with Send for review; it lands here until it is released."
                gradeColor="var(--fv-muted)"
                onOpen={openWork}
              />
            ) : null}

            <PileHeader
              label="To grade"
              dot="var(--fv-emerald)"
              count={submitted.length}
              open={subOpen}
              onToggle={() => setSubOpen((v) => !v)}
            />
            {subOpen ? (
              <PersonRows list={submitted} empty="Nothing waiting to be graded." onOpen={openWork} />
            ) : null}

            <PileHeader
              label="Not submitted"
              dot="var(--fv-neutral-300)"
              count={Math.max(stat.total - stat.submitted, 0)}
              open={notOpen}
              onToggle={() => setNotOpen((v) => !v)}
            />
            {notOpen ? (
              <>
                {closedNow && dueLine ? (
                  <div className="fv-sub" style={{ padding: "2px 8px 6px", lineHeight: 1.5 }}>
                    Hand-ins closed {dueLine}.
                    {canReopen
                      ? " Reopen lets one student hand in late — it will show as Late."
                      : ""}
                  </div>
                ) : null}
                <PersonRows
                  list={missing}
                  empty="Everyone is in."
                  muted
                  action={
                    closedNow
                      ? (s) =>
                          reopened.has(s.id) ? (
                            <span
                              style={{
                                fontSize: "var(--fv-2xs)",
                                color: "var(--fv-amber)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Reopened
                            </span>
                          ) : canReopen ? (
                            <button
                              type="button"
                              className="fv-btn outline sm"
                              style={{ height: 26, padding: "0 9px" }}
                              disabled={reopenBusy !== null}
                              onClick={() => void setHandInOpen(s.id, true)}
                              title={`Let ${s.name} hand this in after the deadline`}
                            >
                              {reopenBusy === s.id ? "Reopening…" : "Reopen"}
                            </button>
                          ) : null
                      : undefined
                  }
                />
              </>
            ) : null}

            {/* Every reopen that stands, wherever its student now is. One who
                has handed in has left Not submitted, but can still replace
                that work until the reopen is closed — so this is where it is
                closed. */}
            {reopenedList.length ? (
              <>
                <PileHeader
                  label="Reopened"
                  dot="var(--fv-amber)"
                  count={reopenedList.length}
                  open={reopenedOpen}
                  onToggle={() => setReopenedOpen((v) => !v)}
                />
                {reopenedOpen ? (
                  <>
                    <div className="fv-sub" style={{ padding: "2px 8px 6px", lineHeight: 1.5 }}>
                      Can hand in past the deadline until closed. What they hand in shows as Late.
                    </div>
                    <PersonRows
                      list={reopenedList}
                      empty=""
                      action={
                        canReopen
                          ? (s) => (
                              <>
                                {uploadOf(s.id) ? (
                                  <button
                                    type="button"
                                    className="fv-btn outline sm"
                                    style={{ height: 26, padding: "0 9px" }}
                                    disabled={reopenBusy !== null || grading !== null}
                                    onClick={() => void gradeUpload(s.id)}
                                    title={`Hand in the PDF ${s.name} uploaded and open it to grade`}
                                  >
                                    {grading === s.id ? "Opening…" : "Grade"}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="fv-btn ghost sm"
                                  style={{ height: 26, padding: "0 9px" }}
                                  disabled={reopenBusy !== null || grading !== null}
                                  onClick={() => void setHandInOpen(s.id, false)}
                                  title={`Stop ${s.name} handing in or changing this`}
                                >
                                  {reopenBusy === s.id ? "Closing…" : "Close"}
                                </button>
                              </>
                            )
                          : undefined
                      }
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {reopenError ? (
              <div
                role="alert"
                className="fv-sub"
                style={{ padding: "8px 8px 0", color: "var(--fv-amber)", lineHeight: 1.5 }}
              >
                {reopenError}
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
              onClick={() => onGrade()}
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
