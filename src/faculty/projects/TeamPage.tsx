"use client";

// One team on a project: its score, then its graders — a row each with a dot
// for how far they've got. Press a grader to open their sheet, which is where
// their scores and reasons are; or add another grader.

import type { TeamWithMembers } from "@/checkins/types";
import { fmt, gradingOf, outOf, scoresOf, slotsFor, stateOf, teamResult, total } from "@/projects/model";
import { MAX_SLOTS, type ProjectSnapshot } from "@/projects/types";
import { FIcon } from "../icons";
import { TopBar } from "./TopBar";

export function TeamPage({
  snap,
  team,
  canGrade,
  onBack,
  onOpen,
}: {
  snap: ProjectSnapshot;
  team: TeamWithMembers;
  canGrade: boolean;
  onBack: () => void;
  onOpen: (slot: number) => void;
}) {
  const { project, categories } = snap;
  const slots = slotsFor(project, snap.gradings, team.id);
  const result = teamResult(snap, team.id);
  const max = outOf(categories);

  return (
    <div className="fv-panel te-fac pj">
      <TopBar
        onBack={onBack}
        label={`Back to ${project.title}`}
        title={team.name}
        sub={team.members.length ? team.members.map((m) => m.name).join(", ") : "No members"}
      />

      <div className="fv-scroll">
        <div className="fv-card pj-teamtotal">
          <div>
            <span className="fv-eyebrow">Team score</span>
            <div className="pj-big">
              {fmt(result.total)}
              <span className="pj-outof"> / {max}</span>
            </div>
            <div className="fv-sub">
              {result.graders
                ? `Average of ${result.graders} ${result.graders === 1 ? "grader" : "graders"}`
                : "No grader is done yet"}
            </div>
          </div>
          {result.graders ? (
            <dl className="pj-avgs">
              {categories.map((c) => (
                <div key={c.id}>
                  <dt>{c.name}</dt>
                  <dd>{fmt(result.byCategory.get(c.id) ?? null)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

        <ul className="pj-graders" aria-label="Graders">
          {slots.map((slot) => {
            const g = gradingOf(snap.gradings, team.id, slot);
            const state = stateOf(g);
            const name = g?.grader_name.trim();
            return (
              <li key={slot}>
                <button type="button" className={`fv-card pj-grader ${state}`} onClick={() => onOpen(slot)}>
                  <span className={`pj-dot ${state}`} aria-hidden="true" />
                  <span className="pj-gradername">
                    <span className="pj-slot">Grader {slot}</span>
                    {name ? <span> · {name}</span> : null}
                  </span>
                  <span className="pj-graderstate">
                    {state === "done"
                      ? `Done · ${total(scoresOf(snap.scores, team.id, slot))} / ${max}`
                      : state === "started"
                        ? "In progress"
                        : canGrade
                          ? "Grade"
                          : "Not started"}
                  </span>
                  <FIcon name="chevronRight" size={16} />
                </button>
              </li>
            );
          })}
        </ul>

        {canGrade && slots.length < MAX_SLOTS ? (
          <button type="button" className="fv-btn ghost sm pj-addgrader" onClick={() => onOpen(slots.length + 1)}>
            <FIcon name="add" size={15} /> Add a grader
          </button>
        ) : null}
      </div>
    </div>
  );
}
