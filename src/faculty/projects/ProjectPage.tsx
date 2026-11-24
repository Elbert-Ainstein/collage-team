"use client";

// One project: every team, and a dot for each of its graders — green when
// they've marked their grading done, amber while they're on it, hollow when
// nobody has started. A team's score is its categories averaged over the done
// gradings. Press a team for its graders; press a dot to go straight to that
// grader's sheet.

import { useMemo } from "react";
import type { TeamWithMembers } from "@/checkins/types";
import { downloadCsv } from "../exportTerm";
import {
  fmt,
  graderLabel,
  gradingOf,
  outOf,
  progressOf,
  resultsRows,
  slotsFor,
  stateOf,
  teamResult,
  toProjectCsv,
} from "@/projects/model";
import type { ProjectSnapshot } from "@/projects/types";
import { FIcon } from "../icons";
import { TopBar } from "./TopBar";

const STATE_WORD = { empty: "not started", started: "in progress", done: "done" } as const;

export function ProjectPage({
  snap,
  teams,
  canEdit,
  fixedToOtherSet,
  onBack,
  onEdit,
  onTeam,
  onGrade,
}: {
  snap: ProjectSnapshot;
  teams: TeamWithMembers[];
  canEdit: boolean;
  /** Its grades are on a team set the class has since moved on from. */
  fixedToOtherSet: boolean;
  onBack: () => void;
  onEdit: () => void;
  onTeam: (teamId: string) => void;
  onGrade: (teamId: string, slot: number) => void;
}) {
  const { project, categories } = snap;
  const total = outOf(categories);
  const prog = useMemo(
    () => progressOf(snap.gradings, project, teams.map((t) => t.id)),
    [snap.gradings, project, teams],
  );

  const exportCsv = () =>
    downloadCsv(
      `${project.title.replace(/[^\w\- ]+/g, "").trim() || "project"} - results.csv`,
      toProjectCsv(resultsRows(snap, teams)),
    );

  return (
    <div className="fv-panel te-fac pj">
      <TopBar
        onBack={onBack}
        label="Back to projects"
        title={project.title}
        sub={
          <>
            {categories.length} {categories.length === 1 ? "category" : "categories"} · out of {total} ·{" "}
            {project.graders_per_team} {project.graders_per_team === 1 ? "grader" : "graders"} per team
          </>
        }
      >
        <button type="button" className="fv-btn outline sm" onClick={exportCsv} disabled={!teams.length}>
          Download results
        </button>
        {canEdit ? (
          <button type="button" className="fv-btn outline sm" onClick={onEdit}>
            <FIcon name="edit" size={14} /> Edit rubric
          </button>
        ) : null}
      </TopBar>

      <div className="pj-summary">
        <span>
          <b>{prog.teamsComplete}</b> of {teams.length} teams fully graded
        </span>
        <span className="pj-legend" aria-hidden="true">
          <span className="pj-dot done" /> done
          <span className="pj-dot started" /> in progress
          <span className="pj-dot empty" /> not started
        </span>
      </div>
      {teams.length ? (
        <span className="pj-bar pj-barwide" aria-hidden="true">
          <span style={{ width: `${(100 * prog.teamsComplete) / teams.length}%` }} />
        </span>
      ) : null}

      {fixedToOtherSet ? (
        <div className="pj-note" role="note">
          <FIcon name="groups" size={15} />
          <span>
            These are the teams this project was graded with. The class has moved to different teams
            since; grades stay with the teams that earned them.
          </span>
        </div>
      ) : null}

      {categories.length === 0 ? (
        <div className="pj-note" role="note">
          <FIcon name="assignment" size={15} />
          <span>This project has no rubric yet{canEdit ? " — add a category before grading." : "."}</span>
        </div>
      ) : null}

      <div className="fv-scroll">
        {teams.length === 0 ? (
          <div className="fv-card pj-empty">
            <div className="pj-emptytitle">No teams yet</div>
            <p className="fv-sub">Form them on the Teams tab and they&rsquo;ll appear here, one row each.</p>
          </div>
        ) : (
          <ul className="pj-teams" aria-label="Teams">
            {teams.map((t) => {
              const slots = slotsFor(project, snap.gradings, t.id);
              const r = teamResult(snap, t.id);
              return (
                <li key={t.id} className="fv-card pj-teamrow">
                  <button type="button" className="pj-teamopen" onClick={() => onTeam(t.id)}>
                    <span className="pj-teamname">{t.name}</span>
                    <span className="pj-members">
                      {t.members.length ? t.members.map((m) => m.name).join(", ") : "No members"}
                    </span>
                  </button>
                  <div className="pj-chips">
                    {slots.map((slot) => {
                      const g = gradingOf(snap.gradings, t.id, slot);
                      const state = stateOf(g);
                      const who = graderLabel(g, slot);
                      return (
                        <button
                          key={slot}
                          type="button"
                          className={`pj-chip ${state}`}
                          title={`${who}: ${STATE_WORD[state]}`}
                          aria-label={`${t.name}, ${who}: ${STATE_WORD[state]}`}
                          onClick={() => onGrade(t.id, slot)}
                        >
                          <span className={`pj-dot ${state}`} />
                          <span className="pj-chipname">{g?.grader_name.trim() || `G${slot}`}</span>
                        </button>
                      );
                    })}
                  </div>
                  <span
                    className={`pj-teamscore${r.total === null ? " none" : ""}`}
                    title={r.total === null ? "No grading marked done yet" : `Averaged over ${r.graders}`}
                  >
                    {r.total === null ? "—" : fmt(r.total)}
                    <span className="pj-outof"> / {total}</span>
                  </span>
                  <FIcon name="chevronRight" size={16} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
