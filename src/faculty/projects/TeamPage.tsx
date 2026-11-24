"use client";

// One team on a project: its graders, each with how far they've got, and —
// once they've started — what they gave in every category and why. The
// team's score sits at the top: each category averaged over the done
// gradings. Press a grader to open their sheet, or add another grader.

import type { TeamWithMembers } from "@/checkins/types";
import {
  fmt,
  gradingOf,
  outOf,
  scoresOf,
  slotsFor,
  stateOf,
  teamResult,
  total,
} from "@/projects/model";
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
                ? `Averaged over ${result.graders} done ${result.graders === 1 ? "grading" : "gradings"}`
                : "No grading marked done yet"}
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
            const mine = scoresOf(snap.scores, team.id, slot);
            const scored = mine.filter((s) => s.score !== null).length;
            return (
              <li key={slot} className={`fv-card pj-grader ${state}`}>
                <button type="button" className="pj-graderhead" onClick={() => onOpen(slot)}>
                  <span className={`pj-dot ${state}`} aria-hidden="true" />
                  <span className="pj-gradername">
                    <span className="pj-slot">Grader {slot}</span>
                    {g?.grader_name.trim() ? <span> · {g.grader_name.trim()}</span> : null}
                  </span>
                  <span className="pj-graderstate">
                    {state === "done"
                      ? `Done · ${total(mine)} / ${max}`
                      : state === "started"
                        ? `In progress · ${scored} of ${categories.length} scored`
                        : "Not started"}
                  </span>
                  <span className="pj-graderact">
                    {!canGrade ? "View" : state === "empty" ? "Grade" : state === "done" ? "Open" : "Continue"}
                    <FIcon name="chevronRight" size={15} />
                  </span>
                </button>
                {state !== "empty" && mine.length ? (
                  <table className="pj-detail">
                    <tbody>
                      {categories.map((c) => {
                        const s = mine.find((x) => x.category_id === c.id);
                        return (
                          <tr key={c.id}>
                            <th scope="row">{c.name}</th>
                            <td>
                              {s?.score ? (
                                <span className={`te-score s${s.score}`}>{s.score}</span>
                              ) : (
                                <span className="pj-nil">—</span>
                              )}
                            </td>
                            <td className="pj-why">{s?.reason.trim() || <span className="pj-nil">No reason yet</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}
              </li>
            );
          })}
        </ul>

        {canGrade && slots.length < MAX_SLOTS ? (
          <button type="button" className="fv-btn outline sm pj-addgrader" onClick={() => onOpen(slots.length + 1)}>
            <FIcon name="add" size={15} /> Add a grader
          </button>
        ) : null}
      </div>
    </div>
  );
}
