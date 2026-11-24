"use client";

// Making a project, or changing one: its title, how many graders each team
// gets, and the rubric — categories, each a 1–5 scale with a sentence saying
// what every point looks like. The grader sees those sentences in the room.
// Categories are in the order they were added.
//
// Once teams have been graded the rubric can still change. Taking a category
// out deletes its scores; adding one reopens every done grading (0059), so the
// editor says both before it saves.

import { useMemo, useState } from "react";
import { AutoTextarea } from "@/teameval/AutoTextarea";
import { createProject, deleteProject, saveCategories, updateProject } from "@/projects/data";
import { blankCategory, defaultCategories, problemWith, type CategoryDraft } from "@/projects/defaults";
import { outOf } from "@/projects/model";
import type { ProjectSnapshot } from "@/projects/types";
import { ConfirmDialog } from "../ConfirmDialog";
import type { FacultyData } from "../FacultyApp";
import { FIcon } from "../icons";
import { TopBar } from "./TopBar";

// What 0059 keeps: a title to 200 characters, a category name to 120.
const TITLE_MAX = 200;
const NAME_MAX = 120;
const LEVEL_MAX = 2000;
const SCORES = [5, 4, 3, 2, 1] as const;

export function ProjectEditor({
  data,
  snap,
  nextPosition,
  onCancel,
  onSaved,
  onDeleted,
  onError,
}: {
  data: FacultyData;
  /** The project being changed, or null for a new one. */
  snap: ProjectSnapshot | null;
  nextPosition: number;
  onCancel: () => void;
  onSaved: (projectId: string) => void;
  onDeleted: () => void;
  onError: (e: unknown) => void;
}) {
  const fresh = snap === null;
  const [title, setTitle] = useState(snap?.project.title ?? "");
  const [graders, setGraders] = useState(String(snap?.project.graders_per_team ?? 2));
  const [categories, setCategories] = useState<CategoryDraft[]>(() =>
    snap ? snap.categories.map((c) => ({ id: c.id, name: c.name, levels: [...c.levels] })) : defaultCategories(),
  );
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<"save" | "delete" | null>(null);

  const n = Number(graders);
  const problem = problemWith(title, n, categories);
  const canEdit = data.can.author;

  /** What saving will do to grades already given, in words; null when nothing. */
  const consequences = useMemo(() => {
    if (!snap) return null;
    const kept = new Set(categories.map((c) => c.id));
    const removed = snap.categories.filter((c) => !kept.has(c.id));
    const lostScores = snap.scores.filter((s) => removed.some((c) => c.id === s.category_id) && s.score !== null);
    const was = new Set(snap.categories.map((c) => c.id));
    const added = categories.filter((c) => !was.has(c.id));
    const done = snap.gradings.filter((g) => g.done_at).length;
    const lines: string[] = [];
    if (lostScores.length) {
      lines.push(
        `Removing ${removed.map((c) => c.name || "a category").join(" and ")} deletes ${lostScores.length} ${
          lostScores.length === 1 ? "score" : "scores"
        } already given.`,
      );
    }
    if (added.length && done) {
      lines.push(
        `${done} ${done === 1 ? "grading is" : "gradings are"} marked done. ${
          done === 1 ? "It goes" : "They go"
        } back to in progress until the new ${added.length === 1 ? "category is" : "categories are"} scored.`,
      );
    }
    return lines.length ? lines : null;
  }, [snap, categories]);

  const setCat = (id: string, change: Partial<CategoryDraft>) =>
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const setLevel = (id: string, score: number, text: string) =>
    setCategories((cs) =>
      cs.map((c) => (c.id === id ? { ...c, levels: c.levels.map((l, i) => (i === score - 1 ? text : l)) } : c)),
    );
  const save = async () => {
    if (problem || busy) return;
    setAsking(null);
    setBusy(true);
    try {
      if (fresh) {
        const p = await createProject(
          { courseId: data.course.id, title, gradersPerTeam: n, position: nextPosition },
          categories,
        );
        onSaved(p.id);
        return;
      }
      await updateProject(snap.project.id, { title: title.trim(), graders_per_team: n });
      await saveCategories(
        snap.project.id,
        categories,
        snap.categories.map((c) => c.id),
      );
      onSaved(snap.project.id);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!snap) return;
    setBusy(true);
    try {
      await deleteProject(snap.project.id);
      onDeleted();
    } catch (e) {
      onError(e);
      setBusy(false);
      setAsking(null);
    }
  };

  const given = snap ? snap.scores.filter((s) => s.score !== null).length : 0;

  return (
    <div className="fv-panel te-fac pj">
      <TopBar
        onBack={onCancel}
        label={fresh ? "Back to projects" : "Back to the project"}
        title={fresh ? "New project" : "Edit project"}
        sub={`Out of ${outOf(categories)}`}
      >
        <span className="te-problem">{problem}</span>
        <button type="button" className="fv-btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="fv-btn primary sm"
          disabled={!!problem || busy || !canEdit}
          onClick={() => (consequences ? setAsking("save") : void save())}
        >
          {busy && asking !== "delete" ? "Saving…" : fresh ? "Create" : "Save"}
        </button>
      </TopBar>

      <div className="fv-scroll">
        <div className="pj-editbasics">
          <label className="fv-field pj-titlefield">
            <span className="fv-eyebrow">Title</span>
            <input
              className="fv-in"
              value={title}
              maxLength={TITLE_MAX}
              placeholder="Project fair"
              aria-label="Project title"
              autoFocus={fresh}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="fv-field pj-gradersfield">
            <span className="fv-eyebrow">Graders per team</span>
            <input
              className="fv-in"
              type="number"
              min={1}
              max={8}
              step={1}
              value={graders}
              aria-label="Graders per team"
              onChange={(e) => setGraders(e.target.value)}
            />
          </label>
        </div>

        {snap && given > 0 ? (
          <div className="pj-note" role="status">
            <FIcon name="assignment" size={15} />
            <span>Teams have been graded. Removing a category deletes its scores.</span>
          </div>
        ) : null}

        <h2 className="te-h2 pj-h2">Rubric</h2>
        <div className="te-catgrid pj-catgrid">
          {categories.map((c, i) => (
            <div key={c.id} className="fv-card te-catcard">
              <div className="te-cathead">
                <AutoTextarea
                  className="fv-in te-catname"
                  rows={1}
                  max={NAME_MAX}
                  value={c.name}
                  placeholder="Category"
                  aria-label={`Category ${i + 1} name`}
                  onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                  onChange={(v) => setCat(c.id, { name: v.replace(/\s*\n\s*/g, " ") })}
                />
                <button
                  type="button"
                  className="fv-iconbtn"
                  aria-label={`Remove ${c.name || `category ${i + 1}`}`}
                  title="Remove"
                  onClick={() => setCategories((cs) => cs.filter((x) => x.id !== c.id))}
                >
                  <FIcon name="close" size={14} />
                </button>
              </div>
              <div className="te-levels">
                {SCORES.map((score) => (
                  <label key={score} className="te-level">
                    <span className={`te-score s${score}`}>{score}</span>
                    <AutoTextarea
                      className="fv-in te-levelin"
                      rows={2}
                      max={LEVEL_MAX}
                      value={c.levels[score - 1] ?? ""}
                      placeholder={score === 5 ? "What a 5 looks like" : score === 1 ? "What a 1 looks like" : ""}
                      aria-label={`${c.name || `Category ${i + 1}`}: what ${score} means`}
                      onChange={(v) => setLevel(c.id, score, v)}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className="te-addcat" onClick={() => setCategories((cs) => [...cs, blankCategory()])}>
            <span className="te-addcircle">
              <FIcon name="add" size={20} />
            </span>
            Add category
          </button>
        </div>

        {snap && canEdit ? (
          <div className="pj-danger">
            <button type="button" className="fv-btn outline sm danger" disabled={busy} onClick={() => setAsking("delete")}>
              Delete project
            </button>
          </div>
        ) : null}
      </div>

      {asking === "save" && consequences ? (
        <ConfirmDialog
          title="Save these changes?"
          body={
            <>
              {consequences.map((l) => (
                <p key={l} style={{ margin: "0 0 8px" }}>
                  {l}
                </p>
              ))}
            </>
          }
          confirmLabel="Save"
          busy={busy}
          busyLabel="Saving…"
          tone={consequences.some((l) => l.startsWith("Removing")) ? "danger" : "primary"}
          onConfirm={() => void save()}
          onCancel={() => setAsking(null)}
        />
      ) : null}

      {asking === "delete" && snap ? (
        <ConfirmDialog
          title={`Delete ${snap.project.title}?`}
          body={
            snap.gradings.length
              ? `Its rubric and all ${snap.gradings.length} ${
                  snap.gradings.length === 1 ? "grading" : "gradings"
                } go with it. This can't be undone.`
              : "Its rubric goes with it. This can't be undone."
          }
          confirmLabel="Delete project"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}
