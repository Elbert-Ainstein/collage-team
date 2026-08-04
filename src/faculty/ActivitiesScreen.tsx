"use client";

// Activities — the row view and the gradebook, behind one pinned toggle.
//
// Both views read data.stats. Nothing here counts a submission or a mark: the
// week summary, the row caption and the column header all print numbers that
// came out of statFor, which is the only place they are worked out.

import { Fragment, type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { createActivity, updateActivity } from "@/checkins/data";
import { isOpenToStudents } from "@/checkins/studentData";
import { fmtInstant, fromLocalInput, toLocalInput } from "./ActivityDetail";
import {
  addWeek,
  backfillWeeks,
  ensureCheckIn,
  setLiveWeek,
  setQuestionShape,
  setWeekDates,
  shapeFor,
} from "./facultyData";
import {
  SCOPE_LABEL,
  SCOPE_OF,
  TYPE_ACCENT,
  TYPE_LABEL,
  type Activity,
  type ActivityType,
  type CheckIn,
  type CheckInResult,
  type ResultStatus,
  type Student,
  type TeamWithMembers,
} from "@/checkins/types";
import {
  cellFor,
  groupByWeek,
  pointsLabel,
  studentPercents,
  teamPercent,
  toGradeLabel,
  type Cell,
  type CellState,
  type WeekGroup,
} from "./model";
import { FAvatar, FIcon } from "./icons";
import type { FacultyData } from "./FacultyApp";

const TYPES: ActivityType[] = ["challenge", "combo", "amplify", "skills"];

const GLYPH: Record<CellState, string> = {
  graded: "",
  turned_in: "●",
  late: "⏱",
  complete: "✓",
  not_started: "—",
  excused: "–",
  discussing: "●",
  na: "·",
};

const STATE_LABEL: Record<CellState, string> = {
  graded: "Graded",
  turned_in: "Turned in · not graded",
  late: "Late",
  complete: "Complete",
  not_started: "Not started",
  excused: "Excused",
  discussing: "Discussing",
  na: "Does not apply",
};

/**
 * The cell key's swatches repeat the cell colours inline rather than reusing
 * `.fv-cell`: the key box is 24x20 and a cell is a full-width 36px row, so the
 * class would bring the wrong geometry with it.
 */
const KEY_INK: Partial<Record<CellState, CSSProperties>> = {
  not_started: { color: "var(--fv-muted)" },
  turned_in: { color: "var(--fv-navy-700)", background: "var(--fv-sky-100)" },
  late: { color: "var(--fv-amber)", background: "var(--fv-cream-400)" },
  graded: { color: "var(--fv-navy)" },
  complete: { color: "var(--fv-emerald)", background: "rgba(5, 150, 105, 0.1)" },
  excused: { color: "var(--fv-muted)" },
};

const KEY_ORDER: CellState[] = ["not_started", "turned_in", "late", "graded", "complete", "excused"];

// The design draws a hairline down the inside of each frozen column; the
// stylesheet only owns the sticking itself.
const STICKY_L: CSSProperties = { borderRight: "1px solid var(--fv-neutral-200)" };
const STICKY_R: CSSProperties = { borderLeft: "1px solid var(--fv-neutral-200)", padding: "0 12px" };

const HANDED_IN: ResultStatus[] = ["submitted", "needs_review", "scored"];

function glyphFor(cell: Cell): string {
  if (cell.state !== "graded") return GLYPH[cell.state];
  return cell.score == null ? "—" : String(cell.score);
}

/**
 * How this activity reads to the class right now, for the markers both views
 * carry: null when students can already see it, otherwise the instant it opens.
 *
 * The same rule the student app applies, so nothing here can drift from what is
 * actually on their lists. The empty string covers an opens_at that will not
 * format — still hidden, just with no date to print.
 */
function hiddenUntil(a: Activity): string | null {
  if (isOpenToStudents(a)) return null;
  return (a.opens_at ? fmtInstant(a.opens_at) : null) ?? "";
}

/**
 * How many of a team have handed this week's individual work in — the "4/4 in"
 * tally. Team work is excluded on purpose: the tally is about the people.
 */
function membersIn(
  team: TeamWithMembers,
  weekActivities: Activity[],
  checkIns: CheckIn[],
  results: CheckInResult[],
): number {
  const ids = new Set(
    checkIns
      .filter((c) => c.kind === "individual" && weekActivities.some((a) => a.id === c.activity_id))
      .map((c) => c.id),
  );
  if (!ids.size) return team.members.length;
  return team.members.filter((m) =>
    results.some((r) => ids.has(r.check_in_id) && r.student_id === m.id && HANDED_IN.includes(r.status)),
  ).length;
}

export function ActivitiesScreen(props: {
  data: FacultyData;
  view: "rows" | "columns";
  onView: (v: "rows" | "columns") => void;
  onOpen: (activityId: string) => void;
  onChanged: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const { data, view, onView, onOpen, onChanged, onError } = props;

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ActivityType>("combo");
  const [week, setWeek] = useState<number | null>(null);
  // Defaulted to now on every open, so creating an activity says out loud when
  // the class gets it instead of publishing one by omission. Pushing it forward
  // is what schedules it.
  const [opens, setOpens] = useState("");
  const [busy, setBusy] = useState(false);
  // The week the last "New week" press created, so the press has something to
  // point at. Cleared once that week holds anything, or on dismiss.
  const [newWeek, setNewWeek] = useState<number | null>(null);

  // The banner belongs to the course it was raised on. This screen is not
  // remounted when the sidebar switches courses, so without this it would
  // re-resolve against the new course's weeks and announce one this session
  // never created.
  useEffect(() => {
    setNewWeek(null);
  }, [data.course.id]);


  // One grouping feeds both views, so a week cannot be ordered one way in the
  // list and another way across the gradebook's header.
  const groups = useMemo(
    () => groupByWeek(data.activities, data.weeks, data.stats),
    [data.activities, data.weeks, data.stats],
  );

  // Every week an activity can be filed under, newest first — groups already
  // carry the union of course_weeks and the weeks activities name.
  const weekNumbers = useMemo(
    () => groups.flatMap((g) => (g.week == null ? [] : [g.week])),
    [groups],
  );

  const percents = useMemo(
    () => studentPercents(data.activities, data.roster, data.checkIns, data.results),
    [data.activities, data.roster, data.checkIns, data.results],
  );

  const columns = useMemo(() => groups.flatMap((g) => g.activities), [groups]);

  // The tally follows the week that is running; with none set, the newest week
  // that has any activities is the one people are working on. An empty week is
  // skipped in that fallback — nobody is working on a week with nothing in it.
  const tallyWeek = useMemo(() => {
    const live = data.course.live_week;
    const target =
      live ?? groups.find((g) => g.week != null && g.activities.length > 0)?.week ?? null;
    return target == null ? [] : data.activities.filter((a) => a.week === target && SCOPE_OF[a.type] !== "team");
  }, [data.course.live_week, data.activities, groups]);

  const unassigned = useMemo(() => {
    const seen = new Set(data.teams.flatMap((t) => t.members.map((m) => m.id)));
    return data.roster.filter((s) => !seen.has(s.id));
  }, [data.teams, data.roster]);

  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await job();
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  // Scheduling follows the check-in permission rather than authoring, the same
  // way posting check-ins and setting the live week do.
  const canSchedule = data.can.runCheckIns;

  // Only worth a line when the instructor has actually pushed the field forward
  // — the ordinary case is "now", and saying so would be noise.
  const opensIso = fromLocalInput(opens);
  const scheduledFor =
    opensIso != null && Date.parse(opensIso) > Date.now() ? fmtInstant(opensIso) : null;

  // `at` is the week the instructor asked to fill; without one, the newest.
  const openForm = (at?: number) => {
    setWeek(at ?? weekNumbers[0] ?? null);
    // now -> local wall clock, reseeded per open so a form left closed for an
    // hour does not come back offering an opening time in the past.
    setOpens(toLocalInput(new Date().toISOString()));
    setCreating(true);
  };

  const saveDates = (id: string, label: string | null) =>
    void run(async () => {
      await setWeekDates(id, label);
    });

  // live_week is one column on the course, so marking a week live is inherently
  // exclusive — the previous one stops being live in the same write.
  const makeLive = (target: number | null) =>
    void run(async () => {
      await setLiveWeek(data.course.id, target);
    });

  // The notice stands down on its own once the week it announced holds
  // something, so adding the first activity is what closes it.
  const announced = useMemo(() => {
    if (newWeek == null) return null;
    const g = groups.find((x) => x.week === newWeek);
    return g && g.activities.length === 0 ? newWeek : null;
  }, [newWeek, groups]);

  const submitNew = () =>
    void run(async () => {
      const name = title.trim();
      if (!name || week == null) return;

      // opens_at goes on the INSERT, not a follow-up patch. The column default
      // is NULL and NULL means visible, so an activity created without it sits
      // in front of the whole class for the length of a round trip — and stays
      // there for good if that second write fails. Local wall clock -> instant.
      const created = await createActivity({
        courseId: data.course.id,
        week,
        title: name,
        opensAt: fromLocalInput(opens),
      });
      // `type` still needs a second write — it picks the accent, the scope and
      // therefore the question shape, and createActivity does not carry it. That
      // one is safe to follow up: a wrong type is visible and fixable, whereas a
      // wrongly-visible draft is not recallable.
      await updateActivity(created.id, { type });

      const shape = shapeFor(type);
      await setQuestionShape(created.id, shape.count, shape.per);

      // ensureCheckIn writes max_points off the activity it is handed, so give
      // it the new shape rather than the defaults the insert came back with.
      const withShape = {
        ...created,
        type,
        question_count: shape.count,
        points_per_question: shape.per,
      };
      const scope = SCOPE_OF[type];
      if (scope !== "team") await ensureCheckIn(withShape, "individual", data.checkIns);
      if (scope !== "indiv") await ensureCheckIn(withShape, "team", data.checkIns);

      setCreating(false);
      setTitle("");
    });

  return (
    <div className="fv-panel">
      <div className="fv-head">
        <div>
          <h1 className="fv-h1">Activities</h1>
          <div className="fv-sub">Every activity in the course, newest week first.</div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="fv-headbtns">
          {/* Authoring is the instructor's. A teaching fellow sees the same
              lists but no way to change what is on them. */}
          {data.can.author ? (
            <>
              <button
                type="button"
                className="fv-btn outline sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    // Weeks that exist only because an activity names them have
                    // no course_weeks row, so they cannot be dated or set live
                    // and their controls simply are not there. Repair them on
                    // the way past: this is the moment weeks are being thought
                    // about, and it is what makes the numbering below correct.
                    await backfillWeeks(data.course.id);
                    const created = await addWeek(data.course.id);
                    // Without this the press had no visible result at all and
                    // repeat presses piled up weeks nobody could see.
                    setNewWeek(created.week);
                  })
                }
              >
                <FIcon name="add" size={15} />
                New week
              </button>
              <button
                type="button"
                className="fv-btn primary sm"
                disabled={busy}
                onClick={() => (creating ? setCreating(false) : openForm())}
                aria-expanded={creating}
              >
                <FIcon name="add" size={15} />
                Activity
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Outside the scroller on purpose: the week it announces may be far down
          the list, and a press has to answer wherever the instructor is. */}
      {announced != null ? (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            flex: "none",
            gap: 10,
            padding: "8px 12px",
            marginBottom: 12,
            border: "1px solid var(--fv-neutral-200)",
            background: "var(--fv-cream-100)",
            borderRadius: "var(--fv-r-md)",
            fontSize: "var(--fv-xs)",
            color: "var(--fv-muted)",
          }}
        >
          <span style={{ flex: 1 }}>Week {announced} added. Nothing in it yet.</span>
          {data.can.author ? (
            <button
              type="button"
              className="fv-btn sm"
              style={{ height: 24, padding: "0 10px", flex: "none" }}
              onClick={() => openForm(announced)}
            >
              Add the first activity
            </button>
          ) : null}
          <button
            type="button"
            className="fv-iconbtn"
            style={{ width: 22, height: 22, flex: "none" }}
            aria-label="Dismiss"
            onClick={() => setNewWeek(null)}
          >
            <FIcon name="close" size={14} />
          </button>
        </div>
      ) : null}

      <div className="fv-scroll">
        {creating ? (
          <form
            className="fv-card"
            style={{ padding: 14, marginBottom: 18, display: "flex", flexWrap: "wrap", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              submitNew();
            }}
          >
            <label style={{ flex: "2 1 220px", minWidth: 0 }}>
              <span className="fv-eyebrow">Title</span>
              <input
                className="fv-in"
                style={{ marginTop: 4 }}
                value={title}
                autoFocus
                placeholder="What are they working on?"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label style={{ flex: "1 1 140px", minWidth: 0 }}>
              <span className="fv-eyebrow">Type</span>
              <select
                className="fv-in"
                style={{ marginTop: 4 }}
                value={type}
                onChange={(e) => setType(e.target.value as ActivityType)}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]} · {SCOPE_LABEL[SCOPE_OF[t]]}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: "0 1 120px", minWidth: 0 }}>
              <span className="fv-eyebrow">Week</span>
              <select
                className="fv-in"
                style={{ marginTop: 4 }}
                value={week ?? ""}
                onChange={(e) => setWeek(e.target.value === "" ? null : Number(e.target.value))}
              >
                {weekNumbers.map((n) => (
                  <option key={n} value={n}>
                    Week {n}
                  </option>
                ))}
              </select>
            </label>
            {canSchedule ? (
              <label style={{ flex: "1 1 190px", minWidth: 0 }}>
                <span className="fv-eyebrow">Visible to students from</span>
                <input
                  type="datetime-local"
                  className="fv-in"
                  style={{ marginTop: 4 }}
                  value={opens}
                  onChange={(e) => setOpens(e.target.value)}
                />
              </label>
            ) : null}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flex: "none" }}>
              <button
                type="submit"
                className="fv-btn primary sm"
                disabled={busy || !title.trim() || week == null}
              >
                Create
              </button>
              <button type="button" className="fv-btn ghost sm" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
            {scheduledFor ? (
              <div
                className="fv-sub"
                style={{ flexBasis: "100%", color: "var(--fv-amber)" }}
                role="status"
              >
                Hidden from students until {scheduledFor}. You can change that afterwards.
              </div>
            ) : null}
            {weekNumbers.length === 0 ? (
              <div className="fv-sub" style={{ flexBasis: "100%" }}>
                Add a week first — every activity belongs to one.
              </div>
            ) : null}
          </form>
        ) : null}

        {/* Weeks, not activities: a course with weeks and nothing in them has
            something to show, and used to show this line instead. */}
        {groups.length === 0 ? (
          <div className="fv-sub">
            {data.can.author
              ? "No weeks yet. Add a week, then an activity."
              : "Nothing here yet."}
          </div>
        ) : view === "rows" ? (
          <RowView
            groups={groups}
            data={data}
            busy={busy}
            highlight={announced}
            onOpen={onOpen}
            onAddTo={openForm}
            onDates={saveDates}
            onLive={makeLive}
          />
        ) : (
          <ColumnView
            data={data}
            groups={groups}
            columns={columns}
            percents={percents}
            tallyWeek={tallyWeek}
            unassigned={unassigned}
            onOpen={onOpen}
          />
        )}
      </div>

      <div className="fv-toggle">
        <div className="fv-seg" role="group" aria-label="Activity layout">
          <button
            type="button"
            className={view === "rows" ? "on" : ""}
            aria-pressed={view === "rows"}
            onClick={() => onView("rows")}
          >
            Rows
          </button>
          <button
            type="button"
            className={view === "columns" ? "on" : ""}
            aria-pressed={view === "columns"}
            onClick={() => onView("columns")}
          >
            Columns
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ row view

/**
 * The dates label and the live-week switch, both editing in place.
 *
 * The inline idiom is the roster's: type, Enter to save, Escape to abandon —
 * this app has no modal for a one-field change, and window.confirm is
 * suppressed here anyway.
 */
function WeekHead({
  group,
  canEdit,
  canGoLive,
  isLive,
  busy,
  onDates,
  onLive,
}: {
  group: WeekGroup;
  canEdit: boolean;
  /** Marking a week live follows the check-in permission, not authoring. */
  canGoLive: boolean;
  isLive: boolean;
  busy: boolean;
  onDates: (id: string, label: string | null) => void;
  onLive: (week: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Only a course_weeks row can hold dates. A week that exists solely because
  // an activity names it has nothing to write to, so it reads rather than edits.
  const editable = canEdit && group.id != null;

  const open = () => {
    setDraft(group.dates ?? "");
    setEditing(true);
  };

  const commit = () => {
    if (!group.id) return;
    const next = draft.trim() || null;
    setEditing(false);
    if (next !== (group.dates ?? null)) onDates(group.id, next);
  };

  return (
    <div className="fv-weekhead">
      {isLive ? (
        <span
          className="fv-dot"
          style={{ background: "var(--fv-emerald)" }}
          aria-hidden="true"
        />
      ) : null}
      <span className="fv-weekname">{group.label}</span>

      {editing ? (
        <>
          <input
            className="fv-in"
            style={{
              width: 128,
              flex: "none",
              height: 24,
              padding: "0 8px",
              fontSize: "var(--fv-2xs)",
            }}
            value={draft}
            autoFocus
            placeholder="Feb 17-21"
            aria-label={`Dates for ${group.label}`}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button
            type="button"
            className="fv-btn sm"
            style={{ height: 22, padding: "0 8px", flex: "none" }}
            disabled={busy}
            onClick={commit}
          >
            Save
          </button>
        </>
      ) : editable ? (
        <button
          type="button"
          className="fv-btn ghost sm"
          style={{
            height: 22,
            padding: "0 6px",
            flex: "none",
            fontSize: "var(--fv-2xs)",
            fontWeight: 400,
            color: group.dates ? "var(--fv-muted)" : "var(--fv-neutral-400)",
          }}
          title={`Set the dates for ${group.label}`}
          onClick={open}
        >
          {group.dates ?? "Add dates"}
        </button>
      ) : group.dates ? (
        <span className="fv-sub">{group.dates}</span>
      ) : null}

      <span className="fv-rule" />

      {group.week == null ? null : canGoLive ? (
        <button
          type="button"
          className="fv-btn ghost sm"
          style={{
            height: 22,
            padding: "0 8px",
            flex: "none",
            fontSize: "var(--fv-2xs)",
            fontWeight: isLive ? 600 : 400,
            color: isLive ? "var(--fv-emerald)" : "var(--fv-neutral-400)",
            background: isLive ? "rgba(5, 150, 105, 0.1)" : undefined,
          }}
          aria-pressed={isLive}
          disabled={busy}
          title={
            isLive
              ? "This is the week in progress — team cells pulse while a discussion runs, and earlier weeks read as late. Click to clear it."
              : `Mark ${group.label} as the week in progress`
          }
          onClick={() => onLive(isLive ? null : group.week)}
        >
          {isLive ? "Live" : "Make live"}
        </button>
      ) : isLive ? (
        <span className="fv-badge" style={{ flex: "none", color: "var(--fv-emerald)" }}>
          Live
        </span>
      ) : null}

      <span className="fv-weeksum">{toGradeLabel(group.waiting)}</span>
    </div>
  );
}

function RowView({
  groups,
  data,
  busy,
  highlight,
  onOpen,
  onAddTo,
  onDates,
  onLive,
}: {
  groups: WeekGroup[];
  data: FacultyData;
  busy: boolean;
  /** The week a "New week" press just created, so it can be scrolled to. */
  highlight: number | null;
  onOpen: (id: string) => void;
  onAddTo: (week: number) => void;
  onDates: (id: string, label: string | null) => void;
  onLive: (week: number | null) => void;
}) {
  const flash = useCallback(
    (el: HTMLElement | null) => {
      if (el && highlight != null) el.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [highlight],
  );

  return (
    <>
      <div className="fv-weeks">
        {groups.map((g) => {
          // Held as a local so the null check survives into the click handler.
          const weekNo = g.week;
          return (
          <section key={g.label} ref={weekNo === highlight ? flash : undefined}>
            <WeekHead
              group={g}
              canEdit={data.can.author}
              canGoLive={data.can.runCheckIns}
              isLive={g.week != null && g.week === data.course.live_week}
              busy={busy}
              onDates={onDates}
              onLive={onLive}
            />
            {/* A heading with nothing under it reads as another kind of broken,
                so an empty week says it is empty and offers the way out of it. */}
            {g.activities.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 16px",
                  border: "1px dashed",
                  borderColor:
                    weekNo === highlight ? "var(--fv-navy-700)" : "var(--fv-neutral-200)",
                  borderRadius: "var(--fv-r-lg)",
                  fontSize: "var(--fv-xs)",
                  color: "var(--fv-muted)",
                }}
              >
                <span style={{ flex: 1 }}>Nothing in this week yet.</span>
                {data.can.author && weekNo != null ? (
                  <button
                    type="button"
                    className="fv-btn outline sm"
                    style={{ height: 24, padding: "0 10px", flex: "none" }}
                    onClick={() => onAddTo(weekNo)}
                  >
                    <FIcon name="add" size={14} />
                    Add the first activity
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="fv-rows">
              {g.activities.map((a) => {
                const stat = data.stats.get(a.id);
                const accent = TYPE_ACCENT[a.type];
                const until = hiddenUntil(a);
                const pct = (n: number) =>
                  stat && stat.total > 0 ? `${(n / stat.total) * 100}%` : "0%";
                return (
                  <button
                    key={a.id}
                    type="button"
                    className="fv-row"
                    style={{ borderLeftColor: accent }}
                    onClick={() => onOpen(a.id)}
                  >
                    <span className="fv-type" style={{ color: accent }}>
                      {TYPE_LABEL[a.type]}
                    </span>
                    <span className="fv-title">{a.title}</span>
                    <span className="fv-badge">{SCOPE_LABEL[SCOPE_OF[a.type]]}</span>
                    {/* Without this the list looks the same whether the class
                        can see the work or not. Quiet, but on the row itself. */}
                    {until == null ? null : (
                      <span className="fv-badge" style={{ color: "var(--fv-amber)" }}>
                        {until ? `Hidden until ${until}` : "Hidden"}
                      </span>
                    )}
                    {stat ? (
                      <span className="fv-prog">
                        <span className="fv-track">
                          <i style={{ width: pct(stat.graded), background: "var(--fv-emerald)" }} />
                          <i style={{ width: pct(stat.waiting), background: "var(--fv-navy-700)" }} />
                        </span>
                        <span className="fv-progcap">{stat.caption}</span>
                      </span>
                    ) : null}
                    <span style={{ display: "flex", color: "var(--fv-neutral-400)", flex: "none" }}>
                      <FIcon name="chevronRight" size={18} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>
      <div className="fv-more" aria-hidden="true">
        …
      </div>
    </>
  );
}

// --------------------------------------------------------------- column view

function ColumnView({
  data,
  groups,
  columns,
  percents,
  tallyWeek,
  unassigned,
  onOpen,
}: {
  data: FacultyData;
  groups: WeekGroup[];
  columns: Activity[];
  percents: Map<string, number | null>;
  tallyWeek: Activity[];
  unassigned: Student[];
  onOpen: (id: string) => void;
}) {
  const live = data.course.live_week;

  // An empty week has no columns to span, and colSpan={0} means "to the end of
  // the row" — one empty week would swallow the rest of the header.
  const spanning = groups.filter((g) => g.activities.length > 0);
  // A week with nothing in it contributes no columns, so it cannot be a colspan
  // group — colSpan={0} would swallow the rest of the header row. Name them
  // under the table instead, or an empty week is invisible here exactly as it
  // was before.
  const emptyWeeks = groups.filter((g) => g.week != null && g.activities.length === 0);

  const cells = (subject: { kind: "student" | "team"; id: string }, who: string) =>
    columns.map((a) => {
      const cell = cellFor(a, subject, data.checkIns, data.results, live);
      const label = `${who} · ${a.title} · ${STATE_LABEL[cell.state]}`;
      return (
        <td key={a.id}>
          <button
            type="button"
            className={`fv-cell ${cell.state}`}
            disabled={cell.state === "na"}
            aria-label={label}
            title={label}
            onClick={() => onOpen(a.id)}
          >
            {glyphFor(cell)}
          </button>
        </td>
      );
    });

  // Reachable now that a course can hold weeks and no activities; a gradebook
  // with no columns is a grid of nothing.
  if (!columns.length) {
    return (
      <div className="fv-sub">
        No activities yet — the gradebook fills in as you add them to a week.
      </div>
    );
  }

  return (
    <div>
      <div className="fv-key">
        <span className="fv-eyebrow">Cell key</span>
        {KEY_ORDER.map((s) => (
          <span key={s} className="fv-keyitem">
            <span className="fv-keyglyph" style={KEY_INK[s]} aria-hidden="true">
              {s === "graded" ? "8" : GLYPH[s]}
            </span>
            {STATE_LABEL[s].toLowerCase()}
          </span>
        ))}
      </div>

      <div className="fv-tblwrap">
        <table className="fv-tbl">
          <thead>
            <tr>
              <th className="fv-sticky-l fv-eyebrow" style={STICKY_L} scope="col">
                Team / student
              </th>
              {spanning.map((g) => (
                <th key={g.label} colSpan={g.activities.length} scope="colgroup">
                  {g.week != null && g.week === live ? (
                    <span
                      className="fv-dot"
                      style={{
                        background: "var(--fv-emerald)",
                        display: "inline-block",
                        marginRight: 6,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="fv-weekname" style={{ fontSize: "var(--fv-sm)" }}>
                    {g.label}
                  </span>
                  {g.dates ? (
                    <span className="fv-sub" style={{ fontSize: "var(--fv-2xs)", marginLeft: 8 }}>
                      {g.dates}
                    </span>
                  ) : null}
                </th>
              ))}
              <th className="fv-sticky-r fv-eyebrow" style={STICKY_R} scope="col">
                Total
              </th>
            </tr>
            <tr>
              <th className="fv-sticky-l" style={STICKY_L} />
              {columns.map((a) => {
                const stat = data.stats.get(a.id);
                const scope = SCOPE_OF[a.type];
                const meta =
                  scope === "team"
                    ? "Team"
                    : scope === "both"
                      ? "Ind + team"
                      : `Ind · ${pointsLabel(a)}`;
                // The header is ~116px wide, so the date goes in the tooltip and
                // only the word stays on screen.
                const until = hiddenUntil(a);
                return (
                  <th
                    key={a.id}
                    className="act"
                    scope="col"
                    style={{ borderTopColor: TYPE_ACCENT[a.type] }}
                    title={
                      until == null
                        ? a.title
                        : `${a.title} — hidden from students${until ? ` until ${until}` : ""}`
                    }
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        className="fv-dot"
                        style={{ width: 8, height: 8, background: TYPE_ACCENT[a.type] }}
                      />
                      <span
                        style={{
                          fontSize: "var(--fv-xs)",
                          fontWeight: 600,
                          color: "var(--fv-navy)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {TYPE_LABEL[a.type]}
                        {a.week == null ? "" : ` ${a.week}`}
                      </span>
                    </span>
                    <span
                      className="fv-sub"
                      style={{ display: "block", fontSize: "var(--fv-2xs)", marginTop: 3, whiteSpace: "nowrap" }}
                    >
                      {meta}
                    </span>
                    <span
                      className="fv-sub fv-num"
                      style={{ display: "block", fontSize: "var(--fv-2xs)", marginTop: 2, whiteSpace: "nowrap" }}
                    >
                      {stat ? `${stat.graded}/${stat.total} ${stat.verb}` : ""}
                    </span>
                    {until == null ? null : (
                      <span
                        style={{
                          display: "block",
                          fontSize: "var(--fv-2xs)",
                          marginTop: 2,
                          whiteSpace: "nowrap",
                          color: "var(--fv-amber)",
                        }}
                      >
                        Hidden
                      </span>
                    )}
                  </th>
                );
              })}
              <th className="fv-sticky-r" style={STICKY_R} />
            </tr>
          </thead>
          <tbody>
            {data.teams.map((t) => {
              const inCount = membersIn(t, tallyWeek, data.checkIns, data.results);
              const short = inCount < t.members.length;
              const pct = teamPercent(
                t.members.map((m) => m.id),
                percents,
              );
              return (
                <Fragment key={t.id}>
                  <tr className="fv-trteam">
                    <th scope="row" className="fv-sticky-l" style={STICKY_L}>
                      <span className="fv-subject" style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>
                        <span style={{ display: "flex", color: "var(--fv-muted)", flex: "none" }}>
                          <FIcon name="groups" size={16} />
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>{t.name}</span>
                        {tallyWeek.length ? (
                          <span
                            className="fv-num"
                            style={{
                              fontSize: "var(--fv-2xs)",
                              fontWeight: 400,
                              whiteSpace: "nowrap",
                              color: short ? "var(--fv-amber)" : "var(--fv-muted)",
                            }}
                          >
                            {inCount}/{t.members.length} in
                          </span>
                        ) : null}
                      </span>
                    </th>
                    {cells({ kind: "team", id: t.id }, t.name)}
                    <td className="fv-sticky-r" style={{ ...STICKY_R, fontWeight: 600 }}>
                      {pct == null ? "—" : `${pct}%`}
                    </td>
                  </tr>
                  {t.members.map((m) => (
                    <StudentRow
                      key={m.id}
                      student={m}
                      percent={percents.get(m.id) ?? null}
                      cells={cells}
                    />
                  ))}
                </Fragment>
              );
            })}

            {unassigned.length ? (
              <>
                <tr className="fv-trteam">
                  <th scope="row" className="fv-sticky-l" style={STICKY_L}>
                    <span className="fv-subject" style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>
                      <span style={{ display: "flex", color: "var(--fv-muted)", flex: "none" }}>
                        <FIcon name="groups" size={16} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>No team</span>
                    </span>
                  </th>
                  {columns.map((a) => (
                    <td key={a.id} />
                  ))}
                  <td className="fv-sticky-r" style={STICKY_R} />
                </tr>
                {unassigned.map((s) => (
                  <StudentRow
                    key={s.id}
                    student={s}
                    percent={percents.get(s.id) ?? null}
                    cells={cells}
                  />
                ))}
              </>
            ) : null}
          </tbody>
        </table>
      </div>

      {emptyWeeks.length ? (
        <div className="fv-sub" style={{ marginTop: 10, lineHeight: 1.5 }}>
          {emptyWeeks.map((g) => g.label).join(", ")}{" "}
          {emptyWeeks.length === 1 ? "has" : "have"} no activities yet, so{" "}
          {emptyWeeks.length === 1 ? "it does" : "they do"} not appear above. Add one from the
          Rows view.
        </div>
      ) : null}
    </div>
  );
}

function StudentRow({
  student,
  percent,
  cells,
}: {
  student: Student;
  percent: number | null;
  cells: (subject: { kind: "student" | "team"; id: string }, who: string) => JSX.Element[];
}) {
  return (
    <tr className="fv-trstu">
      <th scope="row" className="fv-sticky-l" style={STICKY_L}>
        <span className="fv-subject stu" style={{ fontSize: "var(--fv-xs)" }}>
          <FAvatar name={student.name} tint={student.avatar_tint} size={20} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {student.name}
          </span>
        </span>
      </th>
      {cells({ kind: "student", id: student.id }, student.name)}
      <td className="fv-sticky-r" style={STICKY_R}>
        {percent == null ? "—" : `${percent}%`}
      </td>
    </tr>
  );
}
