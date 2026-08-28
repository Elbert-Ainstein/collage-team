"use client";

// Roster & teams.
//
// The handoff draws only the roster card. Three things it leaves out are kept
// here because the rest of the app depends on them: the email address (the only
// join key between a roster row and a login), file/paste import (nobody types
// sixteen names twice), and a route to the team builder (team-scope activities,
// the gradebook and the student view all read teams).

import { useEffect, useMemo, useRef, useState } from "react";
import { TeamsPillar } from "@/checkins/TeamsPillar";
import { addStudents, setStudentEmail } from "@/checkins/data";
import { removeStudentWithStorage } from "@/checkins/purge";
import {
  countWorkForStudent,
  courseMemberRoles,
  setMemberRole,
  type AccountRole,
} from "@/faculty/facultyData";
import {
  isSupportedRosterFile,
  parseRoster,
  type ParsedStudent,
} from "@/checkins/rosterImport";
import { reconcileRoster } from "@/checkins/rosterReconcile";
import {
  applyTeamPlan,
  hasTeamNumbers,
  missReason,
  planTeamImport,
  KEEPS_THEIR_TEAM,
  NOTHING_IS_DELETED,
  type TeamPlan,
} from "@/checkins/teamImport";
import { getTutorialSheet, studentMarks } from "@/checkins/tutorial";
import type { Student } from "@/checkins/types";
import {
  canvasColumns,
  canvasCsv,
  checkInColumns,
  checkInCsv,
  downloadCsv,
  safeFilename,
  type CheckInGradeRow,
} from "./exportTerm";
import { InviteCodeCard } from "./InviteCodeCard";
import { FAvatar, FIcon } from "./icons";
import { FacultyError, type FacultyData } from "./FacultyApp";
import "@/checkins/checkins.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What an import would do, shown before anything is written. */
interface Preview {
  /** Named in the summary so the user knows which input this came from. */
  source: string;
  /** Everything the file said, kept so the teams can be re-planned after an add. */
  rows: ParsedStudent[];
  fresh: ParsedStudent[];
  emailFills: { student: Student; email: string }[];
  unchanged: number;
  /** Null when the file carries no team numbers, which is every roster import. */
  plan: TeamPlan | null;
  warnings: string[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Enough of a miss list to see the shape of the problem, not eighty lines of it. */
const SHOW_MISSES = 6;

/**
 * What importing the team column would do — teams, sizes, and every student the
 * file does not settle.
 *
 * The counts are the point. Names would be eighty lines for a class this size,
 * and the thing Kelly has to be able to see at a glance is that team 4 has one
 * student in it because a row above it is spelled wrong.
 */
function TeamPlanPreview(props: { plan: TeamPlan }): JSX.Element {
  const { plan } = props;
  const named = plan.teams.filter((t) => t.number != null);
  const emptied = plan.teams.filter((t) => t.emptied);
  const stay = plan.teams.reduce((n, t) => n + t.kept.length, 0);
  const byName = plan.placements.filter((p) => p.by === "name").length;
  const notes: string[] = [];

  if (plan.notInFile.length || plan.noNumber.length) {
    notes.push(
      `${plural(plan.notInFile.length + plan.noNumber.length, "student is", "students are")} ` +
        `on the roster with no team in this file. ${KEEPS_THEIR_TEAM}` +
        (stay ? ` ${stay} of them ${stay === 1 ? "is" : "are"} on a team today, and stay on it.` : ""),
    );
  }
  if (emptied.length) {
    notes.push(
      `${emptied.map((t) => t.name).join(", ")} ${emptied.length === 1 ? "ends" : "end"} up with ` +
        `nobody on ${emptied.length === 1 ? "it" : "them"}, and ${emptied.length === 1 ? "is" : "are"} ` +
        `left in place. Deleting a team deletes its photos and recordings, so that stays on Form teams.`,
    );
  }
  notes.push(NOTHING_IS_DELETED);

  return (
    <>
      <div className="fv-eyebrow" style={{ marginTop: 12 }}>
        Teams
      </div>
      <div style={{ fontSize: "var(--fv-xs)", marginTop: 4, lineHeight: 1.6 }}>
        {plural(named.length, "team", "teams")} ·{" "}
        {plural(plan.placements.length, "student placed", "students placed")}
        {byName ? ` · ${byName} matched on name, not email` : ""}
      </div>
      <ul
        style={{
          margin: "6px 0 0",
          paddingLeft: 18,
          fontSize: "var(--fv-2xs)",
          lineHeight: 1.6,
        }}
      >
        {named.map((t) => (
          <li key={`${t.number}-${t.name}`}>
            <strong>{t.name}</strong> · {plural(t.members.length, "student", "students")}
            {t.existingId === null
              ? " — new"
              : t.name === `Team ${t.number}`
                ? ""
                : ` — team ${t.number} in the file, keeping its name`}
            {t.kept.length ? `, ${t.kept.length} of them already there` : ""}
          </li>
        ))}
      </ul>
      {plan.unplaced.length ? (
        <ul
          style={{
            margin: "6px 0 0",
            paddingLeft: 18,
            fontSize: "var(--fv-2xs)",
            color: "var(--fv-amber)",
            lineHeight: 1.6,
          }}
        >
          {plan.unplaced.slice(0, SHOW_MISSES).map((u, i) => (
            <li key={`${i}-${u.row.name}`}>{missReason(u)}</li>
          ))}
          {plan.unplaced.length > SHOW_MISSES ? (
            <li>
              {plan.unplaced.length - SHOW_MISSES} more rows the roster has nobody for. Nothing was
              moved for any of them.
            </li>
          ) : null}
        </ul>
      ) : null}
      <ul
        style={{
          margin: "6px 0 0",
          paddingLeft: 18,
          fontSize: "var(--fv-2xs)",
          color: "var(--fv-muted)",
          lineHeight: 1.6,
        }}
      >
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}

export function TeamsScreen(props: {
  data: FacultyData;
  onChanged: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const { data, onChanged, onError } = props;
  const { course, roster, activities, checkIns, results, teams, tfs } = data;

  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState("");
  const [pending, setPending] = useState<Preview | null>(null);
  const [builder, setBuilder] = useState(false);
  /** window.confirm is suppressed here, so removals take two clicks. */
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  // Removing a student cascades away every submission and mark of theirs. Say
  // how much before the confirming click, not after it.
  const [removeCost, setRemoveCost] = useState<string | null>(null);
  // The big dropzone is the empty state. Once there are students it stops being
  // the point of the screen and becomes a wall between the instructor and the
  // roster, so it collapses to a link — late enrolments still happen, so it
  // folds away rather than disappearing.
  const [importOpen, setImportOpen] = useState(false);
  const [armedClear, setArmedClear] = useState<string | null>(null);
  /** Only addresses being edited right now. Everything else reads the props,
   *  so a saved — or deleted — address is never shadowed by a stale draft. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Null means "whichever week the course is on" — see `gradeWeek` below. */
  const [pickedWeek, setPickedWeek] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);

  const fail = (e: unknown) => {
    setError(String((e as Error)?.message ?? e));
    onError(e);
  };

  const teamOf = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => t.members.forEach((mem) => m.set(mem.id, t.name)));
    return m;
  }, [teams]);

  // By id, not by name: the export asks tutorial.ts for one member's marks and
  // that call is keyed on the team row, not on what the team is called.
  const teamIdOf = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => t.members.forEach((mem) => m.set(mem.id, t.id)));
    return m;
  }, [teams]);

  const nextPosition = useMemo(
    () => roster.reduce((n, s) => Math.max(n, s.position), -1) + 1,
    [roster],
  );

  // A TF's address on a student row is a hazard, not a cosmetic clash — and the
  // direction matters. At sign-in the TF list wins: RoleRouter calls
  // claimTFRows() and returns "tf" in BOTH role branches before it ever reaches
  // claimStudentRows() (app/ck/page.tsx), so whoever holds that address gets the
  // teaching-fellow view of this course, and the student row is never claimed —
  // it stays on a team and ungraded forever, with nothing able to hand in
  // against it. Only the owner loads `tfs` (a TF may read just their own row),
  // and the owner is also the only one who can act on it.
  const tfByEmail = useMemo(() => {
    const m = new Map<string, string>();
    tfs.forEach((t) => {
      if (t.email) m.set(t.email.toLowerCase(), t.name);
    });
    return m;
  }, [tfs]);

  // The builder is the original app's component and follows the OS colour
  // scheme; the faculty view is always the cream one. Pin light while it is on
  // screen so the two surfaces do not disagree mid-page.
  useEffect(() => {
    if (!builder) return;
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "light");
    return () => {
      if (prev) root.setAttribute("data-theme", prev);
      else root.removeAttribute("data-theme");
    };
  }, [builder]);

  // ---------------- email ----------------

  const draftFor = (s: Student) => drafts[s.id] ?? s.email ?? "";
  const dirty = (s: Student) => draftFor(s).trim() !== (s.email ?? "");

  const editEmail = (id: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [id]: value }));

  const dropDraft = (id: string) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  async function commitEmail(s: Student) {
    const next = draftFor(s).trim();
    if (next === (s.email ?? "")) return;

    if (!next) {
      // Clearing an address leaves an unclaimed row with nothing a join can
      // match, so it is armed first and only cleared on the second click.
      if (armedClear !== s.id) {
        setArmedClear(s.id);
        return;
      }
    } else if (!EMAIL_RE.test(next)) {
      setNote(
        `"${next}" is not an email address — it is what matches this row to the account they join with, so it has to be exact.`,
      );
      return;
    } else {
      // Two rows on one address means whoever signs in claims an arbitrary one.
      const taken = roster.find(
        (o) => o.id !== s.id && (o.email ?? "").toLowerCase() === next.toLowerCase(),
      );
      if (taken) {
        setNote(`${next} is already on ${taken.name}'s row.`);
        return;
      }
      // A TF's address on a student row is refused outright: nothing about it
      // looks wrong at the time, and the damage lands later at their sign-in.
      const tf = tfByEmail.get(next.toLowerCase());
      if (tf) {
        setNote(
          `${next} is ${tf}'s address on this course's TF roster. At sign-in the TF list wins, so ` +
            `they would get the teaching-fellow view of this course and this row would never be ` +
            `claimed — it would sit on a team, ungraded, with no way to hand anything in. Take ` +
            `them off the TF roster first if they are really taking the course.`,
        );
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      await setStudentEmail(s.id, next || null);
      setArmedClear(null);
      dropDraft(s.id);
      setNote(
        next ? `${s.name}'s row now matches ${next}.` : `Cleared ${s.name}'s address.`,
      );
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // What account type each signed-in person on this roster picked. A course
  // owner cannot read anyone else's profile row, so this comes through 0024's
  // scoped function; without it there is no way to SEE a wrong pick, let alone
  // fix one.
  const [roles, setRoles] = useState<Map<string, AccountRole>>(new Map());
  const [roleBusy, setRoleBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    courseMemberRoles(data.course.id)
      .then((m) => {
        if (alive) setRoles(m);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [data.course.id, data.roster]);

  async function fixRole(userId: string, role: AccountRole) {
    setRoleBusy(userId);
    setError(null);
    try {
      await setMemberRole(userId, role);
      setRoles((prev) => new Map(prev).set(userId, role));
      setNote(
        role === "student"
          ? "Switched to a student account. They will land in the course next time they sign in."
          : "Switched to a faculty account.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setRoleBusy(null);
    }
  }

  async function drop(s: Student) {
    setArmedRemove(null);
    setBusy(true);
    setError(null);
    try {
      // Their files go with them, and in that order — the helper owns why. The
      // confirm says the work goes; this is what makes that true.
      await removeStudentWithStorage(s.id);
      setNote(`Removed ${s.name}.`);
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // ---------------- import ----------------

  function propose(text: string, source: string) {
    const parsed = parseRoster(text);
    const rec = reconcileRoster<Student>(roster, parsed.students);
    // A file with a team column has something to do even when every name on it
    // is already here and correct — which is the normal case now that students
    // arrive by class code, and used to be reported as "nothing to add".
    const plan = hasTeamNumbers(parsed.students)
      ? planTeamImport({ roster, rows: parsed.students, teams })
      : null;
    if (!rec.fresh.length && !rec.emailFills.length && !plan) {
      setPending(null);
      setNote(
        [
          parsed.students.length
            ? `Nothing to add — all ${plural(parsed.students.length, "name", "names")} are already on the roster.`
            : `No names found in ${source}.`,
          ...parsed.warnings,
        ].join(" "),
      );
      return;
    }
    // The same hazard as typing one in, caught before the write: a class list
    // that happens to carry a TF's address would add a row nobody can ever
    // claim. Said rather than blocked — this panel has a Cancel, and the roster
    // is the instructor's to decide.
    const tfHits = new Map<string, string>();
    for (const email of [
      ...rec.fresh.map((p) => p.email),
      ...rec.emailFills.map((f) => f.email),
    ]) {
      const tf = email ? tfByEmail.get(email.toLowerCase()) : undefined;
      if (email && tf) tfHits.set(email.toLowerCase(), tf);
    }

    setNote(null);
    setPending({
      source,
      rows: parsed.students,
      fresh: rec.fresh,
      emailFills: rec.emailFills,
      unchanged: rec.unchanged,
      plan,
      warnings: [
        ...parsed.warnings,
        ...Array.from(
          tfHits,
          ([email, tf]) =>
            `${email} is ${tf}'s address on this course's TF roster — at sign-in the TF list wins, ` +
            `so a row here would never be claimed and would sit on a team, ungraded.`,
        ),
      ],
    });
  }

  async function takeFile(f: File | null | undefined) {
    if (!f) return;
    if (!isSupportedRosterFile(f.name)) {
      setNote(`${f.name} is not a text roster — export it as .csv and try again.`);
      return;
    }
    try {
      propose(await f.text(), f.name);
    } catch (e) {
      fail(e);
    }
  }

  async function applyImport() {
    const p = pending;
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      let after = roster;
      if (p.fresh.length) {
        const added = await addStudents(
          course.id,
          p.fresh.map((s) => ({ name: s.name, email: s.email })),
          nextPosition,
        );
        after = [...roster, ...added];
      }
      for (const fillIn of p.emailFills) {
        await setStudentEmail(fillIn.student.id, fillIn.email);
      }
      const done = [
        p.fresh.length ? `Added ${plural(p.fresh.length, "student", "students")}.` : "",
        p.emailFills.length
          ? `Filled in ${plural(p.emailFills.length, "address", "addresses")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (p.plan) {
        // The rows just added are exactly the ones the team plan had nobody for,
        // so re-plan and stay on the panel rather than sending her back to the
        // file. Planned against the rows the insert HANDED BACK: `roster` is a
        // refresh behind us and would match none of them.
        setPending({
          ...p,
          fresh: [],
          emailFills: [],
          unchanged: p.rows.length,
          plan: planTeamImport({ roster: after, rows: p.rows, teams }),
        });
        setNote(`${done} Everyone in the file is on the roster now — check the teams below.`);
      } else {
        setImportOpen(false);
        setNote(done);
        setPending(null);
        setPaste("");
      }
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  /** Write the teams the file describes. Moves and creates only — see teamImport. */
  async function applyTeams() {
    const p = pending;
    if (!p?.plan) return;
    setBusy(true);
    setError(null);
    try {
      const out = await applyTeamPlan(course.id, p.plan);
      setImportOpen(false);
      setNote(
        `${plural(out.moved, "student is", "students are")} on the teams from ${p.source}` +
          (out.created ? `, and ${plural(out.created, "team was", "teams were")} added` : "") +
          ". Nothing was deleted.",
      );
      setPending(null);
      setPaste("");
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // ---------------- grades out ----------------
  //
  // On this screen and not on Activities, because everything the file is made of
  // is here: one row per student, and the column Canvas matches on is the email
  // address sitting on every roster row below. The screen where a missing
  // address gets fixed is the screen that should say which students will not
  // match — anywhere else and she downloads first and finds out in Canvas.

  const gradeWeeks = useMemo(
    () =>
      [...new Set(activities.map((a) => a.week).filter((w): w is number => w != null))].sort(
        (a, b) => b - a,
      ),
    [activities],
  );

  // The live week if there is one, else the newest — the week she has just
  // finished marking is the one she is exporting, and it is one click to change.
  const gradeWeek =
    pickedWeek ??
    (course.live_week != null && gradeWeeks.includes(course.live_week)
      ? course.live_week
      : (gradeWeeks[0] ?? null));

  const weekActivities = useMemo(
    () => activities.filter((a) => a.week === gradeWeek),
    [activities, gradeWeek],
  );

  const gradeCols = useMemo(
    () => canvasColumns(weekActivities, checkIns),
    [weekActivities, checkIns],
  );
  // An activity nobody has priced pays 0 into the total, and it does that
  // silently — the file opens, the arithmetic is right, and the week is short by
  // five points. Say which one, and where the number lives.
  const unpriced = gradeCols.filter((c) => c.worth === 0);
  const gradeTotal = gradeCols.reduce((n, c) => n + c.worth, 0);

  const named = (what: string) =>
    `${safeFilename(course.code?.trim() || course.name, course.term, what)}.csv`;

  const takeCanvas = () => {
    setExportProblem(null);
    try {
      downloadCsv(
        named(`week-${gradeWeek}-canvas`),
        canvasCsv({ students: roster, activities: weekActivities, checkIns, results }),
      );
    } catch (e) {
      setExportProblem(String((e as Error)?.message ?? e));
    }
  };

  const takeCheckIns = async () => {
    setExporting(true);
    setExportProblem(null);
    try {
      // One read per activity in the week, in parallel: tutorial_marks is keyed
      // by activity and a week holds one or two of them. Two round trips on a
      // button press, none at load.
      const sheets = await Promise.all(weekActivities.map((a) => getTutorialSheet(a.id)));
      const rows: CheckInGradeRow[] = [];
      weekActivities.forEach((a, i) => {
        const sheet = sheets[i];
        for (const s of roster) {
          const teamId = teamIdOf.get(s.id);
          // Nobody has marked a student who is on no team — the sheet is walked
          // team by team, so there is no row for them to be in or out of.
          if (!teamId) continue;
          const slots = studentMarks(sheet.marks, sheet.absences, teamId, s.id);
          if (slots.length) rows.push({ activityId: a.id, studentId: s.id, slots });
        }
      });
      // Refused rather than written when the week holds nothing. A check-in file
      // with no columns still carries every student, a blank Total and nothing
      // else — it looks like some other export rather than like an empty one,
      // and reading it as "the wrong CSV" is the correct reading of it. Asked of
      // checkInColumns and not of `rows`: a row whose slots were opened but
      // never scored is out of nothing, so it makes no column, and this has to
      // agree with the file or it is the same bug one step later.
      const forExport = { students: roster, activities: weekActivities, rows };
      if (!checkInColumns(forExport).length) {
        setExportProblem(
          `Nothing has been marked on the week ${gradeWeek} check-in, so there is no file to ` +
            `write and nothing was downloaded. Check the week above, and that these are the ` +
            `teams that were in the room — marks belong to the teams they were given to, and ` +
            `re-forming teams deletes them.`,
        );
        return;
      }
      downloadCsv(named(`week-${gradeWeek}-check-ins`), checkInCsv(forExport));
    } catch (e) {
      setExportProblem(String((e as Error)?.message ?? e));
    } finally {
      setExporting(false);
    }
  };

  // ---------------- team builder ----------------

  if (builder) {
    return (
      <div className="fv-panel">
        <div className="fv-topbar">
          <button
            type="button"
            className="fv-back"
            aria-label="Back to roster & teams"
            onClick={() => setBuilder(false)}
          >
            <FIcon name="chevronLeft" size={18} />
          </button>
          <span className="fv-sub">
            Roster &amp; teams · forming teams from {plural(roster.length, "student", "students")}
          </span>
        </div>
        <div className="fv-scroll">
          <TeamsPillar
            courseId={course.id}
            roster={roster}
            activities={activities}
            refresh={async () => {
              onChanged();
            }}
          />
        </div>
      </div>
    );
  }

  // ---------------- roster ----------------

  const withoutEmail = roster.filter((s) => !s.email).length;
  /**
   * Imported rows nobody has claimed. No longer everyone the student code is
   * for — it now admits people who are on no list at all — but still the people
   * a rotation would strand holding a dead code, which is what the card wants.
   */
  const notJoined = roster.filter((s) => !s.user_id).length;

  // A teaching fellow sees who is in the class, and nothing they can change:
  // every roster write is owner-only in RLS, so the controls would only ever
  // produce an error.
  const canEdit = data.can.manageRoster;

  return (
    <div className="fv-panel">
      <div className="fv-head">
        <h1 className="fv-h1">Roster &amp; teams</h1>
        <span className="fv-sub">
          {course.code ?? course.name} · {plural(roster.length, "student", "students")} — teams are
          assigned by faculty; self-selection is not offered.
        </span>
        <span style={{ flex: 1 }} />
        {canEdit ? (
          <div className="fv-headbtns">
            <button
              type="button"
              className="fv-btn outline sm"
              onClick={() => setBuilder(true)}
              disabled={roster.length === 0}
              title={
                roster.length === 0
                  ? "Nobody has joined yet — teams are formed from the roster, and the roster fills as students enter the code."
                  : undefined
              }
            >
              <FIcon name="groups" size={15} />
              Form teams
            </button>
          </div>
        ) : null}
      </div>

      <FacultyError error={error} onClear={() => setError(null)} />

      <div className="fv-scroll">
        {/* Above the roster because the roster is what it produces: the code
            goes out, the rows underneath are who used it. A TF gets this screen
            too and must not see it — and would not anyway, since course_invites
            has no read policy but the owner's. */}
        {data.can.isOwner ? (
          <InviteCodeCard
            courseId={course.id}
            courseName={course.name}
            section={course.code}
            kind="student"
            waiting={notJoined}
          />
        ) : null}

        {/* Between the code and the roster on purpose: the code fills the list,
            the list is what this adds up, and the email column it matches on is
            the next thing on the page. */}
        {data.can.grade && gradeWeek != null ? (
          <div className="fv-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="fv-eyebrow">Grades out</div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 8,
              }}
            >
              <div className="fv-field" style={{ width: 130 }}>
                <label className="fv-eyebrow" htmlFor="fv-grade-week">
                  Week
                </label>
                <select
                  id="fv-grade-week"
                  className="fv-in quiet"
                  value={gradeWeek}
                  onChange={(e) => setPickedWeek(Number(e.target.value))}
                >
                  {gradeWeeks.map((w) => (
                    <option key={w} value={w}>
                      Week {w}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="fv-btn primary sm"
                disabled={roster.length === 0 || gradeCols.length === 0}
                onClick={takeCanvas}
              >
                <FIcon name="fileUpload" size={15} />
                Canvas points (CSV)
              </button>

              {/* A TF without the check-in permission can read no tutorial_marks
                  at all, so this would hand them an empty file rather than an
                  error and they would have no way to tell which it was. */}
              {data.can.runCheckIns ? (
                <button
                  type="button"
                  className="fv-btn outline sm"
                  disabled={exporting || roster.length === 0}
                  onClick={() => void takeCheckIns()}
                >
                  <FIcon name="fileUpload" size={15} />
                  {exporting ? "Reading the sheet…" : "Check-in scores (CSV)"}
                </button>
              ) : null}
            </div>

            <div className="fv-sub" style={{ maxWidth: "72ch", lineHeight: 1.55, marginTop: 10 }}>
              One row per student. Completion marks are written as points, not as the words
              Complete and Not complete — a gradebook adds a column, it does not read one. The
              total is the sum of the columns beside it: work that is in but not released yet is
              left blank rather than scored 0, so a mark nobody has made cannot arrive in Canvas
              as a fail.
            </div>

            {gradeCols.length ? (
              <div className="fv-sub" style={{ maxWidth: "72ch", lineHeight: 1.55, marginTop: 6 }}>
                Week {gradeWeek} is <strong>{gradeTotal} points</strong>:{" "}
                {gradeCols.map((c, i) => (
                  <span key={c.activity.id}>
                    {i ? " + " : ""}
                    {c.label} ({c.worth})
                  </span>
                ))}
              </div>
            ) : (
              <div className="fv-sub" style={{ maxWidth: "72ch", lineHeight: 1.55, marginTop: 6 }}>
                Week {gradeWeek} has nothing students are marked on their own for, so there is no
                Canvas file to write. Team-only activities are left out — Canvas grades people.
              </div>
            )}

            {unpriced.length ? (
              <div
                className="fv-sub"
                style={{ maxWidth: "72ch", lineHeight: 1.55, marginTop: 6, color: "var(--fv-amber)" }}
              >
                {unpriced.map((c) => c.label).join(", ")}{" "}
                {unpriced.length === 1 ? "is" : "are"} not worth anything yet, so{" "}
                {unpriced.length === 1 ? "its column comes out" : "those columns come out"} as
                zeros. Set what it is out of on the activity — that number is what a Complete
                pays here.
              </div>
            ) : null}

            <div className="fv-sub" style={{ maxWidth: "72ch", lineHeight: 1.55, marginTop: 6 }}>
              Canvas matches these rows on <strong>email</strong>. This course holds no SIS id —
              there is no column for one — so if your Canvas matches on that instead, the headers
              are plain English with the points in brackets and map by hand.{" "}
              {withoutEmail > 0
                ? `${plural(withoutEmail, "student has", "students have")} no address on this roster and will not match.`
                : null}
            </div>

            {exportProblem ? (
              <div
                className="fv-sub"
                style={{ marginTop: 8, lineHeight: 1.55, color: "var(--fv-destructive)" }}
              >
                {exportProblem}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="fv-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
            {roster.map((s) => {
              const changed = dirty(s);
              const cleared = !draftFor(s).trim();
              // Read from the saved address, not the draft: this is a fact about
              // the row as it stands, and the write path refuses new ones.
              const alsoTF = s.email ? tfByEmail.get(s.email.toLowerCase()) : undefined;
              return (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 4px",
                    borderBottom: "1px solid var(--fv-neutral-200)",
                    flexWrap: "wrap",
                  }}
                >
                  <FAvatar name={s.name} tint={s.avatar_tint} size={22} />
                  <span
                    style={{
                      flex: "1 1 140px",
                      minWidth: 0,
                      fontSize: "var(--fv-xs)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                  </span>

                  {!canEdit ? (
                    <span
                      style={{
                        width: 208,
                        flex: "none",
                        fontSize: "var(--fv-2xs)",
                        color: s.email ? "var(--fv-muted)" : "var(--fv-amber)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.email ?? "no address — cannot be matched"}
                    </span>
                  ) : (
                  <input
                    className="fv-in"
                    style={{
                      width: 208,
                      flex: "none",
                      height: 26,
                      padding: "0 8px",
                      fontSize: "var(--fv-2xs)",
                    }}
                    type="email"
                    placeholder="no address — cannot be matched"
                    aria-label={`Email for ${s.name}`}
                    value={draftFor(s)}
                    disabled={busy}
                    onChange={(e) => {
                      if (armedClear === s.id) setArmedClear(null);
                      editEmail(s.id, e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEmail(s);
                      if (e.key === "Escape") {
                        setArmedClear(null);
                        dropDraft(s.id);
                      }
                    }}
                  />
                  )}
                  {canEdit && changed ? (
                    <button
                      type="button"
                      className="fv-btn sm"
                      style={{
                        height: 22,
                        padding: "0 8px",
                        flex: "none",
                        color: cleared ? "var(--fv-destructive)" : "var(--fv-navy-700)",
                      }}
                      disabled={busy}
                      onClick={() => void commitEmail(s)}
                    >
                      {armedClear === s.id ? "Clear it?" : cleared ? "Clear" : "Save"}
                    </button>
                  ) : null}

                  {/* The account only exists once the student signs up under
                      that address, so the row has to say which state it is in. */}
                  {s.user_id ? (
                    roles.get(s.user_id) === "faculty" ? (
                      // Their account says Faculty but they are on a student
                      // roster: "Faculty" is the default button at sign-up, so
                      // this is the common wrong pick and it strands them in an
                      // empty gradebook. Say so where it is visible, and offer
                      // the fix rather than a support conversation.
                      <button
                        type="button"
                        className="fv-btn outline sm"
                        style={{ flex: "none", color: "var(--fv-amber)" }}
                        disabled={roleBusy === s.user_id}
                        onClick={() => void fixRole(s.user_id as string, "student")}
                        title={
                          "This account signed up as Faculty, so it opens an empty gradebook " +
                          "instead of this course. Switch it to a student account."
                        }
                      >
                        {roleBusy === s.user_id ? "Switching…" : "Signed up as faculty — fix"}
                      </button>
                    ) : (
                      <span
                        className="fv-badge"
                        style={{ flex: "none", color: "var(--fv-emerald)" }}
                        title="This student has signed in and claimed their row."
                      >
                        signed in
                      </span>
                    )
                  ) : null}

                  {/* Whichever screen made the overlap, it surfaces here: this
                      compares the two rosters on render rather than guarding one
                      write, so a row added from the TFs side shows it too. */}
                  {alsoTF ? (
                    <span
                      className="fv-badge"
                      style={{ flex: "none", color: "var(--fv-amber)" }}
                      title={
                        `${alsoTF} is on this course's TF roster under the same address. At sign-in ` +
                        `the TF list wins: they get the teaching-fellow view of this course — ` +
                        `everyone's submissions, and grading if TFs may grade — and this row is ` +
                        `never claimed, so it sits on a team and counts as ungraded forever. If ` +
                        `they are a student here, take them off the TF roster: that is what grants ` +
                        `the access, and removing this row alone leaves it.`
                      }
                    >
                      also a TF
                    </span>
                  ) : null}

                  <span
                    style={{
                      fontSize: "var(--fv-2xs)",
                      color: "var(--fv-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {teamOf.get(s.id) ?? "no team"}
                  </span>

                  {!canEdit ? null : armedRemove === s.id ? (
                    <button
                      type="button"
                      className="fv-btn sm"
                      style={{
                        height: 22,
                        padding: "0 8px",
                        flex: "none",
                        color: "var(--fv-destructive)",
                      }}
                      disabled={busy}
                      onClick={() => void drop(s)}
                      onBlur={() => {
                        setArmedRemove(null);
                        setRemoveCost(null);
                      }}
                      title={removeCost ?? undefined}
                    >
                      {removeCost ? "Remove and delete their work?" : "Remove?"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="fv-iconbtn"
                      style={{ width: 22, height: 22, flex: "none" }}
                      aria-label={`Remove ${s.name}`}
                      disabled={busy}
                      onClick={() => {
                        setArmedRemove(s.id);
                        setRemoveCost(null);
                        void countWorkForStudent(s.id)
                          .then((n) =>
                            setRemoveCost(
                              n === 0
                                ? null
                                : `${n} submission${n === 1 ? "" : "s"} of theirs will be deleted too.`,
                            ),
                          )
                          .catch(() => setRemoveCost(null));
                      }}
                    >
                      <FIcon name="close" size={15} />
                    </button>
                  )}
                </div>
              );
            })}
            {/* An empty roster used to mean "you have not done the import yet",
                and Kelly would sit waiting on herself. Names now arrive on
                their own, so the first thing this says is that there is nothing
                to wait for; the import is offered second, as the thing it now
                is. */}
            {roster.length === 0 ? (
              <div className="fv-sub" style={{ padding: "10px 4px", lineHeight: 1.5 }}>
                {canEdit
                  ? "No students yet. Names appear here as students enter the class code — you do not have to add anyone first. Paste or drop a class list below only if you want the names in place before they join."
                  : "No students yet. Names appear here as students enter the class code."}
              </div>
            ) : null}
          </div>

          {withoutEmail > 0 ? (
            <div className="fv-sub" style={{ margin: "0 4px 12px", lineHeight: 1.5 }}>
              {plural(withoutEmail, "student has", "students have")} no address — a row added by
              name only. The class code still gets them in, but nothing ties their account to this
              row, so they arrive as a second one and this stays here unclaimed. Fill the address
              in, or delete the row and let their own join make it.
            </div>
          ) : null}

          {canEdit && roster.length > 0 && !importOpen ? (
            <button
              type="button"
              className="fv-btn outline sm"
              style={{ marginTop: 4 }}
              onClick={() => setImportOpen(true)}
            >
              <FIcon name="add" size={15} />
              Add more students
            </button>
          ) : null}

          {canEdit && (roster.length === 0 || importOpen) ? (
            <>
          {importOpen ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button
                type="button"
                className="fv-btn ghost sm"
                onClick={() => {
                  setImportOpen(false);
                  setPending(null);
                }}
              >
                Done
              </button>
            </div>
          ) : null}
          <input
            ref={file}
            type="file"
            accept=".csv,.tsv,.txt"
            style={{ display: "none" }}
            onChange={(e) => {
              void takeFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className={`fv-dz${over ? " over" : ""}`}
            style={{ width: "100%", font: "inherit", color: "inherit", gap: 9 }}
            disabled={busy}
            onClick={() => file.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void takeFile(e.dataTransfer.files?.[0]);
            }}
          >
            <span style={{ color: "var(--fv-muted)" }}>
              <FIcon name="fileUpload" size={30} />
            </span>
            <span
              style={{
                fontFamily: "var(--fv-serif)",
                fontSize: "var(--fv-lg)",
                fontWeight: 700,
                color: "var(--fv-navy)",
              }}
            >
              {roster.length === 0 ? "Add students in advance" : "Add students, or upload teams"}
            </span>
            <span
              style={{
                fontSize: "var(--fv-xs)",
                color: "var(--fv-muted)",
                maxWidth: "46ch",
                lineHeight: 1.5,
              }}
            >
              Drop a <strong>.csv</strong>, <strong>.tsv</strong> or <strong>.txt</strong> here, or
              click to choose. Names, optionally with emails, and a <strong>team number</strong> if
              you already have your teams in a spreadsheet — other columns are ignored.
            </span>
          </button>

          <div className="fv-divider" style={{ margin: "16px 0 12px" }}>
            <span style={{ flex: 1, height: 1, background: "var(--fv-neutral-200)" }} />
            <span className="fv-eyebrow">or paste them</span>
            <span style={{ flex: 1, height: 1, background: "var(--fv-neutral-200)" }} />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 240 }}>
              <textarea
                className="fv-ta"
                rows={2}
                placeholder="…or paste names — one per line"
                aria-label="Paste students"
                value={paste}
                disabled={busy}
                onChange={(e) => setPaste(e.target.value)}
              />
            </span>
            <button
              type="button"
              className="fv-btn primary sm"
              disabled={busy || !paste.trim()}
              onClick={() => propose(paste, "what you pasted")}
            >
              Add to roster
            </button>
          </div>

          {pending ? (
            <div
              style={{
                marginTop: 12,
                padding: "11px 12px",
                border: "1px solid var(--fv-neutral-200)",
                borderRadius: "var(--fv-r-md)",
                background: "var(--fv-cream-300)",
              }}
            >
              <div className="fv-eyebrow">From {pending.source}</div>
              <div style={{ fontSize: "var(--fv-xs)", marginTop: 6, lineHeight: 1.6 }}>
                {plural(pending.fresh.length, "new student", "new students")} ·{" "}
                {plural(pending.emailFills.length, "row gains", "rows gain")} an email ·{" "}
                {pending.unchanged} already correct
              </div>
              {pending.warnings.length ? (
                <ul
                  style={{
                    margin: "6px 0 0",
                    paddingLeft: 18,
                    fontSize: "var(--fv-2xs)",
                    color: "var(--fv-muted)",
                    lineHeight: 1.6,
                  }}
                >
                  {pending.warnings.map((w, i) => (
                    <li key={`${i}-${w}`}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {pending.plan ? <TeamPlanPreview plan={pending.plan} /> : null}
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {pending.fresh.length || pending.emailFills.length ? (
                  <button
                    type="button"
                    className="fv-btn primary sm"
                    disabled={busy}
                    onClick={() => void applyImport()}
                  >
                    {busy ? "Adding…" : "Add to roster"}
                  </button>
                ) : null}
                {pending.plan ? (
                  <button
                    type="button"
                    className={`fv-btn ${pending.fresh.length ? "outline" : "primary"} sm`}
                    disabled={busy || pending.plan.placements.length === 0}
                    title={
                      pending.plan.placements.length === 0
                        ? "Nobody in the file matches a student on the roster, so there is no team to set."
                        : undefined
                    }
                    onClick={() => void applyTeams()}
                  >
                    {busy ? "Setting teams…" : "Set teams"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="fv-btn outline sm"
                  disabled={busy}
                  onClick={() => setPending(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

            </>
          ) : null}

          {/* Outside the import panel, not inside it: notes come from the email
              field too, and every refusal from commitEmail — a malformed
              address, one already on another row, a TF's — used to be set into
              state and then never rendered, so pressing Enter looked like it
              had simply done nothing. */}
          {note ? (
            <div className="fv-sub" style={{ marginTop: 10, lineHeight: 1.5 }}>
              {note}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
