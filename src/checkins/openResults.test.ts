// Opening a result row for everyone on a half nobody hands in.
//
// The row is the only thing a mark can be filed against, so the Amplify
// grading screen makes the missing ones when it opens. Two people opening that
// screen at once is a normal Tuesday — and (check_in_id, student_id) is
// uniquely indexed (0001), so the second one loses the race. Losing it is not
// an error: the row existing is the whole of what was wanted.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  table: string;
  rows?: Record<string, unknown>[];
}

const calls: Call[] = [];
/** What the next insert answers with. */
let insertError: { message: string } | null = null;
/** Who already has a row. */
let existing: { student_id: string }[] = [];
/** selectAll pages until a short page comes back, so the stub answers once. */
let page = 0;

/** Enough of the query builder for selectAllIn and one insert. */
function client() {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        range: async () => ({ data: page++ === 0 ? existing : [], error: null }),
        insert: async (rows: Record<string, unknown>[]) => {
          calls.push({ table, rows });
          return { error: insertError };
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabaseClient", () => ({
  requireSupabase: () => client(),
  isSupabaseConfigured: true,
}));

const { openResultsFor } = await import("./data");

beforeEach(() => {
  calls.length = 0;
  insertError = null;
  existing = [];
  page = 0;
});

describe("openResultsFor", () => {
  it("writes a row per student, already standing as submitted", async () => {
    // "submitted" and not "none": the work IS in — it is on Amplify — and
    // every count downstream reads that word to decide whether there is
    // anything to mark. An empty row showed a class of eighty as nobody
    // having handed in, beside a list of all eighty ready to grade.
    const made = await openResultsFor("ci1", ["s1", "s2"]);

    expect(made).toBe(2);
    expect(calls[0].rows).toEqual([
      { check_in_id: "ci1", subject_type: "student", student_id: "s1", team_id: null, status: "submitted" },
      { check_in_id: "ci1", subject_type: "student", student_id: "s2", team_id: null, status: "submitted" },
    ]);
  });

  it("stamps no submitted_at, because no hand-in happened here", async () => {
    await openResultsFor("ci1", ["s1"]);
    expect(calls[0].rows?.[0]).not.toHaveProperty("submitted_at");
  });

  it("writes nothing at all when everyone already has one", async () => {
    existing = [{ student_id: "s1" }, { student_id: "s2" }];
    expect(await openResultsFor("ci1", ["s1", "s2"])).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("asks for nobody when the roster is empty", async () => {
    expect(await openResultsFor("ci1", [])).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("swallows the duplicate a second grader causes", async () => {
    insertError = {
      message: 'duplicate key value violates unique constraint "uniq_result_student"',
    };
    await expect(openResultsFor("ci1", ["s1"])).resolves.toBe(1);
  });

  it("still raises anything that is not that race", async () => {
    insertError = { message: "new row violates row-level security policy" };
    // Raised, not swallowed — and in the app's own words rather than the
    // database's, which is dbError's job and worth pinning here too.
    await expect(openResultsFor("ci1", ["s1"])).rejects.toThrow(/don.t have access/i);
  });
});
