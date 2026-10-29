import { describe, expect, it } from "vitest";
import { absentIds, explanationFor, isAbsent, leaderOf, leaderTally, mayLead, teamStage } from "./leader";
import type { LiveAbsence, LiveLeaderVote, LiveSnapshot, LiveTeamSetup } from "./types";

const team = ["s1", "s2", "s3"];

const vote = (student_id: string, candidate_id: string, team_id = "t1"): LiveLeaderVote => ({
  activity_id: "a",
  team_id,
  student_id,
  candidate_id,
  updated_at: "",
});
const setup = (over: Partial<LiveTeamSetup> = {}): LiveTeamSetup => ({
  activity_id: "a",
  team_id: "t1",
  leader_id: null,
  leader_at: null,
  roll_at: null,
  ...over,
});
const away = (student_id: string, team_id = "t1"): LiveAbsence => ({ activity_id: "a", team_id, student_id, source: "roll" });

function snap(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    state: {
      activity_id: "a",
      phase: "team",
      lock_rule: "any",
      show_answers: "close",
      grading: "both",
      team_started_at: "",
      closed_at: null,
      scored_at: null,
      updated_at: "",
    },
    questions: [],
    keys: [],
    responses: [],
    votes: [],
    locks: [],
    attempts: [],
    teamSetup: true,
    leaderVotes: [],
    setups: [],
    absences: [],
    roster: [],
    explanations: [],
    ...over,
  };
}

describe("leaderTally", () => {
  it("is nothing before anyone votes", () => {
    const t = leaderTally(snap(), "t1", team);
    expect(t).toMatchObject({ voted: 0, present: 3, agreed: null, split: false, everyoneVoted: false, canConfirm: false });
  });

  it("agrees on one vote, but one vote can't confirm", () => {
    const t = leaderTally(snap({ leaderVotes: [vote("s1", "s2")] }), "t1", team);
    expect(t.agreed).toBe("s2");
    expect(t.canConfirm).toBe(false);
  });

  it("two agreeing can confirm; everyone agreeing has voted", () => {
    const two = leaderTally(snap({ leaderVotes: [vote("s1", "s2"), vote("s2", "s2")] }), "t1", team);
    expect(two).toMatchObject({ agreed: "s2", voted: 2, canConfirm: true, everyoneVoted: false, counts: { s2: 2 } });
    const all = leaderTally(snap({ leaderVotes: [vote("s1", "s2"), vote("s2", "s2"), vote("s3", "s2")] }), "t1", team);
    expect(all.everyoneVoted).toBe(true);
  });

  it("is split when the votes name two people", () => {
    const t = leaderTally(snap({ leaderVotes: [vote("s1", "s2"), vote("s2", "s3")] }), "t1", team);
    expect(t).toMatchObject({ agreed: null, split: true, canConfirm: false, picks: { s1: "s2", s2: "s3" } });
  });

  it("a team of one confirms itself", () => {
    expect(leaderTally(snap({ leaderVotes: [vote("s1", "s1")] }), "t1", ["s1"]).canConfirm).toBe(true);
  });

  it("leaves out anyone absent, as voter or as candidate, and other teams", () => {
    const t = leaderTally(
      snap({
        absences: [away("s3")],
        leaderVotes: [vote("s1", "s2"), vote("s3", "s1"), vote("s2", "s3"), vote("s9", "s1", "t2")],
      }),
      "t1",
      team,
    );
    expect(t).toMatchObject({ voted: 1, present: 2, agreed: "s2", picks: { s1: "s2" } });
  });
});

describe("the leader", () => {
  it("is whoever the setup names, unless they're marked absent", () => {
    expect(leaderOf(snap({ setups: [setup({ leader_id: "s2" })] }), "t1")).toBe("s2");
    expect(leaderOf(snap({ setups: [setup({ leader_id: "s2" })], absences: [away("s2")] }), "t1")).toBeNull();
    expect(leaderOf(snap(), "t1")).toBeNull();
  });

  it("alone may submit once there is one; anyone may before", () => {
    const led = snap({ setups: [setup({ leader_id: "s2" })] });
    expect(mayLead(led, "t1", "s2")).toBe(true);
    expect(mayLead(led, "t1", "s1")).toBe(false);
    expect(mayLead(snap(), "t1", "s1")).toBe(true);
    expect(mayLead(snap({ absences: [away("s1")] }), "t1", "s1")).toBe(false);
  });

  it("gone absent, leaves nobody to submit until the team picks again", () => {
    const gone = snap({ setups: [setup({ leader_id: "s2" })], absences: [away("s2")] });
    expect(mayLead(gone, "t1", "s1")).toBe(false);
    expect(teamStage(gone, "t1")).toBe("leader");
  });
});

describe("teamStage", () => {
  it("goes leader, roll, play", () => {
    expect(teamStage(snap(), "t1")).toBe("leader");
    expect(teamStage(snap({ setups: [setup({ leader_id: "s1" })] }), "t1")).toBe("roll");
    expect(teamStage(snap({ setups: [setup({ leader_id: "s1", roll_at: "x" })] }), "t1")).toBe("play");
  });

  it("is play on a database without 0051", () => {
    expect(teamStage(snap({ teamSetup: false }), "t1")).toBe("play");
  });
});

describe("absences and explanations", () => {
  it("absentIds is the team's; isAbsent is anyone's", () => {
    const s = snap({ absences: [away("s3"), away("s9", "t2")] });
    expect(absentIds(s, "t1")).toEqual(["s3"]);
    expect(isAbsent(s, "s9")).toBe(true);
    expect(isAbsent(s, "s1")).toBe(false);
  });

  it("explanationFor reads only what came back", () => {
    const s = snap({ explanations: [{ question_id: "q1", activity_id: "a", body: "Because." }] });
    expect(explanationFor(s, "q1")).toBe("Because.");
    expect(explanationFor(s, "q2")).toBeNull();
  });
});
