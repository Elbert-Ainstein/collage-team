"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { Icon } from "./icons";
import {
  addStudents,
  createCourse,
  deleteCourse,
  listActivities,
  listCourses,
  listStudents,
  removeStudent,
} from "./data";
import type { Activity, Course, Student } from "./types";
import { Avatar, ErrorBanner } from "./ui";
import { TeamsPillar } from "./TeamsPillar";
import { GradebookPillar } from "./GradebookPillar";
import { ActivitiesPillar } from "./ActivitiesPillar";
import "./checkins.css";

type Tab = "checkins" | "teams" | "activities";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "checkins", label: "Check-ins", icon: "table" },
  { id: "teams", label: "Roster", icon: "groups" },
  { id: "activities", label: "Activities", icon: "clipboard" },
];

export function ClassCheckins() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Student[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tab, setTab] = useState<Tab>("checkins");
  const [creating, setCreating] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", term: "" });

  const course = courses.find((c) => c.id === courseId) ?? null;
  const fail = (e: unknown) => setError(String((e as Error)?.message ?? e));

  const loadCourses = useCallback(async () => {
    const cs = await listCourses();
    setCourses(cs);
    setCourseId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : cs[0]?.id ?? null));
    return cs;
  }, []);

  /** Re-fetch course-level data shared across pillars. */
  const refresh = useCallback(async () => {
    if (!courseId) {
      setRoster([]);
      setActivities([]);
      return;
    }
    const [r, a] = await Promise.all([listStudents(courseId), listActivities(courseId)]);
    setRoster(r);
    setActivities(a);
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

  const onCreateCourse = async () => {
    if (!form.name.trim()) return;
    setError(null);
    try {
      const c = await createCourse({
        name: form.name.trim(),
        code: form.code.trim(),
        term: form.term.trim(),
      });
      setForm({ name: "", code: "", term: "" });
      setCreating(false);
      await loadCourses();
      setCourseId(c.id);
      setTab("teams");
    } catch (e) {
      fail(e);
    }
  };

  // ---------- gates ----------
  if (!isSupabaseConfigured) {
    return (
      <Frame dark={dark} onTheme={() => setTheme(dark ? "light" : "dark")}>
        <div className="t-card" style={{ padding: 22 }}>
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

  if (!course || creating) {
    return (
      <Frame dark={dark} onTheme={() => setTheme(dark ? "light" : "dark")}>
        <ErrorBanner error={error} />
        <div className="t-card" style={{ padding: 22, maxWidth: 560 }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 700 }}>
            {courses.length ? "New class" : "Create your class"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 5, marginBottom: 14 }}>
            Name your section, then add the roster. Everything from here writes to your database.
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <label className="t-fld">
              Class name
              <input
                className="t-in"
                autoFocus
                value={form.name}
                placeholder="e.g. Intro to Systems Biology"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && void onCreateCourse()}
              />
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <label className="t-fld" style={{ flex: 1 }}>
                Code (optional)
                <input
                  className="t-in"
                  value={form.code}
                  placeholder="AP 50"
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                />
              </label>
              <label className="t-fld" style={{ flex: 1 }}>
                Term (optional)
                <input
                  className="t-in"
                  value={form.term}
                  placeholder="Fall"
                  onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                className="t-btn primary"
                onClick={() => void onCreateCourse()}
                disabled={!form.name.trim()}
              >
                Create class
              </button>
              {courses.length > 0 && (
                <button
                  className="t-btn ghost"
                  style={{ border: "1px solid var(--line)" }}
                  onClick={() => {
                    setCreating(false);
                    setForm({ name: "", code: "", term: "" });
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
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
      {tab === "checkins" && <GradebookPillar {...pillarProps} />}
      {tab === "activities" && <ActivitiesPillar {...pillarProps} />}
      {tab === "teams" && (
        <>
          <RosterEditor
            course={course}
            roster={roster}
            onChanged={() => void refresh().catch(fail)}
            onNewClass={() => setCreating(true)}
            onDeleted={async () => {
              const cs = await loadCourses();
              setCourseId(cs[0]?.id ?? null);
            }}
            onError={fail}
          />
          <div style={{ marginTop: 20 }}>
            <TeamsPillar {...pillarProps} />
          </div>
        </>
      )}
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
            <button
              className="t-segbtn"
              style={{ flex: "0 0 auto", padding: "5px 9px" }}
              title="Add another section"
              onClick={() => setCreating(true)}
            >
              +
            </button>
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
  onNewClass,
  onDeleted,
  onError,
}: {
  course: Course;
  roster: Student[];
  onChanged: () => void;
  onNewClass: () => void;
  onDeleted: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);

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

  const remove = async (id: string) => {
    try {
      await removeStudent(id);
      onChanged();
    } catch (e) {
      onError(e);
    }
  };

  const destroy = async () => {
    if (!window.confirm(`Delete "${course.name}" and everything in it? This cannot be undone.`))
      return;
    try {
      await deleteCourse(course.id);
      await onDeleted();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 className="t-h1">Roster</h1>
        <span className="t-sub">
          {course.name} · {roster.length} student{roster.length === 1 ? "" : "s"} — teams are
          assigned by faculty; self-selection is not offered.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 14px" }}>
        <button className="t-btn line" onClick={onNewClass}>
          + New class
        </button>
        <button
          className="t-btn ghost"
          style={{ border: "1px solid var(--line)", color: "var(--amber)" }}
          onClick={() => void destroy()}
        >
          Delete class
        </button>
      </div>

      <div className="t-card" style={{ padding: 14 }}>
        {roster.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink3)", padding: "6px 2px 12px" }}>
            No students yet. Paste your roster below — one name per line.
          </div>
        ) : (
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
            placeholder="Add students — one name per line"
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
