// When a student's own hand-in closes. The database decides (0044), and these
// functions are the app saying so first — so they have to agree with it to the
// millisecond at the one moment anybody is watching: the deadline itself.

import { describe, expect, it } from "vitest";
import { handInClosed, indivDueAt, msUntilClose, pastDeadline } from "./handIn";

const DUE = "2026-10-09T13:00:00.000Z";
const at = Date.parse(DUE);
const dated = { due_at: DUE, individual_due_at: null };

describe("the individual deadline", () => {
  it("is due_at, and the older per-half column only when due_at is unset", () => {
    expect(indivDueAt({ due_at: DUE, individual_due_at: "2026-01-01T00:00:00Z" })).toBe(DUE);
    expect(indivDueAt({ due_at: null, individual_due_at: DUE })).toBe(DUE);
    expect(indivDueAt({ due_at: null, individual_due_at: null })).toBeNull();
  });
});

describe("pastDeadline", () => {
  it("is still open AT the deadline, as 0044's now() <= due reads it", () => {
    expect(pastDeadline(dated, at)).toBe(false);
  });

  it("closes the millisecond after", () => {
    expect(pastDeadline(dated, at + 1)).toBe(true);
  });

  it("never closes an activity with no due date", () => {
    expect(pastDeadline({ due_at: null, individual_due_at: null }, at + 1e12)).toBe(false);
  });

  // A broken stamp is not a deadline. Closing on one would take the hand-in
  // away from a whole class with nothing on screen to say why.
  it("reads an unparseable stamp as open", () => {
    expect(pastDeadline({ due_at: "not a date", individual_due_at: null }, at)).toBe(false);
  });
});

describe("handInClosed", () => {
  it("closes past the deadline", () => {
    expect(handInClosed(dated, false, at + 1)).toBe(true);
  });

  it("stays open for a student it was reopened for", () => {
    expect(handInClosed(dated, true, at + 1)).toBe(false);
  });

  it("is open to everyone before the deadline, reopened or not", () => {
    expect(handInClosed(dated, false, at - 1)).toBe(false);
    expect(handInClosed(dated, true, at - 1)).toBe(false);
  });
});

describe("msUntilClose", () => {
  // The screen re-renders when this fires, and has to find the hand-in closed
  // when it does — so it lands one past the deadline, not on it.
  it("fires the first millisecond the hand-in is closed", () => {
    const wait = msUntilClose(DUE, at - 5000);
    expect(wait).toBe(5001);
    expect(pastDeadline(dated, at - 5000 + (wait ?? 0))).toBe(true);
  });

  it("has nothing to wait for once closed, or with no deadline", () => {
    expect(msUntilClose(DUE, at + 1)).toBeNull();
    expect(msUntilClose(null, at)).toBeNull();
  });

  // setTimeout holds a 32-bit delay and fires at once past it, which would
  // close a hand-in a month early on screen.
  it("does not ask for a timer setTimeout cannot hold", () => {
    expect(msUntilClose(DUE, at - 40 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});
