// A whole lecture hall on one live activity, against a database that slows as
// load rises, stops answering, or fails every read at once. What must hold, in
// every case: no device ever has two reads out, reads stay few while the
// database struggles, nobody has to press anything, and every device is back
// with fresh data soon after the database is.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Enrolment } from "@/checkins/studentData";
import type { LiveSetupParts } from "@/live/data";
import type { LiveSnapshot, LiveTeamSetup } from "@/live/types";

const ROOM = 300;
/** What fetchWithTimeout turns a read the server never answers into. */
const TIMEOUT_MS = 20_000;

type Mode = "ok" | "silent" | "erroring";

/** A database shared by the whole room: each device reads its own activity id, so reads can be told apart. */
const db = {
  mode: "ok" as Mode,
  phase: "team" as "individual" | "team",
  setups: [] as LiveTeamSetup[],
  inFlight: new Map<string, number>(),
  worst: 0,
  total: 0,
  calls: new Map<string, number>(),
  reset() {
    this.mode = "ok";
    this.phase = "team";
    this.setups = [];
    this.inFlight.clear();
    this.calls.clear();
    this.worst = 0;
    this.total = 0;
  },
};

function answer<T>(id: string, value: () => T): Promise<T> {
  const mode = db.mode;
  const out = (db.inFlight.get(id) ?? 0) + 1;
  db.inFlight.set(id, out);
  db.worst = Math.max(db.worst, out);
  db.total++;
  db.calls.set(id, (db.calls.get(id) ?? 0) + 1);
  const inFlightNow = [...db.inFlight.values()].reduce((a, b) => a + b, 0);
  const done = () => db.inFlight.set(id, (db.inFlight.get(id) ?? 1) - 1);
  return new Promise<T>((resolve, reject) => {
    if (mode === "ok") {
      // Slower the more reads are already waiting on it.
      setTimeout(() => {
        done();
        resolve(value());
      }, 200 + 3 * inFlightNow);
    } else if (mode === "silent") {
      setTimeout(() => {
        done();
        reject(new Error("The server took too long to answer."));
      }, TIMEOUT_MS);
    } else {
      setTimeout(() => {
        done();
        reject(new Error("503"));
      }, 50);
    }
  });
}

const snapFor = (id: string): LiveSnapshot => ({
  state: { activity_id: id, phase: db.phase, lock_rule: "any", show_answers: "close", grading: "both", team_started_at: null, closed_at: null, scored_at: null, updated_at: "" },
  questions: [],
  keys: [],
  responses: [],
  votes: [],
  locks: [],
  attempts: [],
  teamSetup: true,
  leaderVotes: [],
  setups: db.setups.map((s) => ({ ...s, activity_id: id })),
  absences: [],
  roster: [
    { team_id: "t1", student_id: "s1", name: "Ana Lee", avatar_tint: null },
    { team_id: "t1", student_id: "s2", name: "Bo Ng", avatar_tint: null },
  ],
  explanations: [],
});

const watchers = new Map<string, (table: string) => void>();
vi.mock("@/live/data", () => ({
  loadLive: (id: string) => answer(id, () => snapFor(id)),
  loadLiveSetup: (id: string) =>
    answer<LiveSetupParts>(id, () => {
      const s = snapFor(id);
      return { leaderVotes: s.leaderVotes, setups: s.setups, absences: s.absences };
    }),
  SETUP_TABLES: ["live_leader_votes", "live_team_setup", "tutorial_absences"],
  watchLive: (id: string, onChange: (table: string) => void) => {
    watchers.set(id, onChange);
    return () => watchers.delete(id);
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useLiveSession } = await import("./useLiveSession");

const enrolment = {
  student: { id: "s1", name: "Ana Lee", avatar_tint: null },
  course: { id: "c" },
  team: { id: "t1", name: "Team 1" },
  teammates: [{ id: "s2", name: "Bo Ng", avatar_tint: null }],
} as unknown as Enrolment;

interface Seen {
  loading: boolean;
  failed: boolean;
  setups: number;
  loaded: boolean;
}
const seen: Seen[] = [];

function Device({ i }: { i: number }) {
  const s = useLiveSession(`a${i}`, enrolment, "t1");
  seen[i] = { loading: s.loading, failed: s.failed, setups: s.snap?.setups.length ?? -1, loaded: s.snap !== null };
  return null;
}

function Room() {
  return (
    <>
      {Array.from({ length: ROOM }, (_, i) => (
        <Device key={i} i={i} />
      ))}
    </>
  );
}

const leader: LiveTeamSetup = { activity_id: "", team_id: "t1", leader_id: "s1", leader_at: "2026-10-28T10:00:00Z", roll_at: null };
const playing: LiveTeamSetup = { ...leader, roll_at: "2026-10-28T10:01:00Z" };

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  db.reset();
  watchers.clear();
  seen.length = 0;
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

/**
 * Advance the clock half a second at a time. React applies a test's updates
 * only when its act() ends, so one long jump would freeze every screen at its
 * first state for the whole of it — nothing a real device does.
 */
async function run(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 500) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(500, left)));
  }
}
const everyoneUpToDate = (setups: number) =>
  seen.every((s) => s.loaded && !s.loading && !s.failed && s.setups === setups);
/** The most reads any one device made since `before`. */
const busiest = (before: Map<string, number>) =>
  Math.max(...[...db.calls].map(([id, n]) => n - (before.get(id) ?? 0)));

// Minutes of a whole room, simulated: slower than a unit test.
describe(`a room of ${ROOM} devices`, { timeout: 120_000 }, () => {
  it("all load when they open the activity at the same moment", async () => {
    await act(async () => root.render(<Room />));
    await run(5_000);
    expect(everyoneUpToDate(0)).toBe(true);
    expect(db.worst).toBe(1);
  });

  it("survives a storm of realtime events: a few reads each, never two at once", async () => {
    db.setups = [playing];
    await act(async () => root.render(<Room />));
    await run(5_000);
    const before = new Map(db.calls);
    // 100 events to every device in two seconds — a whole class voting at once.
    for (let k = 0; k < 100; k++) {
      act(() => watchers.forEach((w) => w("live_votes")));
      await run(20);
    }
    await run(5_000);
    expect(db.worst).toBe(1);
    expect(busiest(before)).toBeLessThanOrEqual(6);
    expect(everyoneUpToDate(1)).toBe(true);
  });

  it("rides out the database going silent for two minutes during leader pick, and is back by itself", async () => {
    await act(async () => root.render(<Room />));
    await run(5_000);
    const before = new Map(db.calls);

    db.mode = "silent";
    await run(120_000);
    expect(db.worst).toBe(1);
    // A read only ends when it times out, so a device can't have made more than one per timeout.
    expect(busiest(before)).toBeLessThanOrEqual(120_000 / TIMEOUT_MS + 1);
    expect(seen.every((s) => s.loaded)).toBe(true); // what they had stays on screen

    // A leader was picked while it was down; everyone sees it once it's back.
    db.setups = [leader];
    db.mode = "ok";
    await run(45_000);
    expect(everyoneUpToDate(1)).toBe(true);
  });

  it("rides out every read failing at once for a minute, backing off instead of hammering", async () => {
    await act(async () => root.render(<Room />));
    await run(5_000);
    const before = new Map(db.calls);

    db.mode = "erroring";
    await run(60_000);
    expect(db.worst).toBe(1);
    // Backing off 1, 2, 4, 8, then 15s at a time: about eight tries a minute, not thirty.
    expect(busiest(before)).toBeLessThanOrEqual(10);

    db.mode = "ok";
    await run(25_000);
    expect(everyoneUpToDate(0)).toBe(true);
  });

  it("opens into an outage, shows the retry screen, and loads on its own once the database is back", async () => {
    db.mode = "silent";
    await act(async () => root.render(<Room />));
    await run(TIMEOUT_MS + 1_000);
    expect(seen.every((s) => !s.loaded && !s.loading && s.failed)).toBe(true);

    db.mode = "ok";
    await run(45_000);
    expect(everyoneUpToDate(0)).toBe(true);
  });

  it("reads straight away when a device's wifi comes back", async () => {
    db.mode = "erroring";
    await act(async () => root.render(<Room />));
    await run(30_000);
    db.mode = "ok";
    db.setups = [leader];
    act(() => window.dispatchEvent(new Event("online")));
    await run(2_000);
    expect(everyoneUpToDate(1)).toBe(true);
  });
});
