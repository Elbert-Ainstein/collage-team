"use client";

// Projects — grading a project fair, one team at a time.
//
// Four levels, each a page: the course's projects; one project's teams, with a
// dot per grader saying how far they've got; one team's graders; and one
// grader's sheet, where every category gets a score from 5 down to 1 and a
// reason. Plus the editor for a project's title and rubric.
//
// Nothing here is an activity and nothing reaches students. Like the check-in
// sheet it's filled in standing up, often by several people at once, so the
// open project follows what the others write (0059's realtime) and every
// level is on the URL — see where.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listTeams } from "@/checkins/data";
import type { TeamWithMembers } from "@/checkins/types";
import { listProjects, loadProject, watchProject, ProjectsNotInstalledError } from "@/projects/data";
import { progressOf } from "@/projects/model";
import type { ProjectGrading, ProjectScore, ProjectSnapshot, ProjectsOverview } from "@/projects/types";
import type { FacultyData } from "../FacultyApp";
import { FIcon } from "../icons";
import { ProjectEditor } from "./ProjectEditor";
import { ProjectPage } from "./ProjectPage";
import { TeamPage } from "./TeamPage";
import { GradingSheet } from "./GradingSheet";
import { TopBar } from "./TopBar";
import { AT_LIST, readProjectWhere, writeProjectWhere, type ProjectWhere } from "./where";
import "@/teameval/teameval.css";
import "@/projects/projects.css";

/** How long a burst of live events settles before one re-read. */
const LIVE_COALESCE_MS = 300;

export function ProjectsScreen({
  data,
  me,
  home,
  onError,
}: {
  data: FacultyData;
  /** The signed-in person's name, to put on a grading they start. "" when unknown. */
  me: string;
  /** Bumped when the sidebar's Projects tab is pressed: back to the list. */
  home: number;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [where, setWhere] = useState<ProjectWhere>(AT_LIST);
  const [ready, setReady] = useState(false);
  // FacultyApp hands a fresh onError every render. Held here so the loaders
  // below don't re-run — and re-subscribe — each time the app re-renders.
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const fail = useCallback((e: unknown) => errorRef.current(e), []);

  // The URL is read after the first render, never during it: this component
  // server-renders, and the server has no window.
  useEffect(() => {
    setWhere(readProjectWhere(window.location.search));
    setReady(true);
    const onPop = () => setWhere(readProjectWhere(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((w: ProjectWhere, mode: "push" | "replace" = "push") => {
    setWhere(w);
    writeProjectWhere(w, mode);
  }, []);

  const homeSeen = useRef(home);
  useEffect(() => {
    if (home === homeSeen.current) return;
    homeSeen.current = home;
    go(AT_LIST);
  }, [home, go]);

  // ---------------------------------------------------------- the list
  const [overview, setOverview] = useState<ProjectsOverview | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const atList = ready && !where.project && where.edit !== "new";
  const courseId = data.course.id;
  const loadList = useCallback(async () => {
    try {
      setOverview(await listProjects(courseId));
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, [courseId]);
  useEffect(() => {
    if (atList) void loadList();
  }, [atList, loadList]);

  // ------------------------------------------------------- one project
  const [snap, setSnap] = useState<ProjectSnapshot | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const openRef = useRef<string | null>(null);
  openRef.current = where.project;

  const reread = useCallback(async (projectId: string) => {
    try {
      const s = await loadProject(projectId);
      if (openRef.current !== projectId) return;
      if (!s) {
        // Deleted, or a link to another course's project: say so, go home.
        setSnap(null);
        fail(new Error("That project isn't on this course any more. It may have been deleted."));
        go(AT_LIST, "replace");
        return;
      }
      setSnap(s);
      setSnapError(null);
    } catch (e) {
      if (openRef.current !== projectId) return;
      setSnapError(e instanceof Error ? e.message : String(e));
    }
  }, [go, fail]);

  useEffect(() => {
    if (!where.project) {
      setSnap(null);
      return;
    }
    setSnap((s) => (s?.project.id === where.project ? s : null));
    void reread(where.project);
  }, [where.project, reread]);

  // Every grader's phone writes to the same project; this copy re-reads when
  // any of them does, once a burst settles.
  useEffect(() => {
    const id = where.project;
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = watchProject(id, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reread(id), LIVE_COALESCE_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [where.project, reread]);

  // A grading this copy just wrote goes straight into the snapshot, so the
  // dots and averages move without waiting for the round trip back.
  const patchGrading = useCallback((row: ProjectGrading | null, key?: { team_id: string; slot: number }) => {
    setSnap((s) => {
      if (!s) return s;
      const k = row ?? key;
      if (!k) return s;
      const rest = s.gradings.filter((g) => !(g.team_id === k.team_id && g.slot === k.slot));
      const scores = row ? s.scores : s.scores.filter((x) => !(x.team_id === k.team_id && x.slot === k.slot));
      return { ...s, gradings: row ? [...rest, row] : rest, scores };
    });
  }, []);
  const patchScore = useCallback((row: ProjectScore) => {
    setSnap((s) => {
      if (!s) return s;
      const rest = s.scores.filter(
        (x) => !(x.team_id === row.team_id && x.slot === row.slot && x.category_id === row.category_id),
      );
      const opened = s.gradings.some((g) => g.team_id === row.team_id && g.slot === row.slot);
      const gradings = opened
        ? s.gradings
        : [
            ...s.gradings,
            {
              project_id: row.project_id,
              team_id: row.team_id,
              slot: row.slot,
              grader_name: "",
              done_at: null,
              updated_by: null,
              updated_at: row.updated_at,
            },
          ];
      return { ...s, scores: [...rest, row], gradings };
    });
  }, []);

  // --------------------------------------------------------- the teams
  // A project grades the teams of one set: the course's current set until the
  // first grade, then whichever set that was (0059).
  const setId = snap?.project.team_set_id ?? null;
  const [otherTeams, setOtherTeams] = useState<{ setId: string; teams: TeamWithMembers[] } | null>(null);
  const needsOther = Boolean(setId && setId !== data.teamSetId);
  useEffect(() => {
    if (!needsOther || !setId || otherTeams?.setId === setId) return;
    let alive = true;
    listTeams(setId, data.roster)
      .then((teams) => alive && setOtherTeams({ setId, teams }))
      .catch((e) => alive && fail(e));
    return () => {
      alive = false;
    };
  }, [needsOther, setId, otherTeams, data.roster, fail]);
  const teams: TeamWithMembers[] | null = needsOther
    ? otherTeams?.setId === setId
      ? otherTeams.teams
      : null
    : data.teams;

  // A team that isn't on the project (a stale link, a team deleted since)
  // falls back to the project rather than an empty page.
  const team = useMemo(
    () => (where.team && teams ? (teams.find((t) => t.id === where.team) ?? null) : null),
    [where.team, teams],
  );
  useEffect(() => {
    if (where.project && where.team && teams && snap && !team) {
      go({ ...AT_LIST, project: where.project }, "replace");
    }
  }, [where, teams, snap, team, go]);

  const can = data.can;

  if (!ready) return <div className="fv-panel te-fac pj" />;

  // ------------------------------------------------------------ render
  if (where.edit === "new") {
    return (
      <ProjectEditor
        data={data}
        snap={null}
        nextPosition={overview ? overview.projects.length : 0}
        onCancel={() => go(AT_LIST)}
        onSaved={(id) => go({ ...AT_LIST, project: id }, "replace")}
        onDeleted={() => go(AT_LIST, "replace")}
        onError={fail}
      />
    );
  }

  if (where.project) {
    if (!snap || snap.project.id !== where.project) {
      return (
        <div className="fv-panel te-fac pj">
          <TopBar onBack={() => go(AT_LIST)} label="Back to projects" title="Project" />
          <div className="fv-sub">{snapError ?? "Loading…"}</div>
        </div>
      );
    }

    if (where.edit === "edit") {
      return (
        <ProjectEditor
          data={data}
          snap={snap}
          nextPosition={0}
          onCancel={() => go({ ...AT_LIST, project: snap.project.id })}
          onSaved={() => {
            void reread(snap.project.id);
            go({ ...AT_LIST, project: snap.project.id }, "replace");
          }}
          onDeleted={() => go(AT_LIST, "replace")}
          onError={fail}
        />
      );
    }

    if (!teams) {
      return (
        <div className="fv-panel te-fac pj">
          <TopBar onBack={() => go(AT_LIST)} label="Back to projects" title={snap.project.title} />
          <div className="fv-sub">Loading teams…</div>
        </div>
      );
    }

    if (team && where.slot) {
      return (
        <GradingSheet
          key={`${snap.project.id}:${team.id}:${where.slot}`}
          data={data}
          snap={snap}
          team={team}
          slot={where.slot}
          me={me}
          canGrade={can.grade}
          onBack={() => go({ ...AT_LIST, project: snap.project.id, team: team.id })}
          onTeams={() => go({ ...AT_LIST, project: snap.project.id })}
          onGrading={patchGrading}
          onScore={patchScore}
          onError={fail}
        />
      );
    }

    if (team) {
      return (
        <TeamPage
          snap={snap}
          team={team}
          canGrade={can.grade}
          onBack={() => go({ ...AT_LIST, project: snap.project.id })}
          onOpen={(slot) => go({ ...AT_LIST, project: snap.project.id, team: team.id, slot })}
        />
      );
    }

    return (
      <ProjectPage
        snap={snap}
        teams={teams}
        canEdit={can.author}
        fixedToOtherSet={needsOther}
        onBack={() => go(AT_LIST)}
        onEdit={() => go({ ...AT_LIST, project: snap.project.id, edit: "edit" })}
        onTeam={(teamId) => go({ ...AT_LIST, project: snap.project.id, team: teamId })}
        onGrade={(teamId, slot) => go({ ...AT_LIST, project: snap.project.id, team: teamId, slot })}
      />
    );
  }

  return (
    <ProjectList
      data={data}
      overview={overview}
      error={listError}
      onNew={() => go({ ...AT_LIST, edit: "new" })}
      onOpen={(id) => go({ ...AT_LIST, project: id })}
    />
  );
}

// ------------------------------------------------------------ the list

function ProjectList({
  data,
  overview,
  error,
  onNew,
  onOpen,
}: {
  data: FacultyData;
  overview: ProjectsOverview | null;
  error: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const notInstalled = error === new ProjectsNotInstalledError().message;
  const teamIds = data.teams.map((t) => t.id);
  // The empty state has its own button; one on the header too is the same
  // button twice.
  const none = overview !== null && overview.projects.length === 0;
  // The app's own type scale, like the tabs beside it. Inside a project the
  // screens go a step larger (te-fac), as team evaluation's do: they're read
  // standing up, on a phone or an iPad.
  return (
    <div className="fv-panel pj">
      <div className="fv-head pj-head">
        <div>
          <h1 className="fv-h1">Projects</h1>
          <div className="fv-sub">Grade a project fair team by team, against a rubric.</div>
        </div>
        <div style={{ flex: 1 }} />
        {data.can.author && !notInstalled && !none ? (
          <button type="button" className="fv-btn primary sm" onClick={onNew}>
            <FIcon name="add" size={15} /> New project
          </button>
        ) : null}
      </div>

      <div className="fv-scroll">
        {error ? (
          <div className="pj-note" role="alert">
            {error}
          </div>
        ) : null}

        {!overview && !error ? <div className="fv-sub">Loading…</div> : null}

        {overview && overview.projects.length === 0 ? (
          <div className="fv-card pj-empty">
            <div className="pj-emptytitle">No projects yet</div>
            <p className="fv-sub">
              {data.can.author
                ? "Make one for your project fair: a rubric of categories, each scored 5 to 1. Graders then open a team, score every category and say why."
                : "When the instructor makes one, you'll grade it here."}
            </p>
            {data.can.author ? (
              <button type="button" className="fv-btn primary sm" onClick={onNew}>
                <FIcon name="add" size={15} /> New project
              </button>
            ) : null}
          </div>
        ) : null}

        {overview && overview.projects.length ? (
          <ul className="pj-cards">
            {overview.projects.map((p) => {
              const cats = overview.categoryCount.get(p.id) ?? 0;
              // Progress against the class's teams, which is what a project
              // grades until its first grade; one fixed to an older set just
              // counts its done gradings.
              const current = !p.team_set_id || p.team_set_id === data.teamSetId;
              const prog = progressOf(
                overview.gradings,
                p,
                current ? teamIds : overview.gradings.filter((g) => g.project_id === p.id).map((g) => g.team_id),
              );
              return (
                <li key={p.id}>
                  <button type="button" className="fv-card pj-card" onClick={() => onOpen(p.id)}>
                    <span className="pj-cardtitle">{p.title}</span>
                    <span className="fv-sub">
                      {cats} {cats === 1 ? "category" : "categories"} · {p.graders_per_team}{" "}
                      {p.graders_per_team === 1 ? "grader" : "graders"} per team
                    </span>
                    <span className="pj-cardprog">
                      {current && teamIds.length ? (
                        <>
                          <b>{prog.teamsComplete}</b> of {teamIds.length} teams fully graded
                        </>
                      ) : (
                        <>
                          <b>{prog.done}</b> {prog.done === 1 ? "grading" : "gradings"} done
                        </>
                      )}
                      {prog.started ? (
                        <span className="fv-sub">
                          {" "}
                          · {prog.started} {prog.started === 1 ? "grading" : "gradings"} in progress
                        </span>
                      ) : null}
                    </span>
                    {current && teamIds.length ? (
                      <span className="pj-bar" aria-hidden="true">
                        <span style={{ width: `${(100 * prog.teamsComplete) / teamIds.length}%` }} />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
