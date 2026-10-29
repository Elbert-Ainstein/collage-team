// Before a team plays (0051): the vote for leader, the leader's roll, a
// student marked absent, and play with only the leader submitting — plus the
// explanation, which shows once the team is done with a question.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { buildLiveModel } from "@/live/model";
import type { LiveExplanation, LiveKey, LiveLeaderVote, LiveLock, LiveResponse, LiveSnapshot, LiveTeamSetup, LiveVote, LockRule } from "@/live/types";

const voteLeader = vi.fn(async () => ({}));
const confirmLeader = vi.fn(async () => ({}));
const setAbsences = vi.fn(async () => ({}));
const castVote = vi.fn(async () => {});
const lockTeamAnswer = vi.fn(async () => ({}));
const moveTeamOn = vi.fn(async () => ({}));
vi.mock("@/live/data", () => ({
  voteLeader: (...a: unknown[]) => voteLeader(...(a as [])),
  confirmLeader: (...a: unknown[]) => confirmLeader(...(a as [])),
  setAbsences: (...a: unknown[]) => setAbsences(...(a as [])),
  castVote: (...a: unknown[]) => castVote(...(a as [])),
  lockTeamAnswer: (...a: unknown[]) => lockTeamAnswer(...(a as [])),
  moveTeamOn: (...a: unknown[]) => moveTeamOn(...(a as [])),
}));
vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TeamSession } = await import("./TeamSetup");
const { TeamIntro } = await import("./TeamVote");
const { Results } = await import("./Results");

const T0 = Date.parse("2026-10-27T10:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const student = (id: string, name: string) => ({ id, name, avatar_tint: null }) as unknown as Student;
const PEOPLE = [student("s1", "Ana Lee"), student("s2", "Bo Ng"), student("s3", "Cy Park")];

/** The team as this phone sees it: its own student first (teamFor in useLiveSession). */
const teamFor = (me: string) =>
  ({ id: "t1", name: "Team 1", members: [...PEOPLE.filter((s) => s.id === me), ...PEOPLE.filter((s) => s.id !== me)] }) as unknown as TeamWithMembers;

const pick = (student_id: string, candidate_id: string): LiveLeaderVote => ({ activity_id: "a", team_id: "t1", student_id, candidate_id, updated_at: iso(1) });
const vote = (student_id: string, answer: string): LiveVote => ({ question_id: "q1", activity_id: "a", team_id: "t1", student_id, answer, updated_at: iso(2) });
const setup = (leader_id: string | null, rolled = false): LiveTeamSetup => ({
  activity_id: "a",
  team_id: "t1",
  leader_id,
  leader_at: leader_id ? iso(3) : null,
  roll_at: rolled ? iso(4) : null,
});
const lockQ1: LiveLock = { question_id: "q1", activity_id: "a", team_id: "t1", answer: "B", correct: true, locked_by: "s1", locked_at: iso(10) };

interface Opts {
  me?: string;
  leaderVotes?: LiveLeaderVote[];
  setups?: LiveTeamSetup[];
  absent?: string[];
  /** Marked absent by staff, on the sheet. */
  sheetAbsent?: string[];
  votes?: LiveVote[];
  locks?: LiveLock[];
  explanations?: LiveExplanation[];
  rule?: LockRule;
  phase?: "team" | "closed";
  keys?: LiveKey[];
  responses?: LiveResponse[];
}

function model({ me = "s1", leaderVotes = [], setups = [], absent = [], sheetAbsent = [], votes = [], locks = [], explanations = [], rule = "any", phase = "team", keys = [], responses = [] }: Opts) {
  const team = teamFor(me);
  const snap: LiveSnapshot = {
    state: {
      activity_id: "a",
      phase,
      lock_rule: rule,
      show_answers: "close",
      grading: "team",
      team_started_at: iso(0),
      closed_at: null,
      scored_at: null,
      updated_at: iso(0),
    },
    questions: [
      { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "Which?", options: ["one", "two", "three"], unit: null, figure_path: null, created_at: "" },
      { id: "q2", activity_id: "a", position: 1, kind: "mc", stem: "And then?", options: ["yes", "no"], unit: null, figure_path: null, created_at: "" },
    ],
    keys,
    responses,
    votes,
    locks,
    attempts: locks.map((l) => ({ ...l, attempt: 1 })),
    teamSetup: true,
    leaderVotes,
    setups,
    absences: [
      ...absent.map((student_id) => ({ activity_id: "a", team_id: "t1", student_id, source: "roll" as const })),
      ...sheetAbsent.map((student_id) => ({ activity_id: "a", team_id: "t1", student_id, source: "sheet" as const })),
    ],
    roster: [],
    explanations,
  };
  return { m: buildLiveModel({ snapshot: snap, students: team.members, teams: [team], now: T0 + 60_000 }), team, me };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  for (const f of [voteLeader, confirmLeader, setAbsences, castVote, lockTeamAnswer, moveTeamOn]) f.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
const session = (o: Opts, onChanged = vi.fn()) => {
  const { m, team, me } = model(o);
  return show(<TeamSession m={m} team={team} meId={me} onError={() => {}} onChanged={onChanged} />);
};
const row = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".lq-choice")].find((b) => b.querySelector(".lq-choicet")?.textContent === text)!;
const foot = () => host.querySelector("footer")!;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));

describe("picking a leader", () => {
  it("lists the whole team, and a tap votes", async () => {
    const onChanged = vi.fn();
    await session({}, onChanged);
    expect(host.querySelector(".lq-setupq")?.textContent).toBe("Who submits for the team?");
    expect([...host.querySelectorAll(".lq-choicet")].map((n) => n.textContent)).toEqual(["You", "Bo Ng", "Cy Park"]);
    expect(foot().textContent).toContain("Pick one");
    expect(foot().textContent).toContain("0 of 3 voted");
    await act(async () => row("Bo Ng").click());
    expect(voteLeader).toHaveBeenCalledWith("a", "s2");
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows who voted for whom, and offers Confirm once two agree", async () => {
    await session({ leaderVotes: [pick("s1", "s2"), pick("s3", "s2")] });
    expect(row("Bo Ng").getAttribute("aria-checked")).toBe("true");
    expect(row("Bo Ng").className).toContain("agreed");
    expect(row("Bo Ng").querySelectorAll(".lq-voterpop")).toHaveLength(2);
    expect(foot().textContent).toContain("All on Bo");
    expect(foot().textContent).toContain("2 of 3 voted");
    await act(async () => button("Confirm Bo")!.click());
    expect(confirmLeader).toHaveBeenCalledWith("a");
  });

  it("says plainly when votes are split, with nothing to confirm", async () => {
    await session({ leaderVotes: [pick("s1", "s2"), pick("s3", "s3")] });
    expect(foot().textContent).toContain("Votes are split — agree on one person");
    expect(button("Confirm")).toBeUndefined();
  });

  it("waits for a second vote before anyone can confirm", async () => {
    await session({ leaderVotes: [pick("s1", "s2")] });
    expect(foot().textContent).toContain("Wait for one more vote");
    expect(button("Confirm")).toBeUndefined();
  });

  it("doesn't offer Confirm to someone who hasn't voted", async () => {
    await session({ me: "s2", leaderVotes: [pick("s1", "s3"), pick("s3", "s3")] });
    expect(foot().textContent).toContain("Pick one");
    expect(button("Confirm")).toBeUndefined();
  });

  it("leaves out anyone marked absent", async () => {
    await session({ absent: ["s3"], setups: [setup("s3", true)] });
    // Their leader was marked absent: the team picks again, from who's here.
    expect([...host.querySelectorAll(".lq-choicet")].map((n) => n.textContent)).toEqual(["You", "Bo Ng"]);
    expect(foot().textContent).toContain("0 of 2 voted");
  });
});

describe("once everyone has voted the same", () => {
  // vote_live_leader set the leader on the last vote: no Confirm needed.
  const all = [pick("s1", "s1"), pick("s2", "s1"), pick("s3", "s1")];

  it("the leader takes the roll: all here by default, each tap saved as it goes", async () => {
    const onChanged = vi.fn();
    await session({ leaderVotes: all, setups: [setup("s1")] }, onChanged);
    expect(host.querySelector(".lq-setupq")?.textContent).toBe("Who’s here?");
    expect([...host.querySelectorAll(".lq-choicet")].map((n) => n.textContent)).toEqual(["Bo Ng", "Cy Park"]);
    expect(foot().textContent).toContain("3 of 3 here");
    await act(async () => row("Cy Park").click());
    expect(row("Cy Park").getAttribute("aria-checked")).toBe("false");
    expect(row("Cy Park").textContent).toContain("Absent");
    expect(foot().textContent).toContain("2 of 3 here");
    // The team sees it at once; the roll isn't finished until Continue.
    expect(setAbsences).toHaveBeenLastCalledWith("a", ["s3"], false);
    await act(async () => button("Continue")!.click());
    expect(setAbsences).toHaveBeenLastCalledWith("a", ["s3"], true);
    expect(onChanged).toHaveBeenCalled();
  });

  it("an absence staff marked on the sheet is fixed, and never sent", async () => {
    await session({ leaderVotes: all, setups: [setup("s1")], sheetAbsent: ["s2"] });
    expect(row("Bo Ng").disabled).toBe(true);
    expect(row("Bo Ng").textContent).toContain("Absent · instructor");
    expect(foot().textContent).toContain("2 of 3 here");
    await act(async () => row("Cy Park").click());
    await act(async () => button("Continue")!.click());
    expect(setAbsences).toHaveBeenLastCalledWith("a", ["s3"], true);
  });

  it("everyone else sees the same roll, as the leader takes it", async () => {
    await session({ me: "s2", leaderVotes: all, setups: [setup("s1")], absent: ["s3"] });
    expect(host.querySelector(".lq-setupq")?.textContent).toBe("Who’s here?");
    // Everyone but the leader, who is plainly there.
    expect([...host.querySelectorAll(".lq-choicet")].map((n) => n.textContent)).toEqual(["You", "Cy Park"]);
    expect(row("Cy Park").textContent).toContain("Absent");
    expect(foot().textContent).toContain("2 of 3 here");
    expect(foot().textContent).toContain("Ana submits for the team");
    expect(button("Continue")).toBeUndefined();
    await act(async () => row("You").click());
    expect(setAbsences).not.toHaveBeenCalled();
  });
});

describe("marked absent", () => {
  it("says so, names the leader to tell, and offers nothing to vote on", async () => {
    await session({ me: "s3", setups: [setup("s1", true)], absent: ["s3"] });
    expect(host.textContent).toContain("Marked absent for this session");
    expect(host.textContent).toContain("Tell Ana");
    expect(host.querySelector("button")).toBeNull();
  });
});

describe("playing, with a leader", () => {
  const playing = { setups: [setup("s1", true)], absent: ["s3"], votes: [vote("s1", "B"), vote("s2", "B")] };

  it("the leader submits — an absent teammate doesn't hold the team up", async () => {
    await session({ ...playing, rule: "all" });
    expect(foot().textContent).toContain("All on B");
    expect(button("Lock in B")).toBeDefined();
    expect(host.querySelector(".lq-leadline")?.textContent).toContain("You submit for the team");
    expect([...host.querySelectorAll(".lq-ownname")].map((n) => n.textContent)).toEqual(["You", "Bo"]);
  });

  it("a teammate votes, but sees who submits instead of the button", async () => {
    await session({ ...playing, me: "s2" });
    expect(foot().textContent).toContain("All on B");
    expect(foot().textContent).toContain("Ana submits for the team");
    expect(button("Submit")).toBeUndefined();
    expect(button("Lock in")).toBeUndefined();
    expect(host.querySelector(".lq-leadline")).toBeNull();
    await act(async () => row("three").click());
    expect(castVote).toHaveBeenCalledWith("q1", "C");
    expect(button("Submit")).toBeUndefined();
  });

  it("the leader can take the roll again", async () => {
    await session(playing);
    await act(async () => button("Who’s here")!.click());
    expect(host.querySelector(".lq-setupq")?.textContent).toBe("Who’s here?");
    expect(row("Cy Park").getAttribute("aria-checked")).toBe("false");
    await act(async () => row("Cy Park").click());
    expect(setAbsences).toHaveBeenLastCalledWith("a", [], false);
    await act(async () => button("Done")!.click());
    expect(setAbsences).toHaveBeenLastCalledWith("a", [], true);
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("Which?");
  });

  it("the leader can still fix the roll once the team is done", async () => {
    const lockQ2: LiveLock = { ...lockQ1, question_id: "q2", answer: "A" };
    await session({ ...playing, locks: [lockQ1, lockQ2] });
    expect(host.textContent).toContain("Your team has submitted");
    expect(button("Who’s here · 2/3")).toBeDefined();
    await act(async () => button("Who’s here")!.click());
    await act(async () => row("Cy Park").click());
    await act(async () => button("Done")!.click());
    expect(setAbsences).toHaveBeenLastCalledWith("a", [], true);
  });

  it("anyone can go back a question, not just the leader", async () => {
    await session({ ...playing, me: "s2", locks: [lockQ1] });
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("And then?");
    await act(async () => host.querySelector<HTMLButtonElement>('footer [aria-label="Previous question"]')!.click());
    expect(host.querySelector(".lq-sstem")?.textContent).toBe("Which?");
  });

  it("a teammate's done screen has no roll", async () => {
    const lockQ2: LiveLock = { ...lockQ1, question_id: "q2", answer: "A" };
    await session({ ...playing, me: "s2", locks: [lockQ1, lockQ2] });
    expect(host.textContent).toContain("Your team has submitted");
    expect(button("Who’s here")).toBeUndefined();
  });
});

describe("explanations", () => {
  const why: LiveExplanation[] = [{ question_id: "q1", activity_id: "a", body: "Because two is the one." }];
  const playing = { setups: [setup("s1", true)], explanations: why };

  it("stay hidden while the team is still on the question", async () => {
    await session({ ...playing, votes: [vote("s1", "B")] });
    expect(host.querySelector(".lq-swhy")).toBeNull();
  });

  it("show under the question once the team is done with it", async () => {
    const { m, team } = model({ ...playing, locks: [lockQ1] });
    const { TeamQuestion } = await import("./TeamVote");
    await show(<TeamQuestion m={m} team={team} q={0} onError={() => {}} onTried={() => {}} onNext={() => {}} />);
    expect(host.querySelector(".lq-swhy")?.textContent).toContain("Because two is the one.");
  });

  it("show in the results, under their question", async () => {
    const key = (question_id: string, correct_option: number): LiveKey => ({ question_id, activity_id: "a", correct_option, answer: null, tolerance: null, accept: [] });
    const own: LiveResponse = { question_id: "q1", activity_id: "a", student_id: "s1", answer: "A", correct: false, updated_at: iso(0) };
    const { m, team } = model({ ...playing, locks: [lockQ1], phase: "closed", keys: [key("q1", 1), key("q2", 0)], responses: [own] });
    await show(<Results m={m} team={team} meId="s1" />);
    const cards = host.querySelectorAll(".lq-sres");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".lq-swhy")?.textContent).toContain("Because two is the one.");
    expect(cards[1].querySelector(".lq-swhy")).toBeNull();
  });
});

describe("Results for a student marked absent", () => {
  it("gives them none of the team's points", async () => {
    const key = (question_id: string, correct_option: number): LiveKey => ({ question_id, activity_id: "a", correct_option, answer: null, tolerance: null, accept: [] });
    const own: LiveResponse = { question_id: "q1", activity_id: "a", student_id: "s2", answer: "B", correct: true, updated_at: iso(0) };
    const { m, team } = model({ me: "s2", setups: [setup("s1", true)], absent: ["s2"], locks: [lockQ1], phase: "closed", keys: [key("q1", 1), key("q2", 0)], responses: [own] });
    await show(<Results m={m} team={team} meId="s2" />);
    const stat = host.querySelector(".lq-stat.team")!;
    expect(stat.textContent).toContain("Absent");
    expect(stat.querySelector(".lq-statnum")?.textContent).toBe("0/2");
  });
});

describe("TeamIntro", () => {
  it("says one of the team submits for everyone", async () => {
    await show(<TeamIntro team={teamFor("s1")} rule="any" leader onStart={() => {}} />);
    expect(host.textContent).toContain("First, pick who submits for the team.");
  });

  it("keeps the old line on a database without leaders", async () => {
    await show(<TeamIntro team={teamFor("s1")} rule="any" onStart={() => {}} />);
    expect(host.textContent).not.toContain("pick who submits");
  });
});
