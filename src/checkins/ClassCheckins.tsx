"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { Icon } from "./icons";
import {
  addStudents,
  listActivities,
  ensureSessions,
  listStudents,
  listCheckIns,
  listTeamSets,
  removeStudent,
} from "./data";
import type { Activity, Course, Student } from "./types";
import { isSupportedRosterFile, parseRoster, type ParsedStudent } from "./rosterImport";
import { Avatar, ErrorBanner } from "./ui";
import { TeamsPillar } from "./TeamsPillar";
import { GradebookPillar } from "./GradebookPillar";
import { ActivitiesPillar } from "./ActivitiesPillar";
import "./checkins.css";

type Tab = "roster" | "activities" | "checkins";

// Three pages. Roster and Teams share one — you cannot form teams before there
// are students, so they belong in sequence on the same page.
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "roster", label: "Roster & Teams", icon: "teams" },
  { id: "activities", label: "Activities", icon: "clipboard" },
  { id: "checkins", label: "Check-ins", icon: "table" },
];

export function ClassCheckins() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Student[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tab, setTab] = useState<Tab>("roster");
  const [hasTeams, setHasTeams] = useState(false);
  const [hasCheckIns, setHasCheckIns] = useState(false);
  /**
   * Team setup stays hidden until the roster is called done — building teams
   * while students are still being added is premature. Kept per session in
   * localStorage (a workflow preference, not course data); an existing team set
   * implies it, so it is never asked twice on a set-up session.
   */
  const [rosterConfirmed, setRosterConfirmed] = useState(false);
  /** Only auto-pick the opening tab once per class, never after the user navigates. */
  const landedFor = useRef<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [narrow, setNarrow] = useState(false);

  const course = courses.find((c) => c.id === courseId) ?? null;
  const fail = (e: unknown) => setError(String((e as Error)?.message ?? e));

  // Single-course tool: the AP50A / AP50B sessions are provisioned, never created
  // by hand, so there is no new/delete-session UI.
  const loadCourses = useCallback(async () => {
    const cs = await ensureSessions();
    setCourses(cs);
    setCourseId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : cs[0]?.id ?? null));
    return cs;
  }, []);

  /** Re-fetch course-level data shared across pillars. */
  const refresh = useCallback(async () => {
    if (!courseId) {
      setRoster([]);
      setActivities([]);
      setHasTeams(false);
      setHasCheckIns(false);
      return;
    }
    const [r, a, ts] = await Promise.all([
      listStudents(courseId),
      listActivities(courseId),
      listTeamSets(courseId),
    ]);
    setRoster(r);
    setActivities(a);
    setHasTeams(ts.length > 0);
    const cis = a.length ? await listCheckIns(a.map((x) => x.id)) : [];
    setHasCheckIns(cis.length > 0);

    // Open on the first unfinished step so a new class starts at the roster and
    // a set-up class starts on the gradebook.
    if (landedFor.current !== courseId) {
      landedFor.current = courseId;
      // Open on the first unfinished step; a fully set-up session opens on the
      // gradebook, which is also where the last step (adding check-ins) happens.
      setTab(
        r.length === 0 || ts.length === 0 ? "roster" : a.length === 0 ? "activities" : "checkins",
      );
    }
  }, [courseId]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    loadCourses().catch(fail).finally(() => setReady(true));
  }, [loadCourses]);

  useEffect(() => {
    refresh().catch(fail);
  }, [refresh]);

  useEffect(() => {
    if (!courseId) return;
    const stored = window.localStorage.getItem(`ck.rosterConfirmed.${courseId}`) === "1";
    setRosterConfirmed(stored || hasTeams);
  }, [courseId, hasTeams]);

  const confirmRoster = () => {
    if (courseId) window.localStorage.setItem(`ck.rosterConfirmed.${courseId}`, "1");
    setRosterConfirmed(true);
  };

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 820);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.setAttribute("data-theme", theme);
    else root.removeAttribute("data-theme");
  }, [theme]);
  const dark =
    theme === "dark" ||
    (theme === null &&
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches));


  // ---------- gates ----------
  if (!isSupabaseConfigured) {
    return (
      <Frame dark={dark} onTheme={() => setTheme(dark ? "light" : "dark")}>
        <div className="t-card" style={{ padding: 22, maxWidth: 560, margin: "0 auto" }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700 }}>
            Connect your database
          </div>
          <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6, maxWidth: "60ch" }}>
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
            in <code>.env.local</code>, then restart the dev server. See{" "}
            <code>supabase/SETUP.md</code>.
          </div>
        </div>
      </Frame>
    );
  }

  if (!ready) {
    return (
      <Frame dark={dark} onTheme={() => setTheme(dark ? "light" : "dark")}>
        <div style={{ color: "var(--ink2)" }}>Loading…</div>
      </Frame>
    );
  }

  if (!course) {
    return (
      <Frame dark={dark} onTheme={() => setTheme(dark ? "light" : "dark")}>
        <ErrorBanner error={error} />
        <div className="t-card" style={{ padding: 22, maxWidth: 560, margin: "0 auto" }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700 }}>
            Couldn’t load the AP 50 sessions
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 6 }}>
            The app provisions AP50A and AP50B automatically. Check the database connection and
            reload.
          </div>
        </div>
      </Frame>
    );
  }

  // ---------- main app ----------
  const pillarProps = { courseId: course.id, roster, activities, refresh };

  const body = (
    <>
      <ErrorBanner error={error} />
      <SetupGuide
        roster={roster}
        activities={activities}
        hasTeams={hasTeams}
        hasCheckIns={hasCheckIns}
        onGo={setTab}
      />
      {tab === "roster" && (
        <>
          <RosterEditor
            course={course}
            roster={roster}
            onChanged={() => void refresh().catch(fail)}
            onError={fail}
          />
          {rosterConfirmed ? (
            <div style={{ marginTop: 26 }}>
              <TeamsPillar {...pillarProps} />
            </div>
          ) : roster.length > 0 ? (
            <div
              className="t-card"
              style={{
                marginTop: 22,
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
                background: "var(--paper3)",
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 700 }}>
                  Roster complete?
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 3 }}>
                  {roster.length} student{roster.length === 1 ? "" : "s"} added. Confirm to start
                  building teams — you can still add or remove students afterwards.
                </div>
              </div>
              <button className="t-btn primary" onClick={confirmRoster}>
                Confirm roster → build teams
              </button>
            </div>
          ) : null}
        </>
      )}
      {tab === "activities" && <ActivitiesPillar {...pillarProps} />}
      {tab === "checkins" && <GradebookPillar {...pillarProps} />}
    </>
  );

  const nav = (bottom: boolean) =>
    TABS.map((t) => (
      <button
        key={t.id}
        className={(bottom ? "t-bnbtn" : "t-navbtn") + (tab === t.id ? " on" : "")}
        onClick={() => setTab(t.id)}
      >
        <Icon name={t.icon} size={bottom ? 19 : 18} />
        <span className={bottom ? undefined : "lbl"}>{t.label}</span>
      </button>
    ));

  const themeBtn = (
    <button className="t-themebtn" onClick={() => setTheme(dark ? "light" : "dark")}>
      <Icon name={dark ? "sun" : "moon"} size={17} />
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );

  return (
    <div id="tbl-app" className={"t-shell" + (narrow ? " t-narrow" : "")}>
      {!narrow && (
        <aside className="t-sidebar">
          <div className="t-brand">{course.name}</div>
          <div className="t-ctxmeta">
            {course.code ? <span>{course.code}</span> : null}
            <span>
              {roster.length} student{roster.length === 1 ? "" : "s"}
            </span>
            {course.term ? <span>· {course.term}</span> : null}
          </div>
          {/* Section switcher (the AP50A / AP50B control) — always visible so a
              second section is one click away, and driven by real courses. */}
          <div className="t-seg2">
            {courses.map((c) => (
              <button
                key={c.id}
                className={"t-segbtn" + (c.id === courseId ? " on" : "")}
                onClick={() => setCourseId(c.id)}
                title={c.name}
              >
                {c.code || c.name}
              </button>
            ))}
          </div>
          <div className="t-nav" style={{ marginTop: 14 }}>
            {nav(false)}
          </div>
          <div className="t-spacer" />
          {themeBtn}
        </aside>
      )}
      <main className="t-main">
        <div className="t-canvas">
          {narrow && (
            <div className="t-topstrip">
              <span style={{ fontFamily: "var(--serif)", fontSize: 17, fontWeight: 700 }}>
                {course.name}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>
                {roster.length} student{roster.length === 1 ? "" : "s"}
                {course.term ? ` · ${course.term}` : ""}
              </span>
              <span className="t-spacer" />
              <button
                className="t-btn ghost"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                }}
                onClick={() => setTheme(dark ? "light" : "dark")}
              >
                <Icon name={dark ? "sun" : "moon"} size={15} />
                {dark ? "Light" : "Dark"}
              </button>
            </div>
          )}
          {body}
        </div>
      </main>
      {narrow && <nav className="t-bottomnav">{nav(true)}</nav>}
    </div>
  );
}

/**
 * A course isn't usable until it has students, a week, and teams. Until then the
 * app says plainly what the next step is and takes you there — the gradebook is
 * meaningless with an empty roster.
 */
function SetupGuide({
  roster,
  activities,
  hasTeams,
  hasCheckIns,
  onGo,
}: {
  roster: Student[];
  activities: Activity[];
  hasTeams: boolean;
  hasCheckIns: boolean;
  onGo: (t: Tab) => void;
}) {
  const steps: { id: Tab; label: string; done: boolean; hint: string }[] = [
    {
      id: "roster",
      label: "Upload the roster",
      done: roster.length > 0,
      hint: roster.length ? `${roster.length} students` : "Upload or paste the class list",
    },
    {
      id: "roster",
      label: "Form the teams",
      done: hasTeams,
      hint: hasTeams ? "Teams formed" : "Assign students to teams",
    },
    {
      id: "activities",
      label: "Create the first week",
      done: activities.length > 0,
      hint: activities.length
        ? `${activities.length} week${activities.length === 1 ? "" : "s"}`
        : "An activity is one week of the loop",
    },
    {
      id: "checkins",
      label: "Add the check-ins",
      done: hasCheckIns,
      hint: hasCheckIns ? "Check-ins added" : "An individual iRAT and a team tRAT",
    },
  ];

  if (steps.every((s) => s.done)) return null;
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="t-steps">
      {steps.map((s, i) => {
        const state = s.done ? "done" : i === nextIdx ? "cur" : "todo";
        return (
          <Fragment key={s.label}>
            {i > 0 && <span className={"t-steprule" + (steps[i - 1].done ? " done" : "")} />}
            <button
              className={"t-step " + state}
              onClick={() => onGo(s.id)}
              aria-current={state === "cur" ? "step" : undefined}
              title={`Step ${i + 1}: ${s.label}`}
            >
              <span className="dot">{s.done ? "\u2713" : i + 1}</span>
              <span className="lab">{s.label}</span>
              <span className="hint">{s.hint}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Minimal chrome for the pre-class / unconfigured states. */
function Frame({
  children,
  dark,
  onTheme,
}: {
  children: React.ReactNode;
  dark: boolean;
  onTheme: () => void;
}) {
  return (
    <div id="tbl-app" className="ck-root">
      <div className="ck-canvas">
        <div className="t-topstrip">
          <span style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 700 }}>
            Class Check-ins
          </span>
          <span className="t-spacer" />
          <button
            className="t-btn ghost"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--line)",
              borderRadius: 999,
            }}
            onClick={onTheme}
          >
            <Icon name={dark ? "sun" : "moon"} size={15} />
            {dark ? "Light" : "Dark"}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RosterEditor({
  course,
  roster,
  onChanged,
  onError,
}: {
  course: Course;
  roster: Student[];
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<{
    fileName: string;
    students: ParsedStudent[];
    warnings: string[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = async () => {
    const list = names
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    try {
      await addStudents(course.id, list, roster.length);
      setNames("");
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  /** Read + parse a dropped/chosen roster file into the confirm step. */
  const takeFile = async (file: File) => {
    if (!isSupportedRosterFile(file.name)) {
      onError(
        new Error(
          `“${file.name}” isn’t a readable roster file. Use .csv, .tsv or .txt — ` +
            `in Excel or Google Sheets choose File → Save as / Download → CSV.`,
        ),
      );
      return;
    }
    try {
      const text = await file.text();
      const { students, warnings } = parseRoster(text);
      if (!students.length) {
        onError(
          new Error(`No student names found in “${file.name}”. Expected a column of names.`),
        );
        return;
      }
      setPending({ fileName: file.name, students, warnings });
    } catch (e) {
      onError(e);
    }
  };

  /** Names already on the roster are skipped rather than duplicated. */
  const existing = new Set(roster.map((s) => s.name.trim().toLowerCase()));
  const fresh = pending?.students.filter((s) => !existing.has(s.name.trim().toLowerCase())) ?? [];
  const dupeCount = (pending?.students.length ?? 0) - fresh.length;

  const confirmImport = async () => {
    if (!pending || !fresh.length) return;
    setBusy(true);
    try {
      await addStudents(course.id, fresh, roster.length);
      setPending(null);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await removeStudent(id);
      onChanged();
    } catch (e) {
      onError(e);
    }
  };


  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 className="t-h1">Roster</h1>
        <span className="t-sub">
          {course.code ? `${course.code} · ` : ""}
          {roster.length} student{roster.length === 1 ? "" : "s"} — teams are assigned by faculty;
          self-selection is not offered.
        </span>
      </div>


      <div className="t-card" style={{ padding: 14 }}>
        {roster.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
            {roster.map((s) => (
              <div className="t-memberrow" key={s.id}>
                <Avatar name={s.name} tint={s.avatar_tint} />
                <span
                  style={{
                    fontSize: 12.5,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.name}
                </span>
                <button className="t-x" title="Remove from roster" onClick={() => void remove(s.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {/* ---- import from a file ---- */}
        {pending ? (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: 12,
              background: "var(--paper3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {pending.fileName} — {fresh.length} student{fresh.length === 1 ? "" : "s"} to import
              </span>
              {dupeCount > 0 && (
                <span className="t-chip amber">
                  {dupeCount} already on the roster · skipped
                </span>
              )}
            </div>
            {pending.warnings.map((w) => (
              <div key={w} style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 4 }}>
                {w}
              </div>
            ))}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                margin: "10px 0",
                maxHeight: 148,
                overflowY: "auto",
              }}
            >
              {fresh.map((s, i) => (
                <span
                  key={`${s.name}-${i}`}
                  title={s.email}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    border: "1px solid var(--line)",
                    borderRadius: 14,
                    padding: "2px 9px 2px 3px",
                    background: "var(--paper)",
                    fontSize: 12,
                  }}
                >
                  <Avatar name={s.name} size={18} />
                  {s.name}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="t-btn primary"
                onClick={() => void confirmImport()}
                disabled={busy || !fresh.length}
              >
                {busy ? "Importing…" : `Import ${fresh.length} student${fresh.length === 1 ? "" : "s"}`}
              </button>
              <button
                className="t-btn ghost"
                style={{ border: "1px solid var(--line)" }}
                onClick={() => setPending(null)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className={"t-dzbig" + (dragOver ? " over" : "")}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void takeFile(f);
            }}
          >
            <span style={{ color: "var(--ink3)" }}>
              <Icon name="upload" size={34} />
            </span>
            <span className="big">
              {roster.length ? "Add more students" : "Upload the class list"}
            </span>
            <span className="sub">
              Drop a <strong>.csv</strong>, <strong>.tsv</strong> or <strong>.txt</strong> here, or
              click to choose. One column of names, optionally with emails — extra columns are
              ignored. From Excel or Google Sheets: <em>File → Save as / Download → CSV</em>.
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void takeFile(f);
                e.target.value = "";
              }}
            />
          </div>
        )}

        <div className="t-orline">or paste them</div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "flex-start" }}>
          <textarea
            className="t-in"
            style={{
              flex: 1,
              minWidth: 240,
              minHeight: 44,
              resize: "vertical",
              padding: "7px 10px",
            }}
            value={names}
            placeholder="…or paste names — one per line"
            onChange={(e) => setNames(e.target.value)}
          />
          <button className="t-btn primary" onClick={() => void add()} disabled={!names.trim() || busy}>
            Add to roster
          </button>
        </div>
      </div>
    </section>
  );
}
