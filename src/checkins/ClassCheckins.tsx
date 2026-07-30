"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { Icon } from "./icons";
import {
  addStudents,
  createCourse,
  deleteCourse,
  initials,
  listCourses,
  listStudents,
  removeStudent,
  tintFor,
} from "./data";
import type { Course, Student } from "./types";
import "./checkins.css";

function Avatar({ name, tint, size = 22 }: { name: string; tint?: string | null; size?: number }) {
  const c = tint || tintFor(name);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        fontSize: size * 0.42,
        fontWeight: 600,
        background: c + "22",
        color: c,
        flex: "none",
      }}
    >
      {initials(name)}
    </span>
  );
}

export function ClassCheckins() {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [creating, setCreating] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  // new-class form
  const [form, setForm] = useState({ name: "", code: "", term: "" });
  // add-students box
  const [names, setNames] = useState("");

  const course = courses.find((c) => c.id === courseId) ?? null;

  const loadCourses = useCallback(async () => {
    const cs = await listCourses();
    setCourses(cs);
    setCourseId((prev) => prev ?? cs[0]?.id ?? null);
    return cs;
  }, []);

  // initial load
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    loadCourses()
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setReady(true));
  }, [loadCourses]);

  // load roster when the selected course changes
  useEffect(() => {
    if (!courseId) {
      setStudents([]);
      return;
    }
    listStudents(courseId)
      .then(setStudents)
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [courseId]);

  // theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.setAttribute("data-theme", theme);
    else root.removeAttribute("data-theme");
  }, [theme]);
  const effectiveDark =
    theme === "dark" ||
    (theme === null &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  const onCreate = async () => {
    if (!form.name.trim()) return;
    setErr(null);
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
    } catch (e: unknown) {
      setErr(String((e as Error)?.message ?? e));
    }
  };

  const onAddStudents = async () => {
    if (!courseId) return;
    const list = names
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return;
    setErr(null);
    try {
      await addStudents(courseId, list, students.length);
      setNames("");
      setStudents(await listStudents(courseId));
    } catch (e: unknown) {
      setErr(String((e as Error)?.message ?? e));
    }
  };

  const onRemoveStudent = async (id: string) => {
    setStudents((s) => s.filter((x) => x.id !== id)); // optimistic
    try {
      await removeStudent(id);
    } catch (e: unknown) {
      setErr(String((e as Error)?.message ?? e));
      if (courseId) setStudents(await listStudents(courseId));
    }
  };

  const onDeleteCourse = async () => {
    if (!course) return;
    if (!window.confirm(`Delete "${course.name}" and its roster? This cannot be undone.`)) return;
    await deleteCourse(course.id);
    setCourseId(null);
    const cs = await loadCourses();
    setCourseId(cs[0]?.id ?? null);
  };

  // ---------- render ----------
  const shell = (body: React.ReactNode, sub?: React.ReactNode) => (
    <div id="tbl-app" className="ck-root">
      <div className="ck-canvas">
        <div className="t-topstrip" style={{ marginBottom: 18 }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 700 }}>
            Class Check-ins
          </span>
          {sub}
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
            onClick={() => setTheme(effectiveDark ? "light" : "dark")}
          >
            <Icon name={effectiveDark ? "sun" : "moon"} size={15} />
            {effectiveDark ? "Light" : "Dark"}
          </button>
        </div>
        {body}
      </div>
    </div>
  );

  if (!isSupabaseConfigured) {
    return shell(
      <div className="t-card" style={{ padding: 22 }}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700 }}>
          Connect your database
        </div>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6, maxWidth: "60ch" }}>
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>, then restart the
          dev server. See <code>supabase/SETUP.md</code>.
        </div>
      </div>,
    );
  }

  if (!ready) return shell(<div style={{ color: "var(--ink2)", padding: 20 }}>Loading…</div>);

  const errBanner = err ? (
    <div
      className="t-card"
      style={{
        padding: "10px 14px",
        marginBottom: 14,
        borderColor: "var(--amber)",
        color: "var(--amber)",
        fontSize: 12.5,
      }}
    >
      {err}
    </div>
  ) : null;

  // no class yet, or creating a new one → the create form
  if (!course || creating) {
    return shell(
      <>
        {errBanner}
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
                onKeyDown={(e) => e.key === "Enter" && onCreate()}
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
              <button className="t-btn primary" onClick={onCreate} disabled={!form.name.trim()}>
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
      </>,
    );
  }

  // a class exists → header + roster
  return shell(
    <>
      {errBanner}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 className="t-h1">Roster</h1>
        <span className="t-sub">
          {course.name}
          {course.code ? ` · ${course.code}` : ""} · {students.length} student
          {students.length === 1 ? "" : "s"}
          {course.term ? ` · ${course.term}` : ""} — teams and check-ins unlock once the roster is
          in.
        </span>
      </div>

      {courses.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
          <span className="t-kicker">Class</span>
          {courses.map((c) => (
            <button
              key={c.id}
              className={"t-pill" + (c.id === courseId ? " on" : "")}
              onClick={() => setCourseId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
        <button className="t-btn line" onClick={() => setCreating(true)}>
          + New class
        </button>
        <button
          className="t-btn ghost"
          style={{ border: "1px solid var(--line)", color: "var(--amber)" }}
          onClick={onDeleteCourse}
        >
          Delete class
        </button>
      </div>

      <div className="t-card" style={{ padding: 14 }}>
        {students.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink3)", padding: "6px 2px 12px" }}>
            No students yet. Paste your roster below — one name per line.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
            {students.map((s) => (
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
                <button
                  className="t-x"
                  title="Remove from roster"
                  onClick={() => onRemoveStudent(s.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "flex-start" }}>
          <textarea
            className="t-in"
            style={{ flex: 1, minWidth: 240, minHeight: 44, resize: "vertical", padding: "7px 10px" }}
            value={names}
            placeholder="Add students — one name per line"
            onChange={(e) => setNames(e.target.value)}
          />
          <button className="t-btn primary" onClick={onAddStudents} disabled={!names.trim()}>
            Add to roster
          </button>
        </div>
      </div>
    </>,
    <>
      <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>
        {course.name}
        {course.term ? ` · ${course.term}` : ""}
      </span>
    </>,
  );
}
