// The team's question screen once a try has come back wrong (0049): the tried
// answer is struck out and can't be picked again, the screen says what the
// next try is worth, and a submit sends the answer on screen.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { buildLiveModel } from "@/live/model";
import type { LiveAttempt, LiveSnapshot } from "@/live/types";

const castVote = vi.fn(async () => {});
const lockTeamAnswer = vi.fn(async () => ({}));
vi.mock("@/live/data", () => ({
  castVote: (...a: unknown[]) => castVote(...(a as [])),
  lockTeamAnswer: (...a: unknown[]) => lockTeamAnswer(...(a as [])),
}));
vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TeamQuestion } = await import("./TeamVote");

const T0 = Date.parse("2026-10-27T10:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const student = (id: string, name: string) => ({ id, name, avatar_tint: null }) as unknown as Student;
const team = { id: "t1", name: "Team 1", members: [student("s1", "Ana Lee"), student("s2", "Bo Ng")] } as unknown as TeamWithMembers;

const tryAt = (attempt: number, answer: string): LiveAttempt => ({
  question_id: "q1",
  activity_id: "a",
  team_id: "t1",
  attempt,
  answer,
  correct: false,
  locked_by: "s2",
  locked_at: iso(attempt * 10),
});

function model(attempts: LiveAttempt[], myVote: string) {
  const snap: LiveSnapshot = {
    state: {
      activity_id: "a",
      phase: "team",
      lock_rule: "any",
      show_answers: "close",
      grading: "team",
      team_started_at: iso(0),
      closed_at: null,
      scored_at: null,
      updated_at: iso(0),
    },
    questions: [
      { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "Which?", options: ["one", "two", "three", "four"], unit: null, figure_path: null, created_at: "" },
    ],
    keys: [],
    responses: [],
    votes: [
      { question_id: "q1", activity_id: "a", team_id: "t1", student_id: "s1", answer: myVote, updated_at: "" },
      { question_id: "q1", activity_id: "a", team_id: "t1", student_id: "s2", answer: "A", updated_at: "" },
    ],
    locks: [],
    attempts,
  };
  return buildLiveModel({ snapshot: snap, students: team.members, teams: [team], now: T0 + 60_000 });
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  castVote.mockClear();
  lockTeamAnswer.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const choice = (letter: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".lq-choice")].find((b) => b.querySelector(".lq-choicet")?.textContent === letter)!;

describe("TeamQuestion after a wrong try", () => {
  it("strikes out the tried answer, takes the votes off it, and says what the next try is worth", async () => {
    // Both votes still sit on A, which the team has just been told is wrong.
    await act(async () => root.render(<TeamQuestion m={model([tryAt(1, "A")], "A")} team={team} onError={() => {}} onTried={() => {}} />));
    expect(choice("one").disabled).toBe(true);
    expect(choice("one").className).toContain("out");
    expect(choice("two").disabled).toBe(false);
    expect(host.querySelector(".lq-tried")?.textContent).toContain("A isn’t it");
    expect(host.querySelector(".lq-worth")?.textContent).toBe("Try 2 · worth ½ point");
    // Nobody is on a live answer, so there's nothing to submit yet.
    expect(host.querySelector(".lq-sfoot")?.textContent).toContain("Pick another");
    expect(host.querySelector(".lq-sfoot button")).toBeNull();
  });

  it("submits the answer this screen shows, once its vote has gone in", async () => {
    const onTried = vi.fn();
    await act(async () => root.render(<TeamQuestion m={model([tryAt(1, "A")], "A")} team={team} onError={() => {}} onTried={onTried} />));
    await act(async () => choice("three").click());
    expect(castVote).toHaveBeenCalledWith("q1", "C");
    const submit = host.querySelector<HTMLButtonElement>(".lq-sfoot button")!;
    expect(submit.textContent).toContain("Submit C");
    await act(async () => submit.click());
    expect(lockTeamAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }), "C");
    expect(onTried).toHaveBeenCalled();
  });

  it("says when no points are left, and still lets the team find it", async () => {
    await act(async () =>
      root.render(
        <TeamQuestion m={model([tryAt(1, "A"), tryAt(2, "C"), tryAt(3, "D")], "D")} team={team} onError={() => {}} onTried={() => {}} />,
      ),
    );
    expect(host.querySelector(".lq-worth")?.textContent).toBe("Try 4 · worth no points");
    expect(host.querySelector(".lq-tried")?.textContent).toContain("Last try — no points left");
    expect(choice("two").disabled).toBe(false);
  });
});
