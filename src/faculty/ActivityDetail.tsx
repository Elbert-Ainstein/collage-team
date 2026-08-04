"use client";

// Activity detail: the full-screen view reached by clicking a row on Activities.
//
// Left two-thirds is what the activity IS, right third is who has handed it in.
// Everything on the right is keyed off SCOPE, so a team activity lists teams and
// counts out of the number of teams — type only picks the label and the accent.

import { useMemo, useState } from "react";
import { deleteActivity, tintFor, updateActivity } from "@/checkins/data";
import {
  IS_COMPLETION,
  SCOPE_LABEL,
  SCOPE_OF,
  TYPE_ACCENT,
  TYPE_LABEL,
  type Activity,
  type ActivityType,
  type CheckInResult,
} from "@/checkins/types";
import { ensureCheckIn, setQuestionShape } from "./facultyData";
import { pointsLabel, pointsTotal, questionShape, statFor } from "./model";
import { FAvatar, FIcon } from "./icons";
import type { FacultyData } from "./FacultyApp";

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

/** The due line carries the date too — it is read out of context of a week. */
function fmtDue(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}, ${fmtTime(d)}`;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The blurb shown when an activity carries no source text of its own.
 *
 * Per type rather than per scope: scope decides who is marked, but what a
 * faculty member needs here is how this kind of work is done and how it earns
 * its mark, and that is a property of the type.
 */
function describe(a: Activity): string {
  const t = a.title.trim().toLowerCase();
  switch (a.type) {
    case "combo":
      return `Tutorial and challenge questions on ${t}. Students work alone and hand in before the deadline; every question is scored against the grading criteria, and the marks add up to the activity total.`;
    case "skills":
      return `Timed skills check on ${t}. One attempt each, worked individually, then scored question by question against the grading criteria.`;
    case "challenge":
      return `Problem set on ${t}. Students work it alone first, then bring their answers to the team discussion — the individual half and the team half are marked for completion, not for points.`;
    case "amplify":
      return `Team activity on ${t}. Worked away from Collage and marked once per team for completion at the check-in, so there is one mark per team rather than one per student.`;
  }
}

/** Mirrors model.statFor's notion of "handed in", so the lists and the counts agree. */
const isIn = (r: CheckInResult) =>
  r.status === "submitted" || r.status === "needs_review" || r.status === "scored";

export function ActivityDetail(props: {
  data: FacultyData;
  activity: Activity;
  onBack: () => void;
  onCriteria: () => void;
  onGrade: () => void;
  onChanged: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const { data, activity, onBack, onCriteria, onGrade, onChanged, onError } = props;

  const accent = TYPE_ACCENT[activity.type];
  const scope = SCOPE_OF[activity.type];
  const shape = questionShape(activity);

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
  const dueLine = dueAt ? fmtDue(dueAt) : null;

  // Whitespace-only source text is not a description; the editor writes null for
  // it, but rows written elsewhere can still carry "".
  const blurb = activity.source_text?.trim() || describe(activity);

  const { submitted, missing } = useMemo(() => {
    // A `both` activity owns two check-ins; its individual half is the one the
    // stat counts, so the lists have to read the same half.
    const kind = scope === "team" ? "team" : "individual";
    const ids = new Set(
      data.checkIns.filter((c) => c.activity_id === activity.id && c.kind === kind).map((c) => c.id),
    );

    const stamps = new Map<string, string | null>();
    for (const r of data.results) {
      if (!ids.has(r.check_in_id) || !isIn(r)) continue;
      const subjectId = kind === "team" ? r.team_id : r.student_id;
      if (subjectId) stamps.set(subjectId, r.submitted_at);
    }

    const people: Subject[] =
      kind === "team"
        ? data.teams.map((t) => ({ id: t.id, name: t.name, tint: tintFor(t.name), stamp: null }))
        : data.roster.map((s) => ({ id: s.id, name: s.name, tint: s.avatar_tint, stamp: null }));

    const inList: Subject[] = [];
    const outList: Subject[] = [];
    for (const p of people) {
      if (stamps.has(p.id)) inList.push({ ...p, stamp: fmtStamp(stamps.get(p.id) ?? null) });
      else outList.push(p);
    }
    return { submitted: inList, missing: outList };
  }, [data.checkIns, data.results, data.roster, data.teams, activity.id, scope]);

  const [subOpen, setSubOpen] = useState(true);
  const [notOpen, setNotOpen] = useState(false);

  // ------------------------------------------------------------- the editor

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(activity.title);
  const [desc, setDesc] = useState(activity.source_text ?? "");
  const [due, setDue] = useState(() => toLocalInput(dueAt));
  const [count, setCount] = useState(String(shape.count));
  const [per, setPer] = useState(String(shape.per));
  const [kind, setKind] = useState<ActivityType>(activity.type);
  const [armedDelete, setArmedDelete] = useState(false);

  const openEditor = () => {
    setKind(activity.type);
    // Seed from the activity every time rather than once, so a refresh that
    // happened while the editor was closed is not overwritten by stale fields.
    setTitle(activity.title);
    setDesc(activity.source_text ?? "");
    setDue(toLocalInput(dueOf(activity)));
    setCount(String(shape.count));
    setPer(String(shape.per));
    setEditing(true);
  };

  // Clamped to what 0007's check constraint allows (count > 0, per >= 0), so a
  // typo comes back as a corrected number rather than a database error.
  const nextCount = Math.max(1, Math.round(Number(count) || 0));
  const nextPer = Math.max(0, Math.round(Number(per) || 0));
  const nextTotal = pointsTotal({ question_count: nextCount, points_per_question: nextPer });

  const save = async () => {
    setSaving(true);
    try {
      const patch: Partial<Activity> & WithDue = {
        title: title.trim() || activity.title,
        source_text: desc.trim() ? desc.trim() : null,
        due_at: fromLocalInput(due),
      };
      if (kind !== activity.type) {
        patch.type = kind;
      }
      await updateActivity(activity.id, patch);

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
      // The shape goes through facultyData rather than the same patch: it also
      // rewrites check_ins.max_points, which the student view renders directly.
      if (nextCount !== shape.count || nextPer !== shape.per) {
        await setQuestionShape(activity.id, nextCount, nextPer);
      }
      setEditing(false);
      onChanged();
    } catch (e) {
      onError(e);
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

      <div className="fv-split">
        <div className="fv-left23" style={{ paddingRight: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="fv-type" style={{ width: "auto", color: accent }}>
              {TYPE_LABEL[activity.type]}
            </span>
            <span className="fv-badge">{SCOPE_LABEL[scope]}</span>
          </div>

          <h1 className="fv-display" style={{ fontSize: 32, lineHeight: 1.14, marginTop: 8 }}>
            {activity.title}
          </h1>

          <div className="fv-sub" style={{ marginTop: 8 }}>
            {dueLine ? `Due ${dueLine}` : "No due date set"}
          </div>

          <p style={{ margin: "20px 0 0", fontSize: 16, lineHeight: 1.65, maxWidth: "64ch" }}>
            {blurb}
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
            <span className="fv-badge secondary">
              {shape.count} {shape.count === 1 ? "question" : "questions"}
            </span>
            <span className="fv-badge secondary">{pointsLabel(activity)}</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
            {data.can.author ? (
              <button
                type="button"
                className="fv-btn outline sm"
                aria-expanded={editing}
                onClick={() => (editing ? setEditing(false) : openEditor())}
              >
                <FIcon name="edit" size={15} />
                Edit activity
              </button>
            ) : null}
            <button type="button" className="fv-btn outline sm" onClick={onCriteria}>
              Grading criteria
            </button>
          </div>

          {editing ? (
            <div className="fv-card" style={{ marginTop: 16, padding: "14px 16px", maxWidth: "64ch" }}>
              {/* Type is what picks scope, and scope decides which check-ins
                  exist — so getting it wrong at creation used to be permanent.
                  Changing it here adds whichever half is now needed and leaves
                  the other in place, since dropping a check-in would cascade
                  away everything already submitted against it. */}
              <label className="fv-eyebrow" htmlFor="fv-ed-type" style={{ display: "block" }}>
                Type
              </label>
              <select
                id="fv-ed-type"
                className="fv-in"
                style={{ marginTop: 4 }}
                value={kind}
                onChange={(e) => setKind(e.target.value as ActivityType)}
              >
                {(Object.keys(TYPE_LABEL) as ActivityType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]} · {SCOPE_LABEL[SCOPE_OF[t]]}
                  </option>
                ))}
              </select>
              {kind !== activity.type ? (
                <div
                  style={{
                    marginTop: 6,
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

              <label
                className="fv-eyebrow"
                htmlFor="fv-ed-title"
                style={{ display: "block", marginTop: 12 }}
              >
                Title
              </label>
              <input
                id="fv-ed-title"
                className="fv-in"
                style={{ marginTop: 4 }}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              <label className="fv-eyebrow" htmlFor="fv-ed-desc" style={{ display: "block", marginTop: 12 }}>
                Description
              </label>
              <textarea
                id="fv-ed-desc"
                className="fv-ta"
                rows={3}
                style={{ marginTop: 4 }}
                placeholder="Leave empty to use the standard description for this type."
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />

              <label className="fv-eyebrow" htmlFor="fv-ed-due" style={{ display: "block", marginTop: 12 }}>
                Due
              </label>
              <input
                id="fv-ed-due"
                type="datetime-local"
                className="fv-in"
                style={{ marginTop: 4 }}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />

              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 12 }}>
                <div style={{ width: 92 }}>
                  <label className="fv-eyebrow" htmlFor="fv-ed-count" style={{ display: "block" }}>
                    Questions
                  </label>
                  <input
                    id="fv-ed-count"
                    className="fv-in fv-num"
                    style={{ marginTop: 4 }}
                    inputMode="numeric"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  />
                </div>
                <span className="fv-sub" style={{ paddingBottom: 9 }}>
                  ×
                </span>
                <div style={{ width: 92 }}>
                  <label className="fv-eyebrow" htmlFor="fv-ed-per" style={{ display: "block" }}>
                    Pts each
                  </label>
                  <input
                    id="fv-ed-per"
                    className="fv-in fv-num"
                    style={{ marginTop: 4 }}
                    inputMode="numeric"
                    value={per}
                    onChange={(e) => setPer(e.target.value)}
                  />
                </div>
                {/* The total is shown, never stored — this is the only place the
                    two numbers are visibly multiplied, which is the point. */}
                <span className="fv-sub fv-num" style={{ paddingBottom: 9 }} aria-live="polite">
                  = {nextTotal} pts
                  {IS_COMPLETION[activity.type] ? " (marked for completion)" : ""}
                </span>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="fv-btn primary sm"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="fv-btn ghost sm"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>

                <span style={{ flex: 1 }} />

                {/* Nothing could be deleted before, so a mistyped activity sat
                    in the gradebook forever. Two steps, and the second says what
                    goes with it — window.confirm is suppressed in this app. */}
                <button
                  type="button"
                  className="fv-btn ghost sm"
                  style={{ color: "var(--fv-destructive)" }}
                  disabled={saving}
                  onClick={() => {
                    if (!armedDelete) {
                      setArmedDelete(true);
                      return;
                    }
                    void (async () => {
                      setSaving(true);
                      try {
                        await deleteActivity(activity.id);
                        onChanged();
                        onBack();
                      } catch (e) {
                        onError(e);
                        setArmedDelete(false);
                      } finally {
                        setSaving(false);
                      }
                    })();
                  }}
                  onBlur={() => setArmedDelete(false)}
                >
                  {armedDelete ? "Delete it and every mark?" : "Delete activity"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

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

            <button
              type="button"
              className="fv-group"
              style={{ marginTop: 18 }}
              aria-expanded={subOpen}
              onClick={() => setSubOpen((v) => !v)}
            >
              <span className="fv-dot" style={{ background: "var(--fv-emerald)" }} />
              <span style={{ flex: 1, textAlign: "left", fontWeight: 600 }}>Submitted</span>
              <span className="fv-sub fv-num">{stat.submitted}</span>
              <span className={`fv-chev${subOpen ? " open" : ""}`} style={{ color: "var(--fv-muted)" }}>
                <FIcon name="chevronRight" size={16} />
              </span>
            </button>
            {subOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 2 }}>
                {submitted.length === 0 ? (
                  <div className="fv-sub" style={{ padding: "4px 8px" }}>
                    Nothing handed in yet.
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
      </div>
    </div>
  );
}
