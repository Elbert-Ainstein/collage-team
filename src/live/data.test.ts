// What data.ts asks the database for 0051: leader votes, setups, the roll and
// explanations read with the rest of a session, the three RPCs, explanations
// saved beside the key — and a database without 0051 reading as one where
// teams just play.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
interface Call {
  table: string;
  op: "upsert" | "delete" | "update";
  rows?: Row[];
  filters: [string, unknown][];
}

/** Rows each table answers with; a string is the error it answers with instead. */
let tables: Record<string, Row[] | string> = {};
let paged = new Set<string>();
let writes: Call[] = [];
let rpcs: { fn: string; args: Row }[] = [];

const MISSING = (t: string) => `Could not find the table 'public.${t}' in the schema cache`;

function client() {
  return {
    rpc: async (fn: string, args: Row) => {
      rpcs.push({ fn, args });
      return { data: { activity_id: args.aid, team_id: "t1", leader_id: null, leader_at: null, roll_at: null }, error: null };
    },
    from(table: string) {
      const filters: [string, unknown][] = [];
      let write: Call | null = null;
      const answer = () => {
        const t = tables[table];
        if (typeof t === "string") return { data: null, error: { message: t } };
        if (write) writes.push(write);
        return { data: t ?? [], error: null };
      };
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
        in: (c: string, v: unknown) => (filters.push([c, v]), chain),
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        upsert: (rows: Row[]) => ((write = { table, op: "upsert", rows, filters }), chain),
        update: (row: Row) => ((write = { table, op: "update", rows: [row], filters }), chain),
        delete: () => ((write = { table, op: "delete", filters }), chain),
        maybeSingle: async () => {
          const a = answer();
          return { ...a, data: Array.isArray(a.data) ? a.data[0] ?? null : null };
        },
        range: async () => {
          if (paged.has(table)) return { data: [], error: null };
          paged.add(table);
          return answer();
        },
        then: <T>(resolve: (v: ReturnType<typeof answer>) => T) => Promise.resolve(answer()).then(resolve),
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabaseClient", () => ({
  requireSupabase: () => client(),
  isSupabaseConfigured: true,
}));

const { confirmLeader, loadLive, saveLiveQuestions, setAbsences, voteLeader, EXPLANATION_MAX } = await import("./data");

const state = { activity_id: "a", phase: "team", lock_rule: "any", show_answers: "close", grading: "both" };
const question = { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "", options: ["x", "y"], unit: null, figure_path: null, created_at: "" };
const draft = (over: Row = {}) => ({
  id: "q1", kind: "mc" as const, stem: "Which?", options: ["x", "y"], unit: null, figure_path: null,
  correct_option: 1, answer: null, tolerance: null, accept: [], ...over,
});

beforeEach(() => {
  paged = new Set();
  writes = [];
  rpcs = [];
  tables = {
    live_state: [state],
    live_questions: [question],
    live_keys: [],
    live_responses: [],
    live_votes: [],
    live_locks: [],
    live_attempts: [],
    live_team_setup: [{ activity_id: "a", team_id: "t1", leader_id: "s1", leader_at: "x", roll_at: null }],
    live_leader_votes: [{ activity_id: "a", team_id: "t1", student_id: "s1", candidate_id: "s1", updated_at: "" }],
    tutorial_absences: [{ activity_id: "a", team_id: "t1", student_id: "s2", source: "roll" }],
    activity_rosters: [
      { team_id: "t1", student_id: "s1", students: { name: "Ana", avatar_tint: null } },
      { team_id: "t1", student_id: "s2", students: null },
    ],
    live_explanations: [{ question_id: "q1", activity_id: "a", body: "Because." }],
  };
});

describe("loadLive", () => {
  it("reads the leader, the roll and the explanations with the session", async () => {
    const snap = await loadLive("a");
    expect(snap?.teamSetup).toBe(true);
    expect(snap?.setups.map((s) => s.leader_id)).toEqual(["s1"]);
    expect(snap?.leaderVotes).toHaveLength(1);
    expect(snap?.absences).toEqual([{ activity_id: "a", team_id: "t1", student_id: "s2", source: "roll" }]);
    expect(snap?.roster).toEqual([
      { team_id: "t1", student_id: "s1", name: "Ana", avatar_tint: null },
      { team_id: "t1", student_id: "s2", name: null, avatar_tint: null },
    ]);
    expect(snap?.explanations.map((e) => e.body)).toEqual(["Because."]);
  });

  it("reads a database without 0051 as teams with no leader, roll or explanations", async () => {
    tables.live_team_setup = MISSING("live_team_setup");
    tables.live_leader_votes = MISSING("live_leader_votes");
    tables.live_explanations = MISSING("live_explanations");
    tables.tutorial_absences = [{ activity_id: "a", team_id: "t1", student_id: "s1" }];
    const snap = await loadLive("a");
    expect(snap?.questions).toHaveLength(1);
    expect(snap?.teamSetup).toBe(false);
    // Before 0051 every absence is the sheet's, and there's no roster to read.
    expect(snap?.absences.map((a) => a.source)).toEqual(["sheet"]);
    expect(snap?.roster).toEqual([]);
    expect(snap?.leaderVotes).toEqual([]);
    expect(snap?.setups).toEqual([]);
    expect(snap?.explanations).toEqual([]);
  });

  it("still fails on a real error", async () => {
    tables.live_team_setup = "connection reset";
    await expect(loadLive("a")).rejects.toThrow("connection reset");
  });
});

describe("the leader and the roll", () => {
  it("go through their RPCs", async () => {
    await voteLeader("a", "s2");
    await confirmLeader("a");
    await setAbsences("a", ["s3", "s3", "s4"]);
    expect(rpcs).toEqual([
      { fn: "vote_live_leader", args: { aid: "a", candidate: "s2" } },
      { fn: "confirm_live_leader", args: { aid: "a" } },
      { fn: "set_live_absences", args: { aid: "a", absent: ["s3", "s4"] } },
    ]);
  });
});

describe("saving explanations", () => {
  const explanationWrites = () => writes.filter((w) => w.table === "live_explanations");

  it("writes one, trimmed, beside the key", async () => {
    await saveLiveQuestions("a", [draft({ explanation: "  Because B.  " })]);
    expect(explanationWrites()).toEqual([
      expect.objectContaining({ op: "upsert", rows: [{ question_id: "q1", activity_id: "a", body: "Because B." }] }),
    ]);
  });

  it("removes a blank one, and leaves one it wasn't given", async () => {
    await saveLiveQuestions("a", [draft({ explanation: "   " }), draft({ id: "q2" })]);
    const w = explanationWrites();
    expect(w).toHaveLength(1);
    expect(w[0].op).toBe("delete");
    expect(w[0].filters).toContainEqual(["question_id", ["q1"]]);
  });

  it("writes them once team mode has started, too", async () => {
    await saveLiveQuestions("a", [draft({ explanation: "Because." })], true);
    expect(explanationWrites().map((w) => w.op)).toEqual(["upsert"]);
  });

  it("refuses one that's too long before writing anything", async () => {
    await expect(saveLiveQuestions("a", [draft({ explanation: "x".repeat(EXPLANATION_MAX + 1) })])).rejects.toThrow(
      /at most/,
    );
    expect(writes).toEqual([]);
  });

  it("without 0051: blank is nothing to do, and a written one says what's missing", async () => {
    tables.live_explanations = MISSING("live_explanations");
    await expect(saveLiveQuestions("a", [draft({ explanation: "" })])).resolves.toBeUndefined();
    await expect(saveLiveQuestions("a", [draft({ explanation: "Because." })])).rejects.toThrow(/0051/);
  });

  it("without 0051, a written one stops the save before anything is written", async () => {
    tables.live_explanations = MISSING("live_explanations");
    for (const frozen of [false, true]) {
      writes = [];
      await expect(saveLiveQuestions("a", [draft({ explanation: "Because." })], frozen)).rejects.toThrow(/Nothing was saved/);
      expect(writes).toEqual([]);
    }
  });

  it("are written after the questions are settled, removed ones included", async () => {
    await saveLiveQuestions("a", [draft({ explanation: "Because." })]);
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual([
      "live_questions:upsert",
      "live_keys:upsert",
      "live_questions:delete",
      "live_explanations:upsert",
    ]);
  });
});
