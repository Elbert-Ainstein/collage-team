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
  renameCourse,
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
  CheckIn,
  Course,
  CourseTF,
  CourseWeek,
  Student,
  TeamWithMembers,
} from "@/checkins/types";
import type { ResultRow } from "@/checkins/data";
import {
  canWriteRubric,
  duplicateActivity,
  listQuestionsFor,
  listTFs,
  listWeeks,
  myTFCourses,
} from "./facultyData";
import { nextPositionIn, statFor, type ActivityStat, type PointedQuestion } from "./model";
import { FIcon } from "./icons";
import { ActivitiesScreen } from "./ActivitiesScreen";
import { ActivityDetail } from "./ActivityDetail";
import { CheckInScreen } from "./CheckInScreen";
import { GradingScreen } from "./GradingScreen";
import { ReviewScreen } from "./ReviewScreen";
import { reviewCount } from "./reviewModel";
import { RubricBuilder } from "./RubricBuilder";
import { TeamsScreen } from "./TeamsScreen";
import { TFsScreen } from "./TFsScreen";
import "./faculty.css";

export type Screen =
  | "activities"
  | "checkin"
  | "review"
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
  /** Create and edit activities and weeks: what they are called, out of, and attach. */
  author: boolean;
  /** Put marks on submissions. */
  grade: boolean;
  /**
   * Send a grade to the student. The instructor's alone (0038): a TF who
   * grades sends their marks for review, and the instructor releases them
   * from the Review tab once they have looked.
   */
  release: boolean;
  /**
   * Write criteria and questions. Follows grading (0036): the person marking
   * is the person who finds the rung worded wrong, and the criteria are the
   * same judgement the grading switch already trusts, written down once.
   */
  rubric: boolean;
  /** Post and unpost check-ins to students, and set which week is live. */
  runCheckIns: boolean;
  /** Add, remove and email students; form teams. */
  manageRoster: boolean;
  /** See and change the TF roster and its permissions. */
  manageTFs: boolean;
}

export function capabilitiesFor(
  course: Course,
  isOwner: boolean,
  /** The database's own answer (0037), or null when it cannot be asked yet. */
  rubric: boolean | null = null,
): Capabilities {
  return {
    isOwner,
    author: isOwner,
    grade: isOwner || course.tf_can_grade,
    release: isOwner,
    rubric: isOwner || (rubric ?? course.tf_can_grade),
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
  const rest = "the instructor reviews and releases grades, and edits activities and the roster.";
  const grade = can.rubric ? "grade submissions and edit rubrics" : "grade submissions";
  if (can.grade && can.runCheckIns) {
    return `You can ${grade}, post check-ins and set the live week; ${rest}`;
  }
  if (can.grade) return `You can ${grade}; ${rest}`;
  if (can.runCheckIns) return `You can post check-ins and set the live week, but not grade; ${rest}`;
  return "Grading and check-ins are both turned off for TFs on this course, so this view is read-only.";
}

/** Everything the screens read. Loaded once here, refreshed on any write. */
export interface FacultyData {
  course: Course;
  weeks: CourseWeek[];
  roster: Student[];
  activities: Activity[];
  /**
   * Every activity's questions (0014), each with what it is out of (0034).
   * Empty for an activity that has none yet.
   */
  questions: PointedQuestion[];
  checkIns: CheckIn[];
  /**
   * Narrow rows: no `text`, no `transcription`, no `files`. Nothing on the
   * faculty side reads a student's words off this list — it reads status,
   * score, whose it is and when — and this list is re-read after every write,
   * so carrying a term of written answers through it was the widest thing the
   * app did. A screen that shows somebody's words fetches that one submission.
   */
  results: ResultRow[];
  teams: TeamWithMembers[];
  tfs: CourseTF[];
  /** Keyed by activity id — the one derived object both views read. */
  stats: Map<string, ActivityStat>;
  can: Capabilities;
}

const FULL_SCREEN: Screen[] = ["detail", "rubric", "grade"];
/**
 * Screens where `a` on the URL is the activity being shown. The full screens,
 * plus Check-in once a sheet is open: a reload mid-tutorial has to land back
 * on that sheet, not on the picker.
 */
const WITH_ACTIVITY: Screen[] = [...FULL_SCREEN, "checkin"];

const SCREENS: string[] = [
  "activities",
  "checkin",
  "review",
  "teams",
  "tfs",
  "detail",
  "rubric",
  "grade",
];

/**
 * Where you are, written on the URL: /ck?s=<screen>&a=<activity>&c=<course>.
 *
 * Query params rather than nested routes because /ck is one route that decides
 * which app you get from your enrolment — a student and an instructor opening
 * the SAME link each land on their own view of that activity, which is the
 * whole point of a link you can paste into Canvas once.
 *
 * Params this app does not own are left alone. AuthGate parks a class code at
 * ?join= across sign-in and spends it later; rewriting the query from scratch
 * here would eat it.
 */
export function readWhere(): {
  screen: Screen | null;
  selId: string | null;
  courseId: string | null;
} {
  const q = new URLSearchParams(window.location.search);
  const s = q.get("s") ?? "";
  return {
    screen: SCREENS.includes(s) ? (s as Screen) : null,
    selId: q.get("a"),
    courseId: q.get("c"),
  };
}

export function writeWhere(
  at: { screen: Screen; selId: string | null; courseId: string | null },
  mode: "push" | "replace",
) {
  const q = new URLSearchParams(window.location.search);
  // The default screen is a bare /ck, so the common URL stays short and the
  // one somebody copies off a deep screen is visibly about that screen.
  if (at.screen === "activities") q.delete("s");
  else q.set("s", at.screen);
  // Only where an activity is what the screen is showing. Carrying the last
  // selection onto the week list would make a copied URL promise a page the
  // person copying it was not looking at.
  if (at.selId && WITH_ACTIVITY.includes(at.screen)) q.set("a", at.selId);
  else q.delete("a");
  if (at.courseId) q.set("c", at.courseId);
  else q.delete("c");
  const qs = q.toString();
  const url = window.location.pathname + (qs ? "?" + qs : "");
  const state: unknown = window.history.state;
  if (mode === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
}

/**
 * The link to paste into Canvas. Includes the course so an instructor who
 * teaches AP50A and AP50B opens the right one; a student's app ignores `c`
 * because their enrolment already decided it.
 */
export function linkToActivity(id: string, courseId?: string | null): string {
  const q = new URLSearchParams({ s: "detail", a: id });
  if (courseId) q.set("c", courseId);
  return `${window.location.origin}${window.location.pathname}?${q.toString()}`;
}

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
  uid,
  mode = "owner",
}: {
  account?: string;
  /**
   * The signed-in account's id. Load-bearing rather than decorative: it is what
   * decides, PER COURSE, whether this person owns the one they are looking at.
   */
  uid?: string;
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
  /** The activity the URL asked for, so a dead link can be named as one. */
  const linked = useRef<string | null>(null);
  /** The page the restore below decided on, so the URL sync can tell it has landed. */
  const landing = useRef("activities|");
  useEffect(() => {
    try {
      // THE URL WINS. sessionStorage is where a plain reload finds its way
      // back; a pasted link is somebody telling us where to go, and letting the
      // restore run first would have it overwritten a tick later by wherever
      // this tab happened to be yesterday.
      const url = readWhere();
      if (url.screen || url.selId) {
        // An `a` with no `s` is a trimmed link, and an activity id can only
        // have meant its page.
        const target = url.screen ?? "detail";
        setScreen(target);
        setSelId(url.selId);
        linked.current = url.selId;
        landing.current = `${target}|${url.selId ?? ""}`;
        // A course this account cannot see falls back to their first one:
        // loadCourses keeps the previous id only when it is in the list.
        if (url.courseId) setCourseId(url.courseId);
        return;
      }

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
      landing.current = `${at.screen ?? "activities"}|${at.selId ?? ""}`;
    } catch {
      // Unparseable or refused storage: start where the app started before any
      // of this, which is the week list.
    } finally {
      restored.current = true;
    }
  }, []);

  // Back and forward. The URL is applied to state rather than left to the
  // browser, because a reload here is nine round trips — the perf pass exists
  // to stop paying them and back must not quietly reintroduce the bill.
  const popped = useRef(false);
  useEffect(() => {
    const onPop = () => {
      const at = readWhere();
      popped.current = true;
      setScreen(at.screen ?? (at.selId ? "detail" : "activities"));
      setSelId(at.selId);
      if (at.courseId) setCourseId(at.courseId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Set by a correction, so being sent home does not become a place to go back to. */
  const replaceNext = useRef(false);
  const lastPage = useRef<string | null>(null);
  useEffect(() => {
    // Not until the restore has run, or the initial "activities" overwrites the
    // thing we are about to read back.
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem("fv-where", JSON.stringify({ screen, selId, courseId }));
    } catch {
      // A browser refusing storage just means a reload starts at the list.
    }

    const page = `${screen}|${selId ?? ""}`;

    // A state change that CAME from the URL is not written back to it — that is
    // how back turns into a loop that cannot leave the page.
    if (popped.current) {
      popped.current = false;
      lastPage.current = page;
      return;
    }

    if (lastPage.current === null) {
      // Still on the mount commit. This effect runs in the same pass as the
      // restore above, which has QUEUED its state and not had it applied, so
      // the values here are the pre-restore ones — writing them would erase the
      // very link we arrived on. Wait for the commit that matches what the
      // restore asked for, then say it once, as a replace: you are already on
      // that URL and it must not become somewhere to go back to.
      if (page !== landing.current) return;
      lastPage.current = page;
      writeWhere({ screen, selId, courseId }, "replace");
      return;
    }

    // A history entry per PAGE — the screen and the activity on it. Everything
    // else replaces: the course id arriving from loadCourses a beat after the
    // page did, and any bounce off a page that turned out not to exist. Pushing
    // those would make back press three times to do one thing, which traps
    // people harder than having no back at all.
    const moved = page !== lastPage.current;
    writeWhere({ screen, selId, courseId }, moved && !replaceNext.current ? "push" : "replace");
    lastPage.current = page;
    replaceNext.current = false;
  }, [screen, selId, courseId]);
  const [data, setData] = useState<FacultyData | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namingCourse, setNamingCourse] = useState(false);
  const [courseDraft, setCourseDraft] = useState("");
  const busy = useRef(false);
  // A refresh asked for while one is running. It cannot just be dropped: the
  // write that asked for it has already landed in the database, so dropping it
  // leaves the screen permanently disagreeing with the row — and worse, a
  // course switch made during a load was dropped the same way, leaving the
  // sidebar highlighting AP50B while the pane showed AP50A with nothing that
  // would ever correct it. Queue one and run it at the end instead.
  const again = useRef(false);

  const fail = (e: unknown) => setError(String((e as Error)?.message ?? e));

  // Renaming touches the courses row, which is the one thing loadCourses owns
  // rather than refresh() — so both have to be re-read or the sidebar keeps the
  // old name until a reload.
  const commitCourseName = () => {
    const next = courseDraft.trim();
    setNamingCourse(false);
    if (!data || !next || next === data.course.name) return;
    void (async () => {
      try {
        await renameCourse(data.course.id, { name: next });
        await loadCourses();
        await refresh();
      } catch (e) {
        fail(e);
      }
    })();
  };

  /**
   * Every course this account can work on — the ones it owns AND the ones it
   * helps teach.
   *
   * These used to be alternatives: `mode === "tf" ? myTFCourses() : ensureSessions()`.
   * That was fine while an account was one or the other, and a lockout the
   * moment somebody was both — an instructor who also TFs for a colleague was
   * routed to the TF app by app/ck (the TF test runs first), and the TF app
   * loaded only TF courses, so HER OWN COURSE became invisible with no way back
   * from inside the app.
   *
   * ensureSessions still only runs for an account that owns nothing, so a pure
   * TF is never handed a course of their own to bootstrap.
   */
  const loadCourses = useCallback(async () => {
    const [owned, helping] = await Promise.all([
      // Owned only. listCourses reads through the enrolment and TF policies as
      // well, so unfiltered it would hand this list a course she is a STUDENT on
      // and the faculty app would try to run it.
      mode === "tf"
        ? listCourses().then((cs) => cs.filter((c) => c.owner_id === uid))
        : ensureSessions(),
      myTFCourses().catch(() => [] as Course[]),
    ]);
    // Owned first, and owned wins on a tie: being a TF on a course you own is a
    // row somebody could add, and it must not downgrade what you can do there.
    const byId = new Map<string, Course>();
    for (const c of [...owned, ...helping]) if (!byId.has(c.id)) byId.set(c.id, c);
    const cs = [...byId.values()];
    setCourses(cs);
    setCourseId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : (cs[0]?.id ?? null)));
  }, [mode]);

  // Lets the queued re-run above call the CURRENT refresh rather than the one
  // captured when this closure was built — a course switch is exactly the case
  // where those differ, and re-running the stale one would reload the course
  // you just left.
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  /** The data on screen, readable without making every callback depend on it. */
  const dataRef = useRef<FacultyData | null>(null);

  const refresh = useCallback(async () => {
    if (!courseId) return;
    const known = courses.find((c) => c.id === courseId);
    if (!known) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      // A fact about THIS course, not about the account. capabilitiesFor has
      // always taken it per course; it was being handed one app-wide answer,
      // which is what made "you are a TF somewhere" mean "you are a TF
      // everywhere" — including on the course you own.
      // Without a uid — the unconfigured-Supabase path renders FacultyApp with no
      // props at all — fall back to the session-wide mode rather than deciding
      // nobody owns anything.
      const isOwner = uid ? known.owner_id === uid : mode === "owner";

      const [allCourses, roster, activities, weeks, sets, tfs, rubric] = await Promise.all([
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
        // The owner always may; only a TF needs the database's answer, and a
        // refused lookup must not sink the whole load over a pencil.
        isOwner ? Promise.resolve(true) : canWriteRubric(courseId).catch(() => null),
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
        (async (): Promise<[CheckIn[], ResultRow[]]> => {
          const cs = activities.length ? await listCheckIns(activities.map((a) => a.id)) : [];
          const rs = cs.length ? await listResults(cs.map((c) => c.id)) : [];
          return [cs, rs];
        })(),
        // Loaded here rather than per screen: the activity page prints what an
        // activity is out of, and so does the gradebook, and those two numbers
        // disagreeing is the failure this whole module is written to avoid.
        activities.length
          ? listQuestionsFor(activities.map((a) => a.id))
          : Promise.resolve([] as PointedQuestion[]),
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
        can: capabilitiesFor(course, isOwner, rubric),
      });
    } finally {
      busy.current = false;
    }
    // Outside the finally, and after the flag is down, so the queued run is a
    // fresh call rather than recursion inside a try it would inherit. One
    // re-run however many were asked for — they would all have read the same
    // rows.
    if (again.current) {
      again.current = false;
      await refreshRef.current?.();
    }
  }, [courseId, courses, mode]);

  /**
   * Re-read only what a MARK can have changed.
   *
   * Grading is the one screen where a write happens every few seconds — a
   * rubric pick, a release, a note — and each was calling the full refresh:
   * eleven reads across eight tables, re-fetching the roster, the weeks, the
   * team sets, the TF list, the questions and the teams, none of which a mark
   * can touch. Two reads instead, and it patches what it read into the data
   * already on screen rather than rebuilding it.
   *
   * Stats are recomputed because they are derived from results and would
   * otherwise keep counting the old ones — the whole point of the round trip is
   * the number in the progress card moving.
   *
   * The `busy` flag is deliberately NOT taken. This is cheap, it overlaps a
   * full refresh harmlessly (both write the same rows from the same source),
   * and making a mark wait on a course reload is the thing being removed.
   */
  const refreshResults = useCallback(async () => {
    const cur = dataRef.current;
    if (!cur) return;
    const checkIns = cur.activities.length
      ? await listCheckIns(cur.activities.map((a) => a.id))
      : [];
    const results = checkIns.length ? await listResults(checkIns.map((c) => c.id)) : [];
    const stats = new Map<string, ActivityStat>();
    for (const a of cur.activities) {
      stats.set(a.id, statFor(a, checkIns, results, cur.roster, cur.teams));
    }
    setData((d) => (d ? { ...d, checkIns, results, stats } : d));
  }, []);

  // Kept pointing at the latest refresh, so a queued re-run picks up the course
  // that is selected NOW rather than the one that was selected when the run it
  // is following started.
  refreshRef.current = refresh;
  dataRef.current = data;

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
    // The linked activity turned up, so it is no longer the thing being explained.
    if (selected) linked.current = null;
    if (!FULL_SCREEN.includes(screen) || !data || selected) return;
    // A correction, not a destination: replaced rather than pushed, so back does
    // not lead to the page that just turned out not to be there and bounce again.
    replaceNext.current = true;
    // Say so when it was a LINK that pointed here. Bouncing silently is fine for
    // an activity deleted in another tab — you were just looking at it — but
    // somebody arriving from Canvas has no idea they were sent anywhere.
    if (linked.current && linked.current === selId) {
      setError(
        "That link points to an activity that isn't on this course. It may have been deleted, or the link was for a different class.",
      );
    }
    linked.current = null;
    setScreen("activities");
  }, [screen, data, selected, fresh, selId]);

  // A link to a screen this account is not allowed on. The sidebar hides both
  // buttons, so the only ways here are a pasted URL and the instructor moving a
  // TF permission while somebody is standing on the screen — and body() returns
  // null for exactly this case, which is a blank panel and no explanation.
  useEffect(() => {
    if (!data) return;
    const shut =
      (screen === "checkin" && !data.can.runCheckIns) ||
      (screen === "tfs" && !data.can.manageTFs) ||
      (screen === "review" && !data.can.release);
    if (!shut) return;
    replaceNext.current = true;
    setError(
      screen === "checkin"
        ? "Check-ins are turned off for teaching fellows on this course, so that link has nothing to open."
        : screen === "review"
          ? "Only the instructor reviews and releases grades, so that link has nothing to open."
          : "Only the instructor can see the TF roster, so that link has nothing to open.",
    );
    setScreen("activities");
  }, [screen, data]);

  const toGrade = useMemo(() => {
    if (!data) return 0;
    let n = 0;
    for (const s of data.stats.values()) n += s.waiting;
    return n;
  }, [data]);
  const toReview = useMemo(() => (data ? reviewCount(data.results) : 0), [data]);

  /**
   * Whose work the grading page opens on, when it was reached from the Review
   * tab. Cleared on the way out so the next visit starts at the top as usual.
   */
  const [gradeFocus, setGradeFocus] = useState<{
    subjectId: string;
    kind: "individual" | "team";
  } | null>(null);
  useEffect(() => {
    if (screen !== "grade") setGradeFocus(null);
  }, [screen]);

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

  /**
   * Check-in's picker and back button. Stable, because it sits in an effect's
   * dependencies over there — a fresh closure per render would re-run that
   * effect on every unrelated change up here.
   */
  const openCheckIn = useCallback((id: string | null, opts?: { correction?: boolean }) => {
    // Being sent back to the picker is not a place to go back to.
    if (opts?.correction) replaceNext.current = true;
    setSelId(id);
  }, []);

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
        return data.can.runCheckIns ? (
          <CheckInScreen data={data} selId={selId} onOpen={openCheckIn} />
        ) : null;
      case "review":
        return data.can.release ? (
          <ReviewScreen
            data={data}
            onOpen={(activityId, subjectId, kind) => {
              setGradeFocus({ subjectId, kind });
              setFresh(null);
              setSelId(activityId);
              setScreen("grade");
            }}
            onChanged={() => refreshResults().catch(fail)}
            onError={fail}
          />
        ) : null;
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
            canEdit={data.can.rubric}
            canAuthor={data.can.author}
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
            focus={gradeFocus}
            onBack={() => setScreen("detail")}
            onOpenCheckIn={() => {
              setFresh(null);
              setScreen("checkin");
            }}
            // A mark, a release and a note can change results and nothing else,
            // so this screen re-reads results and nothing else. Every other
            // screen keeps the full refresh, because what they write really can
            // move the roster, the weeks, the teams or the questions.
            onChanged={() => refreshResults().catch(fail)}
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
              <FIcon name={railed ? "panelLeftClosed" : "panelLeft"} size={17} />
            </button>
          </div>
          {/* The course name is the way home. It reads like a masthead and people
              click it like one — from four screens deep in grading there was
              otherwise no single control that meant "back to the class". */}
          {namingCourse && data ? (
            <input
              className="fv-in"
              style={{ width: "100%", height: 34, fontFamily: "var(--fv-serif)", fontSize: 19 }}
              value={courseDraft}
              autoFocus
              aria-label="Course name"
              onChange={(e) => setCourseDraft(e.target.value)}
              onBlur={commitCourseName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCourseName();
                if (e.key === "Escape") setNamingCourse(false);
              }}
            />
          ) : (
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
                {/* Rename lives inside the meta line rather than beside the
                    title: the title is the way home, and a second control on it
                    makes the target for that ambiguous. Owner only — a TF is a
                    guest on somebody else's course. */}
                {data?.can.isOwner ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="fv-courserename"
                    title="Rename this course"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCourseDraft(data.course.name);
                      setNamingCourse(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      setCourseDraft(data.course.name);
                      setNamingCourse(true);
                    }}
                  >
                    · Rename
                  </span>
                ) : null}
              </span>
            </button>
          )}

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
                  {/* Which of these is YOURS. The switcher can now hold both
                      your own courses and ones you help teach, and those give
                      you very different buttons on the screens behind them —
                      finding that out by discovering a control is missing is
                      the wrong way round. */}
                  {uid && c.owner_id !== uid ? (
                    <span className="fv-helping" title="You are a teaching fellow on this course">
                      TF
                    </span>
                  ) : null}
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
                // The instructor's in-tray: what the TFs have marked, waiting
                // to go out. Sits after the marking and before the roster.
                { id: "review" as const, label: "Review", icon: "assignment" },
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
              .filter((t) => t.id !== "review" || (data?.can.release ?? true))
              .map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fv-navbtn${screen === t.id ? " on" : ""}`}
                onClick={() => {
                  // The tab is the picker. The activity on the URL is
                  // whichever one was last open on a full screen, and
                  // arriving on its sheet from a tab labelled "Check-in"
                  // would be a sheet nobody chose.
                  if (t.id === "checkin") setSelId(null);
                  setScreen(t.id);
                }}
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
                {t.id === "review" && toReview > 0 ? (
                  <>
                    <span className="fv-navcount">{toReview} waiting</span>
                    <span className="fv-navdot" aria-label={`${toReview} waiting for review`} />
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
