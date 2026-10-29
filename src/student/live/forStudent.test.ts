import { describe, expect, it } from "vitest";
import { forStudent } from "./forStudent";

describe("forStudent", () => {
  it("passes on the sentences written for students", () => {
    expect(forStudent(new Error("Your team has already locked this one"), "x")).toBe("Your team has already locked this one");
    expect(forStudent(new Error("You're not on a team for this activity — ask your instructor to add you"), "x")).toMatch(/ask your instructor/);
    expect(forStudent(new Error("Votes are split — agree on one person"), "x")).toBe("Votes are split — agree on one person");
    expect(forStudent(new Error("Only your team's leader submits"), "x")).toBe("Only your team's leader submits");
    expect(forStudent(new Error("You're marked absent for this session — tell your team's leader if you're here"), "x")).toMatch(/marked absent/);
  });

  it("hides anything else behind the fallback", () => {
    expect(forStudent(new Error('new row violates check constraint "live_responses_answer_check"'), "Didn’t save")).toBe("Didn’t save");
    expect(forStudent("boom", "Didn’t save")).toBe("Didn’t save");
  });
});
