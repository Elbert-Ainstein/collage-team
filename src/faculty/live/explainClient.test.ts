// The browser side of "Generate explanation": what is sent, with what, and
// how the route's answer is read back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankQuestion, type DraftQuestion } from "./draft";

const getSession = vi.fn();
vi.mock("@/lib/supabaseClient", () => ({ requireSupabase: () => ({ auth: { getSession } }) }));

const { canExplain, explainQuestion, explainQuestionOf } = await import("./explainClient");

const activityId = "7c2a4d3b-2222-4333-8444-a55566667777";
const mc = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  ...blankQuestion(),
  stem: " Which way? ",
  options: ["Up ", "Down"],
  correct: 1,
  ...over,
});

describe("explainQuestionOf", () => {
  it("sends the question tidied as saving would, key included", () => {
    expect(explainQuestionOf(mc({ figure_path: "a/b.png" }))).toEqual({
      kind: "mc",
      stem: "Which way?",
      options: ["Up", "Down"],
      correctOption: 1,
      answer: null,
      tolerance: null,
      unit: null,
      accept: [],
      figure: true,
    });
    expect(explainQuestionOf(mc({ kind: "number", answer: "19.60", unit: " m/s ", tolerance: "" }))).toMatchObject({
      kind: "number",
      answer: 19.6,
      tolerance: 0,
      unit: "m/s",
      options: [],
    });
  });
});

describe("canExplain", () => {
  it("needs the question written and its answer set", () => {
    expect(canExplain(mc())).toBe(true);
    expect(canExplain(mc({ stem: " " }))).toBe(false);
    expect(canExplain(mc({ correct: null }))).toBe(false);
    expect(canExplain(mc({ options: ["Up", ""] }))).toBe(false);
  });
});

describe("explainQuestion", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, explanation: "Down: gravity." })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("asks the route with the sign-in and hands back the text", async () => {
    await expect(explainQuestion(activityId, mc())).resolves.toBe("Down: gravity.");
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/live-explain");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toMatchObject({ activityId, question: { kind: "mc", correctOption: 1 } });
  });

  it("says the route's own words when it refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "Busy." }, { status: 503 })));
    await expect(explainQuestion(activityId, mc())).rejects.toThrow("Busy.");
  });

  it("refuses without a session, before any request", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(explainQuestion(activityId, mc())).rejects.toThrow(/sign-in has expired/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains a lost connection and an unreadable answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(explainQuestion(activityId, mc())).rejects.toThrow(/reach the server/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>504</html>", { status: 504 })));
    await expect(explainQuestion(activityId, mc())).rejects.toThrow(/No explanation came back/);
  });
});
