import { describe, expect, it } from "vitest";
import { ada, alan, grace, kj, roster, student, team, team1, team2, teams } from "./fixtures";
import { buildSnapshot } from "./snapshot";

const course = { name: "AP 50", code: "AP50A", term: "Fall" };

describe("buildSnapshot", () => {
  it("gives students and teams short refs in the order the screen shows them", () => {
    const { snapshot, refs } = buildSnapshot({ course, roster, teams });
    expect(snapshot.students.map((s) => [s.ref, s.name])).toEqual([
      ["s1", "Ada Lovelace"],
      ["s2", "Alan Turing"],
      ["s3", "Grace Hopper"],
      ["s4", "Katherine Johnson"],
    ]);
    expect(snapshot.teams).toEqual([
      { ref: "t1", name: "Team 1", members: ["s1", "s2"] },
      { ref: "t2", name: "Team 2", members: ["s3"] },
    ]);
    expect(refs.students.get("s4")).toBe(kj.id);
    expect(refs.teams.get("t2")).toBe(team2.id);
  });

  it("orders by position, not by the order the rows arrived in", () => {
    const { snapshot } = buildSnapshot({ course, roster: [kj, grace, alan, ada], teams: [team2, team1] });
    expect(snapshot.students[0].name).toBe("Ada Lovelace");
    expect(snapshot.teams[0].name).toBe("Team 1");
  });

  it("leaves out a member who is not on the roster", () => {
    const ghost = student("st-ghost", "Nobody", null, 9);
    const { snapshot } = buildSnapshot({ course, roster, teams: [team("tm-x", "Team X", 0, [ghost, ada])] });
    expect(snapshot.teams[0].members).toEqual(["s1"]);
  });

  // A student's name comes from their own sign-up, uncapped. One very long one
  // must shorten in the snapshot, not get every request for the course refused.
  it("shortens a name too long to be a name, rather than sending it whole", () => {
    const long = student("st-long", "x".repeat(5000), null, 9);
    const { snapshot } = buildSnapshot({ course, roster: [long], teams: [] });
    expect(snapshot.students[0].name.length).toBeLessThanOrEqual(120);
  });

  it("carries the course's name, code and term", () => {
    expect(buildSnapshot({ course: { name: "AP 50", code: null, term: null }, roster: [], teams: [] }).snapshot)
      .toEqual({ course: { name: "AP 50", code: null, term: null }, students: [], teams: [] });
  });
});
