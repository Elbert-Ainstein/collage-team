// The session behind a student's screen: realtime first, a poll behind it —
// a quick one while the team is still picking its leader or taking the roll,
// so a teammate's tap never waits on the slow one. The quick one reads only the
// setup, and no read ever starts while another is still out: a room of phones
// must not pile reads onto a database that's already behind.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Enrolment } from "@/checkins/studentData";
import type { LiveSetupParts } from "@/live/data";
import type { LiveSnapshot, LiveTeamSetup } from "@/live/types";

const loadLive = vi.fn<(id: string) => Promise<LiveSnapshot | null>>();
const loadLiveSetup = vi.fn<(id: string) => Promise<LiveSetupParts | null>>();
vi.mock("@/live/data", () => ({
  loadLive: (id: string) => loadLive(id),
  loadLiveSetup: (id: string) => loadLiveSetup(id),
  SETUP_TABLES: ["live_leader_votes", "live_team_setup", "tutorial_absences"],
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
  loadLiveSetup.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

/** How many reads of each kind happen in the 10 seconds after the first one lands. */
async function readsIn10s(s: LiveSnapshot): Promise<{ full: number; setup: number }> {
  loadLive.mockResolvedValue(s);
  loadLiveSetup.mockResolvedValue({ leaderVotes: s.leaderVotes, setups: s.setups, absences: s.absences });
  await act(async () => root.render(<Session />));
  const before = loadLive.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  return { full: loadLive.mock.calls.length - before, setup: loadLiveSetup.mock.calls.length };
}

describe("useLiveSession", () => {
  it("checks the setup every couple of seconds while the team picks its leader", async () => {
    const reads = await readsIn10s(snap("team", []));
    expect(reads.setup).toBeGreaterThanOrEqual(4);
    expect(reads.full).toBe(0);
  });

  it("and while the leader takes the roll", async () => {
    const reads = await readsIn10s(snap("team", [setup("s1", false)]));
    expect(reads.setup).toBeGreaterThanOrEqual(4);
    expect(reads.full).toBe(0);
  });

  it("leaves it to realtime and the slow poll once the team is playing", async () => {
    expect(await readsIn10s(snap("team", [setup("s1", true)]))).toEqual({ full: 0, setup: 0 });
  });

  it("and before class", async () => {
    expect(await readsIn10s(snap("individual", []))).toEqual({ full: 0, setup: 0 });
  });

  it("never stacks a second read on one the server hasn't answered", async () => {
    loadLive.mockResolvedValueOnce(snap("team", []));
    // The setup check hangs, as a read behind a swamped database does.
    loadLiveSetup.mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<Session />));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(loadLiveSetup).toHaveBeenCalledTimes(1);
    expect(loadLive).toHaveBeenCalledTimes(1);
  });

  it("stops saying Loading once a read fails, so the screen can offer a retry", async () => {
    let seen: { loading: boolean; failed: boolean } | null = null;
    function Probe() {
      const s = useLiveSession("a", enrolment, "t1");
      seen = { loading: s.loading, failed: s.failed };
      return null;
    }
    loadLive.mockRejectedValue(new Error("The server took too long to answer."));
    await act(async () => root.render(<Probe />));
    expect(seen).toEqual({ loading: false, failed: true });
  });
});
