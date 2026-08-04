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
  CheckInResult,
  Course,
  CourseTF,
  CourseWeek,
  Student,
  TeamWithMembers,
} from "@/checkins/types";
import { listTFs, listWeeks } from "./facultyData";
import { statFor, type ActivityStat } from "./model";
import { FIcon } from "./icons";
import { ActivitiesScreen } from "./ActivitiesScreen";
import { ActivityDetail } from "./ActivityDetail";
import { CriteriaEditor } from "./CriteriaEditor";
import { GradingScreen } from "./GradingScreen";
import { TeamsScreen } from "./TeamsScreen";
import { TFsScreen } from "./TFsScreen";
import "./faculty.css";

export type Screen = "activities" | "teams" | "tfs" | "detail" | "criteria" | "grade";

/** Everything the screens read. Loaded once here, refreshed on any write. */
export interface FacultyData {
  course: Course;
  weeks: CourseWeek[];
  roster: Student[];
  activities: Activity[];
  checkIns: CheckIn[];
  results: CheckInResult[];
  teams: TeamWithMembers[];
  tfs: CourseTF[];
  /** Keyed by activity id — the one derived object both views read. */
  stats: Map<string, ActivityStat>;
}

const FULL_SCREEN: Screen[] = ["detail", "criteria", "grade"];

export function FacultyApp({
  account,
  onSignOut,
}: {
  account?: string;
  onSignOut?: () => Promise<void>;
}) {
  const [screen, setScreen] = useState<Screen>("activities");
  const [view, setView] = useState<"rows" | "columns">("rows");
  const [selId, setSelId] = useState<string | null>(null);

  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [data, setData] = useState<FacultyData | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const fail = (e: unknown) => setError(String((e as Error)?.message ?? e));

  const loadCourses = useCallback(async () => {
    const cs = await ensureSessions();
    setCourses(cs);
    setCourseId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : (cs[0]?.id ?? null)));
  }, []);

  const refresh = useCallback(async () => {
    if (!courseId) return;
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;
    if (busy.current) return;
    busy.current = true;
    try {
      const [roster, activities, weeks, sets, tfs] = await Promise.all([
        listStudents(courseId),
        listActivities(courseId),
        listWeeks(courseId),
        listTeamSets(courseId),
        listTFs(courseId),
      ]);
      const checkIns = activities.length ? await listCheckIns(activities.map((a) => a.id)) : [];
      const results = checkIns.length ? await listResults(checkIns.map((c) => c.id)) : [];

      // The gradebook needs ONE set of teams. Our team sets are per-activity, so
      // prefer a course-wide set and fall back to the most recent — the design
      // assumes a single stable roster of teams and this is the closest honest
      // reading of it.
      const set = sets.find((s) => s.activity_id == null) ?? sets[sets.length - 1] ?? null;
      const teams = set ? await listTeams(set.id, roster) : [];

      const stats = new Map<string, ActivityStat>();
      for (const a of activities) {
        stats.set(a.id, statFor(a, checkIns, results, roster, teams));
      }

      setData({ course, weeks, roster, activities, checkIns, results, teams, tfs, stats });
    } finally {
      busy.current = false;
    }
  }, [courseId, courses]);

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
  useEffect(() => {
    if (FULL_SCREEN.includes(screen) && data && !selected) setScreen("activities");
  }, [screen, data, selected]);

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

  const openActivity = (id: string) => {
    setSelId(id);
    setScreen("detail");
  };

  const body = () => {
    if (!ready || !data) {
      return (
        <div className="fv-panel">
          <div className="fv-sub">{error ?? "Loading…"}</div>
        </div>
      );
    }
    switch (screen) {
      case "teams":
        return <TeamsScreen data={data} onChanged={() => void refresh().catch(fail)} onError={fail} />;
      case "tfs":
        return <TFsScreen data={data} onChanged={() => void refresh().catch(fail)} onError={fail} />;
      case "detail":
        return selected ? (
          <ActivityDetail
            data={data}
            activity={selected}
            onBack={() => setScreen("activities")}
            onCriteria={() => setScreen("criteria")}
            onGrade={() => setScreen("grade")}
            onChanged={() => void refresh().catch(fail)}
            onError={fail}
          />
        ) : null;
      case "criteria":
        return selected ? (
          <CriteriaEditor activity={selected} onDone={() => setScreen("detail")} onError={fail} />
        ) : null;
      case "grade":
        return selected ? (
          <GradingScreen
            data={data}
            activity={selected}
            onBack={() => setScreen("detail")}
            onChanged={() => void refresh().catch(fail)}
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
            onChanged={() => void refresh().catch(fail)}
            onError={fail}
          />
        );
    }
  };

  const full = FULL_SCREEN.includes(screen);

  return (
    <div className="fv">
      {full ? (
        <div style={{ width: 12, flex: "0 0 12px" }} />
      ) : (
        <aside className="fv-sidebar">
          <div className="fv-coursetitle">{data?.course.name ?? "Applied Physics 50"}</div>
          <div className="fv-meta">
            <span>{data ? `${data.roster.length} students` : "—"}</span>
            {data?.course.term ? <span>· {data.course.term}</span> : null}
          </div>

          {courses.length > 1 ? (
            <div className="fv-seg" style={{ marginTop: 12 }}>
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
                { id: "teams" as const, label: "Teams", icon: "groups" },
                { id: "tfs" as const, label: "TFs", icon: "school" },
              ]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fv-navbtn${screen === t.id ? " on" : ""}`}
                onClick={() => setScreen(t.id)}
              >
                <FIcon name={t.icon} size={18} />
                {t.label}
                {t.id === "activities" && toGrade > 0 ? (
                  <span className="fv-navcount">{toGrade} to grade</span>
                ) : null}
              </button>
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          <div className="fv-sidefoot">
            <span className="fv-email" title={account}>
              {account ?? "Signed in"}
            </span>
            {onSignOut ? (
              <button
                type="button"
                className="fv-btn outline sm"
                style={{ height: 26, padding: "0 10px", fontSize: "var(--fv-2xs)" }}
                onClick={() => void onSignOut()}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </aside>
      )}

      <div className="fv-main">{body()}</div>
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
