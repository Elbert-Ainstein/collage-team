"use client";

// The faculty app: Activities / Teams / TFs, plus three full-screen views
// reached by drilling into an activity.
//
// Navigation is a single `screen` value, exactly as the handoff specifies. The
// sidebar is hidden on the three full-screen views and a 12px spacer takes its
// place so the panel keeps its inset.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import {
  ensureSessions,
  listCourses,
  listActivities,
  listCheckIns,
  listResults,
  listStudents,
  listTeamSets,
  listTeams,
} from "@/checkins/data";
import type {
  Activity,
  ActivityQuestion,
  CheckIn,
  CheckInResult,
  Course,
  CourseTF,
  CourseWeek,
  Student,
  TeamWithMembers,
} from "@/checkins/types";
import { duplicateActivity, listQuestionsFor, listTFs, listWeeks, myTFCourses } from "./facultyData";
import { nextPositionIn, statFor, type ActivityStat } from "./model";
import { FIcon } from "./icons";
import { ActivitiesScreen } from "./ActivitiesScreen";
import { ActivityDetail } from "./ActivityDetail";
import { CheckInScreen } from "./CheckInScreen";
import { GradingScreen } from "./GradingScreen";
import { RubricBuilder } from "./RubricBuilder";
import { TeamsScreen } from "./TeamsScreen";
import { TFsScreen } from "./TFsScreen";
import "./faculty.css";

export type Screen =
  | "activities"
  | "checkin"
  | "teams"
  | "tfs"
  | "detail"
  | "rubric"
  | "grade";

/**
 * What this account may do on this course.
 *
 * Derived from ownership and the course-wide TF permissions, never from
 * profiles.role — role is picked by the person signing up, so it decides which
 * app you see but can never decide what you may change.
 *
 * The UI hides what it grants false. That is a courtesy, not the boundary: RLS
 * and the grading guard in 0006/0007 are what actually stop the write. Showing
 * a control that always fails is the thing worth avoiding.
 */
export interface Capabilities {
  isOwner: boolean;
  /** Create and edit activities, weeks and rubrics. */
  author: boolean;
  /** Put marks on submissions. */
  grade: boolean;
  /** Post and unpost check-ins to students, and set which week is live. */
  runCheckIns: boolean;
  /** Add, remove and email students; form teams. */
  manageRoster: boolean;
  /** See and change the TF roster and its permissions. */
  manageTFs: boolean;
}

export function capabilitiesFor(course: Course, isOwner: boolean): Capabilities {
  return {
    isOwner,
    author: isOwner,
    grade: isOwner || course.tf_can_grade,
    runCheckIns: isOwner || course.tf_can_checkin,
    manageRoster: isOwner,
    manageTFs: isOwner,
  };
}

/**
 * What a teaching fellow is told they may do here.
 *
 * Named after the two course-wide permissions, so the sentence changes the
 * moment the instructor moves either switch. Saying "read-only" while check-ins
 * are granted is the same lie the switch itself used to tell.
 */
function tfNote(can: Capabilities): string {
  const rest = "the instructor edits activities and the roster.";
  if (can.grade && can.runCheckIns) {
    return `You can grade submissions, post check-ins and set the live week; ${rest}`;
  }
  if (can.grade) return `You can grade submissions; ${rest}`;
  if (can.runCheckIns) return `You can post check-ins and set the live week, but not grade; ${rest}`;
  return "Grading and check-ins are both turned off for TFs on this course, so this view is read-only.";
}

/** Everything the screens read. Loaded once here, refreshed on any write. */
export interface FacultyData {
  course: Course;
  weeks: CourseWeek[];
  roster: Student[];
  activities: Activity[];
  /** Every activity's questions (0014). Empty for one that has none yet. */
  questions: ActivityQuestion[];
  checkIns: CheckIn[];
  results: CheckInResult[];
  teams: TeamWithMembers[];
  tfs: CourseTF[];
  /** Keyed by activity id — the one derived object both views read. */
  stats: Map<string, ActivityStat>;
  can: Capabilities;
}

const FULL_SCREEN: Screen[] = ["detail", "rubric", "grade"];

export function FacultyApp({
  account,
  onSignOut,
  /**
   * "owner" provisions the AP 50 sessions and runs them. "tf" attaches to
   * courses somebody else owns — crucially it must NOT call ensureSessions,
   * which would read the instructor's courses through the TF read policy,
   * conclude nothing is missing, and hand a teaching fellow the full authoring
   * UI on a course they cannot write to.
   */
  mode = "owner",
}: {
  account?: string;
  onSignOut?: () => Promise<void>;
  mode?: "owner" | "tf";
}) {
  const [screen, setScreen] = useState<Screen>("activities");
  // Remembered, because it is a preference about how somebody wants to work and
  // re-collapsing it on every reload would make it not worth using.
  const [railed, setRailed] = useState(false);
  useEffect(() => {
    setRailed(window.localStorage.getItem("fv-rail") === "1");
  }, []);
  const toggleRail = () =>
    setRailed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem("fv-rail", next ? "1" : "0");
      } catch {
        // A browser refusing storage (private mode, blocked cookies) should not
        // stop the sidebar from collapsing — it just will not be remembered.
      }
      return next;
    });
  const [view, setView] = useState<"rows" | "columns">("rows");
  const [selId, setSelId] = useState<string | null>(null);
  /** The activity that was just created, so its page can open ready to edit. */
  const [fresh, setFresh] = useState<string | null>(null);

  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);

  // Where you were, kept across a reload.
  //
  // Same arrangement as the student app: sessionStorage, because this is "I
  // refreshed" memory rather than a preference. Per-tab, and gone when the tab
  // closes, so opening the app tomorrow starts at the week list rather than
  // halfway through marking an activity from last term.
  //
  // Restored after the first render, never as useState's initial value: this
  // component server-renders, and reading a browser-only store during render
  // makes the server and client markup disagree.
  const restored = useRef(false);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("fv-where");
      if (!raw) return;
      const at = JSON.parse(raw) as Partial<{
        screen: Screen;
        selId: string | null;
        courseId: string | null;
      }>;
      if (at.screen) setScreen(at.screen);
      if (at.selId !== undefined) setSelId(at.selId);
      if (at.courseId) setCourseId(at.courseId);
    } catch {
      // Unparseable or refused storage: start where the app started before any
      // of this, which is the week list.
    } finally {
      restored.current = true;
    }
  }, []);

  useEffect(() => {
    // Not until the restore has run, or the initial "activities" overwrites the
    // thing we are about to read back.
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem("fv-where", JSON.stringify({ screen, selId, courseId }));
    } catch {
      // A browser refusing storage just means a reload starts at the list.
    }
  }, [screen, selId, courseId]);
  const [data, setData] = useState<FacultyData | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const fail = (e: unknown) => setError(String((e as Error)?.message ?? e));

  const loadCourses = useCallback(async () => {
    const cs = mode === "tf" ? await myTFCourses() : await ensureSessions();
    setCourses(cs);
    setCourseId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : (cs[0]?.id ?? null)));
  }, [mode]);

  const refresh = useCallback(async () => {
    if (!courseId) return;
    const known = courses.find((c) => c.id === courseId);
    if (!known) return;
    if (busy.current) return;
    busy.current = true;
    try {
      const isOwner = mode === "owner";

      const [allCourses, roster, activities, weeks, sets, tfs] = await Promise.all([
        // Re-read the course row on every refresh. It used to come only from the
        // `courses` array, which loadCourses fills once at mount — so every write
        // to the courses table (the live week, both TF permission switches) landed
        // in the database and then appeared to do nothing until a full reload.
        // Deliberately NOT written back into `courses` state: that array is what
        // refresh depends on, and updating it here would re-trigger this effect
        // in a loop. The switcher only needs the code, which does not change.
        listCourses(),
        listStudents(courseId),
        listActivities(courseId),
        listWeeks(courseId),
        listTeamSets(courseId),
        // A TF may only read their own row, so asking for the list would come
        // back as just them and read like the roster had been emptied.
        isOwner ? listTFs(courseId) : Promise.resolve([] as CourseTF[]),
      ]);
      const course = allCourses.find((c) => c.id === courseId) ?? known;

      // The gradebook needs ONE set of teams. Our team sets are per-activity, so
      // prefer a course-wide set and fall back to the most recent — the design
      // assumes a single stable roster of teams and this is the closest honest
      // reading of it.
      const set = sets.find((s) => s.activity_id == null) ?? sets[sets.length - 1] ?? null;

      // Only results genuinely waits on check-ins, so that pair stays chained
      // inside its own branch; questions and teams need nothing the first wave
      // did not already return. These used to run one after another, four round
      // trips deep, and every write in the app paid for all four.
      const [[checkIns, results], questions, teams] = await Promise.all([
        (async (): Promise<[CheckIn[], CheckInResult[]]> => {
          const cs = activities.length ? await listCheckIns(activities.map((a) => a.id)) : [];
          const rs = cs.length ? await listResults(cs.map((c) => c.id)) : [];
          return [cs, rs];
        })(),
        // Loaded here rather than per screen: the activity page prints what an
        // activity is out of, and so does the gradebook, and those two numbers
        // disagreeing is the failure this whole module is written to avoid.
        activities.length
          ? listQuestionsFor(activities.map((a) => a.id))
          : Promise.resolve([] as ActivityQuestion[]),
        set ? listTeams(set.id, roster) : Promise.resolve([] as TeamWithMembers[]),
      ]);

      const stats = new Map<string, ActivityStat>();
      for (const a of activities) {
        stats.set(a.id, statFor(a, checkIns, results, roster, teams));
      }

      setData({
        course,
        weeks,
        roster,
        activities,
        questions,
        checkIns,
        results,
        teams,
        tfs,
        stats,
        can: capabilitiesFor(course, isOwner),
      });
    } finally {
      busy.current = false;
    }
  }, [courseId, courses, mode]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    loadCourses()
      .catch(fail)
      .finally(() => setReady(true));
  }, [loadCourses]);

  useEffect(() => {
    refresh().catch(fail);
  }, [refresh]);

  const selected = useMemo(
    () => data?.activities.find((a) => a.id === selId) ?? null,
    [data, selId],
  );

  // The activity vanished (deleted elsewhere) — do not strand the user on a
  // full-screen view with nothing behind it.
  //
  // NOT for one we just created. `data` is a snapshot taken before the insert,
  // so a brand-new activity is legitimately missing from it for one refresh —
  // and bouncing on that threw the instructor straight back to the list, which
  // looked exactly like "Activity" having done nothing at all. We know that one
  // exists; we are the ones who made it.
  useEffect(() => {
    if (fresh && fresh === selId) return;
    // Not until the restore has run either. A reload lands here with `screen`
    // already back on "detail" and `data` still loading, and bouncing on that
    // would undo the restore in the same tick it happened — the reload would
    // still dump you on the list, just for a different reason.
    if (!restored.current) return;
    if (FULL_SCREEN.includes(screen) && data && !selected) setScreen("activities");
  }, [screen, data, selected, fresh, selId]);

  const toGrade = useMemo(() => {
    if (!data) return 0;
    let n = 0;
    for (const s of data.stats.values()) n += s.waiting;
    return n;
  }, [data]);

  if (!isSupabaseConfigured) {
    return (
      <div className="fv">
        <div className="fv-main">
          <div className="fv-panel">
            <h1 className="fv-h1">Connect your database</h1>
            <p className="fv-sub" style={{ marginTop: 8, maxWidth: "60ch" }}>
              Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>, then restart
              the dev server. See <code>supabase/SETUP.md</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const openActivity = (id: string, opts?: { fresh?: boolean }) => {
    setSelId(id);
    // A just-created activity is a title and nothing else, so the page it lands
    // on opens its editor rather than showing an empty shell and waiting to be
    // asked. It is also created hidden, so nothing half-written is on a
    // student's list while it is being filled in.
    setFresh(opts?.fresh ? id : null);
    setScreen("detail");
  };

  const body = () => {
    if (!ready || !data) {
      return (
        <div className="fv-panel">
          {banner}
          <div className="fv-sub">{error ? "" : "Loading…"}</div>
        </div>
      );
    }
    switch (screen) {
      case "checkin":
        return data.can.runCheckIns ? <CheckInScreen data={data} /> : null;
      case "teams":
        return <TeamsScreen data={data} onChanged={() => refresh().catch(fail)} onError={fail} />;
      case "tfs":
        return data.can.manageTFs ? (
          <TFsScreen data={data} onChanged={() => refresh().catch(fail)} onError={fail} />
        ) : null;
      case "detail":
        // A just-created activity is not in `data` until the refresh lands.
        if (!selected && fresh && fresh === selId) {
          return (
            <div className="fv-panel">
              <div className="fv-sub">Opening the new activity…</div>
            </div>
          );
        }
        return selected ? (
          <ActivityDetail
            data={data}
            activity={selected}
            onBack={() => setScreen("activities")}
            fresh={fresh === selected.id}
            // Leaving the detail screen SPENDS the freshness. `fresh` means
            // "this activity was just created, open its editor" — a one-time
            // instruction, but it was surviving the trip to the rubric builder
            // and back, so returning re-opened the editor and blanked the title
            // again. Every time, that looked like the work had been thrown away.
            // Step 2 of creating one, so the freshness is NOT spent here —
            // it is what tells both screens they are in a sequence, and coming
            // back to step 1 has to find it still set. Finishing spends it.
            onRubric={() => setScreen("rubric")}
            onGrade={() => {
              setFresh(null);
              setScreen("grade");
            }}
            onCheckIn={() => {
              setFresh(null);
              setScreen("checkin");
            }}
            onDuplicate={() =>
              void (async () => {
                try {
                  const { activity: copy } = await duplicateActivity(selected, {
                    // The same week to begin with, and the copy lands on its own
                    // page with the week picker right there — which is where
                    // the choice belongs, and the only place that knows how to
                    // reposition a row that moves. Guessing "next week" here
                    // would be a second opinion about something one screen
                    // already owns.
                    week: selected.week ?? data.weeks[0]?.week ?? 1,
                    position: nextPositionIn(data.activities, selected.week ?? null),
                  });
                  // Before navigating: the detail screen looks the activity up
                  // in `data` and bounces if it is not there yet.
                  await refresh();
                  openActivity(copy.id, { fresh: true });
                } catch (e) {
                  fail(e);
                }
              })()
            }
            onChanged={() => refresh().catch(fail)}
            onError={fail}
          />
        ) : null;
      case "rubric":
        return selected ? (
          <RubricBuilder
            activity={selected}
            canEdit={data.can.author}
            wizard={fresh === selected.id}
            // Finish is what ends the sequence. Stepping back to the details
            // must not, or the strip vanishes under you halfway through.
            onDone={() => {
              setFresh(null);
              setScreen("detail");
            }}
            onStep1={() => setScreen("detail")}
            onChanged={() => refresh().catch(fail)}
            onError={fail}
          />
        ) : null;
      case "grade":
        return selected ? (
          <GradingScreen
            data={data}
            activity={selected}
            onBack={() => setScreen("detail")}
            onOpenCheckIn={() => {
              setFresh(null);
              setScreen("checkin");
            }}
            onChanged={() => refresh().catch(fail)}
            onError={fail}
          />
        ) : null;
      default:
        return (
          <ActivitiesScreen
            data={data}
            view={view}
            onView={setView}
            onOpen={openActivity}
            onChanged={() => refresh().catch(fail)}
            onError={fail}
          />
        );
    }
  };

  const full = FULL_SCREEN.includes(screen);

  // Every screen reports failures through `fail`. Until now that state was only
  // rendered while the app was still loading, so a rejected write on Activities,
  // detail, rubric or grading produced nothing at all on screen — which is
  // what made the rubric and check-in failures look like hangs.
  const banner = <FacultyError error={error} onClear={() => setError(null)} />;

  return (
    <div className="fv">
      {full ? (
        <div className="fv-gutter" />
      ) : (
        <aside className={`fv-sidebar${railed ? " collapsed" : ""}`}>
          {/* Everything above the account row lives in here so it can scroll on
              a short window, leaving Sign out anchored to the bottom instead of
              pushed past it. */}
          <div className="fv-sidetop">
          <div className="fv-railtop">
            <button
              type="button"
              className="fv-collapse"
              aria-label={railed ? "Expand the sidebar" : "Collapse the sidebar"}
              aria-expanded={!railed}
              title={railed ? "Expand the sidebar" : "Collapse the sidebar"}
              onClick={toggleRail}
            >
              <FIcon name={railed ? "chevronRight" : "chevronLeft"} size={16} />
            </button>
          </div>
          {/* The course name is the way home. It reads like a masthead and people
              click it like one — from four screens deep in grading there was
              otherwise no single control that meant "back to the class". */}
          <button
            type="button"
            className="fv-coursehome"
            title="Back to the class"
            onClick={() => {
              setScreen("activities");
              setSelId(null);
            }}
          >
            <span className="fv-coursetitle">{data?.course.name ?? "Applied Physics 50"}</span>
            <span className="fv-meta">
              <span>{data ? `${data.roster.length} students` : "—"}</span>
              {data?.course.term ? <span>· {data.course.term}</span> : null}
            </span>
          </button>

          {courses.length > 1 ? (
            <div className="fv-seg fv-courseswitch">
              {courses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={c.id === courseId ? "on" : ""}
                  onClick={() => {
                    setCourseId(c.id);
                    setScreen("activities");
                    setSelId(null);
                  }}
                >
                  {c.code ?? c.name}
                </button>
              ))}
            </div>
          ) : null}

          <nav className="fv-nav">
            {(
              [
                { id: "activities" as const, label: "Activities", icon: "assignment" },
                // Between Activities and Teams: it is what happens in the room,
                // and it reads off the teams below it.
                { id: "checkin" as const, label: "Check-in", icon: "check" },
                { id: "teams" as const, label: "Teams", icon: "groups" },
                { id: "tfs" as const, label: "TFs", icon: "school" },
              ] as const
            )
              // A TF who can only grade reads NO rows from tutorial_marks
              // (0016 gates reads on can_run_checkins_course), so the tab
              // painted a complete, plausible, entirely blank sheet — which
              // reads as "nothing has been marked yet" rather than "this is
              // not yours to see". Showing a control that always fails is the
              // thing worth avoiding.
              .filter((t) => t.id !== "tfs" || (data?.can.manageTFs ?? true))
              .filter((t) => t.id !== "checkin" || (data?.can.runCheckIns ?? true))
              .map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fv-navbtn${screen === t.id ? " on" : ""}`}
                onClick={() => setScreen(t.id)}
                title={railed ? t.label : undefined}
              >
                <FIcon name={t.icon} size={18} />
                <span className="fv-navlbl">{t.label}</span>
                {t.id === "activities" && toGrade > 0 ? (
                  <>
                    <span className="fv-navcount">{toGrade} to grade</span>
                    {/* The count has nowhere to go on the rail, or on the top
                        strip a phone gets, but "there is work waiting" is the
                        part worth keeping. Both ship and CSS picks — the hidden
                        one is display:none, so it leaves the accessibility tree
                        with the pixels and nothing is announced twice. */}
                    <span className="fv-navdot" aria-label={`${toGrade} to grade`} />
                  </>
                ) : null}
              </button>
            ))}
          </nav>

          {data && !data.can.isOwner ? (
            <div className="fv-tfnote">
              You are a teaching fellow on this course. {tfNote(data.can)}
            </div>
          ) : null}

          </div>

          <div className="fv-sidefoot">
            <span className="fv-email" title={account}>
              {account ?? "Signed in"}
            </span>
            {onSignOut ? (
              <button
                type="button"
                className="fv-btn outline sm fv-signout"
                onClick={() => void onSignOut()}
                title={account ?? "Sign out"}
              >
                {railed ? "Out" : "Sign out"}
              </button>
            ) : null}
          </div>
        </aside>
      )}

      <div className="fv-main">
        {error ? (
          <div style={{ position: "absolute", inset: "18px 24px auto 24px", zIndex: 20 }}>
            {banner}
          </div>
        ) : null}
        {body()}
      </div>
    </div>
  );
}

/** A banner for write failures — the screens report through `onError`. */
export function FacultyError({ error, onClear }: { error: string | null; onClear: () => void }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        marginBottom: 12,
        border: "1px solid var(--fv-neutral-200)",
        background: "var(--fv-cream-100)",
        borderRadius: "var(--fv-r-md)",
        fontSize: "var(--fv-xs)",
        color: "var(--fv-destructive)",
      }}
    >
      <span style={{ flex: 1 }}>{error}</span>
      <button type="button" className="fv-iconbtn" style={{ width: 22, height: 22 }} onClick={onClear}>
        <FIcon name="close" size={14} />
      </button>
    </div>
  );
}
