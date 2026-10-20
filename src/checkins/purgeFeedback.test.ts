// Deleting an activity takes the images on its grading comments with it (0046),
// and a project that has not run 0046 can still delete activities.

import { beforeEach, describe, expect, it, vi } from "vitest";

let feedbackRead: () => Promise<{ path: string }[]>;

const selectAllIn = vi.fn(
  async (_ids: string[], _page: (c: string[], f: number, t: number) => unknown): Promise<unknown[]> => [],
);

vi.mock("./data", () => ({
  countAllIn: vi.fn(async () => 0),
  dbError: (e: { message: string }) => new Error(e.message),
  removeStudent: vi.fn(async () => undefined),
  selectAll: vi.fn(async () => []),
  selectAllIn,
}));

const removeReturningDeleted = vi.fn(async (_bucket: string, paths: string[]) => ({
  deleted: paths,
  failure: null,
}));
vi.mock("./storage", () => ({ removeReturningDeleted, stillThere: vi.fn(async () => false) }));

// Records which table each paged read is for, so the mock can answer per table.
vi.mock("@/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  requireSupabase: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        in: () => chain,
        order: () => chain,
        range: () => ({ table }),
      };
      return chain;
    },
  }),
}));

const { deleteActivityFeedback } = await import("./purge");

beforeEach(() => {
  vi.clearAllMocks();
  feedbackRead = async () => [{ path: "c1/a1/r1/x.png" }];
  selectAllIn.mockImplementation(async (ids, page) => {
    const { table } = page(ids, 0, 999) as { table: string };
    if (table === "check_ins") return [{ id: "ci1" }];
    if (table === "check_in_results") return [{ id: "r1" }];
    if (table === "feedback_images") return feedbackRead();
    return [];
  });
});

describe("sweeping comment images off a deleted activity", () => {
  it("removes every image on the activity's results", async () => {
    expect(await deleteActivityFeedback("a1")).toBe(1);
    expect(removeReturningDeleted).toHaveBeenCalledWith("feedback", ["c1/a1/r1/x.png"]);
  });

  it("carries on where 0046 has not been run", async () => {
    feedbackRead = async () => {
      throw new Error("Could not find the table 'public.feedback_images' in the schema cache");
    };
    expect(await deleteActivityFeedback("a1")).toBe(0);
  });

  it("stops on any other error, so the rows aren't deleted out from under their objects", async () => {
    feedbackRead = async () => {
      throw new Error("permission denied for table feedback_images");
    };
    await expect(deleteActivityFeedback("a1")).rejects.toThrow(/permission denied/);
  });
});
