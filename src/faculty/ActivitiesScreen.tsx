"use client";

// Activities — the row view and the gradebook, behind one pinned toggle.
//
// Both views read data.stats. Nothing here counts a submission or a mark: the
// week summary, the row caption and the column header all print numbers that
// came out of statFor, which is the only place they are worked out.

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import { createActivity, updateActivity } from "@/checkins/data";
import { addWeek, ensureCheckIn, setQuestionShape, shapeFor } from "./facultyData";
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
  const [busy, setBusy] = useState(false);

  const weekNumbers = useMemo(
    () => data.weeks.map((w) => w.week).sort((a, b) => b - a),
    [data.weeks],
  );

  const dates = useMemo(
    () => new Map(data.weeks.map((w) => [w.week, w.dates_label] as const)),
    [data.weeks],
  );

  // One grouping feeds both views, so a week cannot be ordered one way in the
  // list and another way across the gradebook's header.
  const groups = useMemo(
    () => groupByWeek(data.activities, data.stats, dates),
    [data.activities, data.stats, dates],
  );

  const percents = useMemo(
    () => studentPercents(data.activities, data.roster, data.checkIns, data.results),
    [data.activities, data.roster, data.checkIns, data.results],
  );

  const columns = useMemo(() => groups.flatMap((g) => g.activities), [groups]);

  // The tally follows the week that is running; with none set, the newest week
  // that has any activities is the one people are working on.
  const tallyWeek = useMemo(() => {
    const live = data.course.live_week;
    const target = live ?? groups.find((g) => g.week != null)?.week ?? null;
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

  const openForm = () => {
    setWeek(weekNumbers[0] ?? null);
    setCreating(true);
  };

  const submitNew = () =>
    void run(async () => {
      const name = title.trim();
      if (!name || week == null) return;

      const created = await createActivity({ courseId: data.course.id, week, title: name });
      // createActivity has no `type` field of its own, and type is what picks
      // the accent, the scope and therefore the question shape.
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
          <button
            type="button"
            className="fv-btn outline sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await addWeek(data.course.id);
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
        </div>
      </div>

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
            {weekNumbers.length === 0 ? (
              <div className="fv-sub" style={{ flexBasis: "100%" }}>
                Add a week first — every activity belongs to one.
              </div>
            ) : null}
          </form>
        ) : null}

        {data.activities.length === 0 ? (
          <div className="fv-sub">No activities yet. Add a week, then an activity.</div>
        ) : view === "rows" ? (
          <RowView groups={groups} data={data} onOpen={onOpen} />
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

function RowView({
  groups,
  data,
  onOpen,
}: {
  groups: ReturnType<typeof groupByWeek>;
  data: FacultyData;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="fv-weeks">
        {groups.map((g) => (
          <section key={g.label}>
            <div className="fv-weekhead">
              <span className="fv-weekname">{g.label}</span>
              {g.dates ? <span className="fv-sub">{g.dates}</span> : null}
              <span className="fv-rule" />
              <span className="fv-weeksum">{toGradeLabel(g.waiting)}</span>
            </div>
            <div className="fv-rows">
              {g.activities.map((a) => {
                const stat = data.stats.get(a.id);
                const accent = TYPE_ACCENT[a.type];
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
        ))}
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
  groups: ReturnType<typeof groupByWeek>;
  columns: Activity[];
  percents: Map<string, number | null>;
  tallyWeek: Activity[];
  unassigned: Student[];
  onOpen: (id: string) => void;
}) {
  const live = data.course.live_week;

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
              {groups.map((g) => (
                <th key={g.label} colSpan={g.activities.length} scope="colgroup">
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
                return (
                  <th
                    key={a.id}
                    className="act"
                    scope="col"
                    style={{ borderTopColor: TYPE_ACCENT[a.type] }}
                    title={a.title}
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
