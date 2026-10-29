// The session behind a student's screen: realtime first, a poll behind it —
// a quick one while the team is still picking its leader or taking the roll,
// so a teammate's tap never waits on the slow one.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Enrolment } from "@/checkins/studentData";
import type { LiveSnapshot, LiveTeamSetup } from "@/live/types";

const loadLive = vi.fn<(id: string) => Promise<LiveSnapshot | null>>();
vi.mock("@/live/data", () => ({
  loadLive: (id: string) => loadLive(id),
  watchLive: () => () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useLiveSession } = await import("./useLiveSession");

const enrolment = {
  student: { id: "s1", name: "Ana Lee", avatar_tint: null },
  course: { id: "c" },
  team: { id: "t1", name: "Team 1" },
  teammates: [{ id: "s2", name: "Bo Ng", avatar_tint: null }],
} as unknown as Enrolment;

const setup = (leader_id: string | null, rolled: boolean): LiveTeamSetup => ({
  activity_id: "a",
  team_id: "t1",
  leader_id,
  leader_at: leader_id ? "2026-10-28T10:00:00Z" : null,
  roll_at: rolled ? "2026-10-28T10:01:00Z" : null,
});

const snap = (phase: "individual" | "team", setups: LiveTeamSetup[]): LiveSnapshot => ({
  state: { activity_id: "a", phase, lock_rule: "any", show_answers: "close", grading: "both", team_started_at: null, closed_at: null, scored_at: null, updated_at: "" },
  questions: [],
  keys: [],
  responses: [],
  votes: [],
  locks: [],
  attempts: [],
  teamSetup: true,
  leaderVotes: [],
  setups,
  absences: [],
  roster: [
    { team_id: "t1", student_id: "s1", name: "Ana Lee", avatar_tint: null },
    { team_id: "t1", student_id: "s2", name: "Bo Ng", avatar_tint: null },
  ],
  explanations: [],
});

function Session() {
  useLiveSession("a", enrolment, "t1");
  return null;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  loadLive.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

/** How many reads happen in the 10 seconds after the first one lands. */
async function readsIn10s(s: LiveSnapshot): Promise<number> {
  loadLive.mockResolvedValue(s);
  await act(async () => root.render(<Session />));
  const before = loadLive.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(10_000));
  return loadLive.mock.calls.length - before;
}

describe("useLiveSession", () => {
  it("checks every couple of seconds while the team picks its leader", async () => {
    expect(await readsIn10s(snap("team", []))).toBeGreaterThanOrEqual(4);
  });

  it("and while the leader takes the roll", async () => {
    expect(await readsIn10s(snap("team", [setup("s1", false)]))).toBeGreaterThanOrEqual(4);
  });

  it("leaves it to realtime and the slow poll once the team is playing", async () => {
    expect(await readsIn10s(snap("team", [setup("s1", true)]))).toBe(0);
  });

  it("and before class", async () => {
    expect(await readsIn10s(snap("individual", []))).toBe(0);
  });
});
