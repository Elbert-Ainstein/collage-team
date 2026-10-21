import { describe, expect, it } from "vitest";
import { liveStatus, liveStatusLabel } from "./status";

const now = new Date("2026-10-27T12:00:00Z");
const before = "2026-10-27T10:00:00Z";
const after = "2026-10-28T10:00:00Z";

describe("liveStatus", () => {
  it("follows the session until there's a grade", () => {
    expect(liveStatus({ phase: "individual", answered: 0, questions: 5 }, "Not started", after, now)).toBe("Not started");
    expect(liveStatus({ phase: "individual", answered: 5, questions: 5 }, "Not started", after, now)).toBe("Turned in");
    expect(liveStatus({ phase: "individual", answered: 2, questions: 5 }, "Not started", before, now)).toBe("Late");
    expect(liveStatus({ phase: "team", answered: 5, questions: 5 }, "Not started", before, now)).toBe("Discussing");
    expect(liveStatus({ phase: "closed", answered: 3, questions: 5 }, "Not started", before, now)).toBe("Turned in");
  });

  it("lets a grade win", () => {
    expect(liveStatus({ phase: "closed", answered: 3, questions: 5 }, "Graded", before, now)).toBe("Graded");
    expect(liveStatus({ phase: "team", answered: 0, questions: 5 }, "Excused", before, now)).toBe("Excused");
  });

  it("keeps the ordinary status without session data", () => {
    expect(liveStatus(undefined, "Not started", null, now)).toBe("Not started");
  });
});

describe("liveStatusLabel", () => {
  it("says team mode, and how far along a student is", () => {
    expect(liveStatusLabel("Discussing", { phase: "team", answered: 5, questions: 5 })).toBe("Team mode on");
    expect(liveStatusLabel("Not started", { phase: "individual", answered: 3, questions: 5 })).toBe("3 of 5 answered");
    expect(liveStatusLabel("Turned in", { phase: "individual", answered: 5, questions: 5 })).toBeNull();
    expect(liveStatusLabel("Not started", undefined)).toBeNull();
  });
});
