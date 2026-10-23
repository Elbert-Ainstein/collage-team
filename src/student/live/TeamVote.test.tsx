// The team's question screen with tries (0049), Khan Academy style: a wrong
// try turns red where it sits and the bar at the bottom says so; a question
// the team has got stays on screen, green, until this phone presses Next.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { buildLiveModel } from "@/live/model";
import type { LiveAttempt, LiveLock, LiveSnapshot } from "@/live/types";

const castVote = vi.fn(async () => {});
const lockTeamAnswer = vi.fn(async () => ({}));
vi.mock("@/live/data", () => ({
  castVote: (...a: unknown[]) => castVote(...(a as [])),
  lockTeamAnswer: (...a: unknown[]) => lockTeamAnswer(...(a as [])),
}));
vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TeamPlay, TeamQuestion } = await import("./TeamVote");

const T0 = Date.parse("2026-10-27T10:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const student = (id: string, name: string) => ({ id, name, avatar_tint: null }) as unknown as Student;
const team = { id: "t1", name: "Team 1", members: [student("s1", "Ana Lee"), student("s2", "Bo Ng")] } as unknown as TeamWithMembers;

const tryAt = (attempt: number, answer: string, correct = false, question_id = "q1"): LiveAttempt => ({
  question_id,
  activity_id: "a",
  team_id: "t1",
  attempt,
  answer,
  correct,
  locked_by: "s2",
  locked_at: iso(attempt * 10),
});
const lockOf = (t: LiveAttempt): LiveLock => ({
  question_id: t.question_id,
  activity_id: "a",
  team_id: "t1",
  answer: t.answer,
  correct: t.correct,
  locked_by: t.locked_by,
  locked_at: t.locked_at,
});

function model(attempts: LiveAttempt[], myVote: string, locks: LiveLock[] = []) {
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
      { id: "q2", activity_id: "a", position: 1, kind: "mc", stem: "And then?", options: ["yes", "no"], unit: null, figure_path: null, created_at: "" },
    ],
    keys: [],
    responses: [],
    votes: [
      { question_id: "q1", activity_id: "a", team_id: "t1", student_id: "s1", answer: myVote, updated_at: "" },
      { question_id: "q1", activity_id: "a", team_id: "t1", student_id: "s2", answer: "A", updated_at: "" },
    ],
    locks,
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

const choice = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".lq-choice")].find((b) => b.querySelector(".lq-choicet")?.textContent === text)!;
const foot = () => host.querySelector("footer")!;
const show = (node: React.ReactNode) => act(async () => root.render(node));

describe("TeamQuestion after a wrong try", () => {
  it("turns the wrong answer red, takes the votes off it, and says so at the bottom", async () => {
    // Both votes still sit on A, which the team has just been told is wrong.
    await show(<TeamQuestion m={model([tryAt(1, "A")], "A")} team={team} q={0} onError={() => {}} onTried={() => {}} />);
    expect(choice("one").disabled).toBe(true);
    expect(choice("one").className).toContain("wrong");
    expect(choice("one").querySelector(".lq-choicel")?.textContent).toBe("A");
    expect(choice("two").disabled).toBe(false);
    expect(host.querySelector(".lq-worth")?.textContent).toBe("Try 2 · worth 0.5 points");
    expect(foot().className).toContain("fb wrong");
    expect(foot().textContent).toContain("Not quite");
    expect(foot().textContent).toContain("Bo submitted A — pick another, worth 0.5 points");
    // Nobody is on a live answer, so there's nothing to submit yet.
    expect(foot().querySelector("button")).toBeNull();
  });

  it("submits the answer this screen shows, once its vote has gone in", async () => {
    const onTried = vi.fn();
    await show(<TeamQuestion m={model([tryAt(1, "A")], "A")} team={team} q={0} onError={() => {}} onTried={onTried} />);
    await act(async () => choice("three").click());
    expect(castVote).toHaveBeenCalledWith("q1", "C");
    // Picking another clears the red bar back to voting.
    expect(foot().className).not.toContain("fb");
    const submit = foot().querySelector<HTMLButtonElement>("button")!;
    expect(submit.textContent).toContain("Submit C");
    await act(async () => submit.click());
    expect(lockTeamAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }), "C");
    expect(onTried).toHaveBeenCalled();
  });

  it("says when no points are left, and still lets the team find it", async () => {
    await show(<TeamQuestion m={model([tryAt(1, "A"), tryAt(2, "C"), tryAt(3, "D")], "D")} team={team} q={0} onError={() => {}} onTried={() => {}} />);
    expect(host.querySelector(".lq-worth")?.textContent).toBe("Try 4 · worth no points");
    expect(foot().textContent).toContain("no points left, but find it to move on");
    expect(choice("two").disabled).toBe(false);
  });
});

describe("TeamPlay once the team has it", () => {
  it("holds the question, green, until Next", async () => {
    await show(<TeamPlay m={model([tryAt(1, "A")], "B")} team={team} meId="s1" onError={() => {}} onTried={() => {}} />);
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("Which?");

    // B lands, right on the second try: the team moves on to question 2.
    const right = tryAt(2, "B", true);
    await show(<TeamPlay m={model([tryAt(1, "A"), right], "B", [lockOf(right)])} team={team} meId="s1" onError={() => {}} onTried={() => {}} />);
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("Which?");
    expect(choice("two").className).toContain("right");
    expect(choice("one").className).toContain("wrong");
    expect(foot().className).toContain("fb right");
    expect(foot().textContent).toContain("Correct!");
    expect(foot().textContent).toContain("Bo submitted B · +0.5 points");

    await act(async () => foot().querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("And then?");
  });
});
