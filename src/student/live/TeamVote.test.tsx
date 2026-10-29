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
const moveTeamOn = vi.fn(async () => ({}));
vi.mock("@/live/data", () => ({
  castVote: (...a: unknown[]) => castVote(...(a as [])),
  lockTeamAnswer: (...a: unknown[]) => lockTeamAnswer(...(a as [])),
  moveTeamOn: (...a: unknown[]) => moveTeamOn(...(a as [])),
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

function model(attempts: LiveAttempt[], myVote: string, locks: LiveLock[] = [], voteOn = "q1") {
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
      { id: "q3", activity_id: "a", position: 2, kind: "number", stem: "How far?", options: [], unit: "m", figure_path: null, created_at: "" },
    ],
    keys: [],
    responses: [],
    votes: [
      { question_id: voteOn, activity_id: "a", team_id: "t1", student_id: "s1", answer: myVote, updated_at: "" },
      { question_id: voteOn, activity_id: "a", team_id: "t1", student_id: "s2", answer: voteOn === "q1" ? "A" : myVote, updated_at: "" },
    ],
    locks,
    attempts,
    teamSetup: false,
    leaderVotes: [],
    setups: [],
    absences: [],
    roster: [],
    explanations: [],
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
  moveTeamOn.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const choice = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".lq-choice")].find((b) => b.querySelector(".lq-choicet")?.textContent === text)!;
const foot = () => host.querySelector("footer")!;
const button = (label: string) => [...foot().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));
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
    // Colour only — no check or cross drawn anywhere — with the verdict in words for a screen reader.
    expect(host.querySelector(".lq-choices svg, footer svg, .lq-ownstrip svg")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Not quite. Bo submitted A");
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

  it("says when no points are left on multiple choice, and keeps the team at it", async () => {
    await show(<TeamQuestion m={model([tryAt(1, "A"), tryAt(2, "C"), tryAt(3, "D")], "D")} team={team} q={0} onError={() => {}} onTried={() => {}} />);
    expect(host.querySelector(".lq-worth")?.textContent).toBe("Try 4 · worth no points");
    expect(foot().textContent).toContain("no points left, but find it to move on");
    expect(choice("two").disabled).toBe(false);
    // The options run out, so there's no moving on from multiple choice.
    expect(button("Move on")).toBeUndefined();
  });
});

describe("TeamQuestion on a typed answer", () => {
  const wrongTries = (n: number) => Array.from({ length: n }, (_, i) => tryAt(i + 1, String(i + 1), false, "q3"));
  // Questions 1 and 2 done, so question 3 is the one the team is on and its votes show.
  const onQ3 = [lockOf(tryAt(1, "B", true, "q1")), lockOf(tryAt(1, "A", true, "q2"))];

  it("keeps going past three tries, with no count of tries left", async () => {
    await show(<TeamQuestion m={model(wrongTries(5), "A")} team={team} q={2} onError={() => {}} onTried={() => {}} />);
    expect(host.querySelector(".lq-worth")?.textContent).toBe("Try 6 · worth no points");
    expect(host.querySelector(".lq-propose")).not.toBeNull();
    expect(foot().textContent).toContain("Not quite");
    expect(foot().textContent).toContain("no points left: keep trying, or move on");
  });

  it("moves the team on, once no points are left", async () => {
    const onTried = vi.fn();
    await show(<TeamQuestion m={model(wrongTries(3), "A")} team={team} q={2} onError={() => {}} onTried={onTried} />);
    await act(async () => button("Move on")!.click());
    expect(moveTeamOn).toHaveBeenCalledWith("q3");
    expect(onTried).toHaveBeenCalled();
  });

  it("offers moving on beside Submit, and says which one is busy", async () => {
    let finish = () => {};
    moveTeamOn.mockImplementationOnce(() => new Promise((done) => (finish = () => done({}))));
    await show(<TeamQuestion m={model(wrongTries(3), "7", onQ3, "q3")} team={team} q={2} onError={() => {}} onTried={() => {}} />);
    expect(button("Submit")).toBeDefined();
    await act(async () => button("Move on")!.click());
    expect(button("Moving on…")?.disabled).toBe(true);
    expect(button("Submit")?.disabled).toBe(true);
    expect(button("Submitting…")).toBeUndefined();
    await act(async () => finish());
  });

  it("takes a fraction as a proposal, and votes for its value", async () => {
    await show(<TeamQuestion m={model([], "7", onQ3, "q3")} team={team} q={2} onError={() => {}} onTried={() => {}} />);
    const input = host.querySelector<HTMLInputElement>('input[name="proposal"]')!;
    expect(input.inputMode).toBe("text");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "1/2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLFormElement>(".lq-propose")!.requestSubmit());
    expect(castVote).toHaveBeenCalledWith("q3", "0.5");
    expect(choice("0.5 m")).toBeDefined();
  });

  it("doesn't offer moving on while another try still pays", async () => {
    await show(<TeamQuestion m={model(wrongTries(2), "7", onQ3, "q3")} team={team} q={2} onError={() => {}} onTried={() => {}} />);
    expect(button("Submit")).toBeDefined();
    expect(button("Move on")).toBeUndefined();
  });

  it("says the team moved on, once it has", async () => {
    const wrong = wrongTries(3);
    await show(
      <TeamQuestion m={model(wrong, "A", [lockOf(wrong[2])])} team={team} q={2} onError={() => {}} onTried={() => {}} onNext={() => {}} />,
    );
    expect(foot().textContent).toContain("Moved on");
    expect(foot().textContent).toContain("No points for this one");
    expect(button("Next question")).toBeDefined();
    expect(button("Move on")).toBeUndefined();
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

describe("TeamPlay, going back", () => {
  const q1 = lockOf(tryAt(1, "B", true, "q1"));
  const q2 = lockOf(tryAt(1, "A", true, "q2"));
  const back = () => host.querySelector<HTMLButtonElement>('footer [aria-label="Previous question"]');

  it("steps back to a question the team has done, and forward again", async () => {
    await show(<TeamPlay m={model([tryAt(1, "B", true, "q1")], "A", [q1], "q2")} team={team} meId="s1" onError={() => {}} onTried={() => {}} />);
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("And then?");
    await act(async () => back()!.click());
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("Which?");
    // Done: shown as it ended, with nothing to vote on or submit.
    expect(choice("two").className).toContain("right");
    expect(choice("three").disabled).toBe(true);
    expect(foot().textContent).toContain("Correct!");
    expect(button("Submit")).toBeUndefined();
    // The first question has nothing before it.
    expect(back()).toBeNull();
    await act(async () => button("Next question")!.click());
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("And then?");
  });

  it("has nothing to go back to on the first question", async () => {
    await show(<TeamPlay m={model([], "A")} team={team} meId="s1" onError={() => {}} onTried={() => {}} />);
    expect(back()).toBeNull();
  });

  it("goes back from the end to the last question", async () => {
    const q3 = lockOf(tryAt(1, "5", true, "q3"));
    await show(<TeamPlay m={model([], "A", [q1, q2, q3])} team={team} meId="s1" onError={() => {}} onTried={() => {}} />);
    expect(host.querySelector(".lq-h2")?.textContent).toBe("Your team has submitted");
    await act(async () => back()!.click());
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("How far?");
    await act(async () => button("See how you did")!.click());
    expect(host.querySelector(".lq-h2")?.textContent).toBe("Your team has submitted");
  });
});
