// The explanation route, minus the network. As with the import
// (liveImportHandle.test.ts), every gate is pinned in the order it runs,
// because each stops somebody spending the model key who should not.

import { describe, expect, it, vi } from "vitest";
import { handleLiveExplain, parseLiveExplainRequest, type LiveExplainDeps } from "./liveExplainHandle";
import { ModelError, type Model } from "./model";

const activityId = "7c2a4d3b-2222-4333-8444-a55566667777";
const question = {
  kind: "mc",
  stem: "A ball is thrown straight up. At the top, its acceleration is",
  options: ["zero", "9.8 m/s² down", "9.8 m/s² up"],
  correctOption: 1,
  answer: null,
  tolerance: null,
  unit: null,
  accept: [],
  figure: false,
};
const body = { activityId, question };

const explained = {
  text: "",
  toolCalls: [{ name: "write_explanation", input: { explanation: "Gravity never switches off. The velocity is zero at the top, not the acceleration." } }],
};

function deps(over: Partial<LiveExplainDeps> = {}): LiveExplainDeps {
  return {
    model: vi.fn<Model>(async () => explained),
    verify: vi.fn(async () => ({ ok: true as const, userId: "u1", email: "kelly@x.edu" })),
    allowed: vi.fn(() => true),
    limiter: { take: vi.fn(() => ({ ok: true as const })) },
    log: vi.fn(),
    ...over,
  };
}

const call = (d: LiveExplainDeps, auth: string | null = "Bearer tok", b: unknown = body) =>
  handleLiveExplain({ authorization: auth, body: b }, d);

describe("handleLiveExplain", () => {
  it("explains the question with its key, through the one tool", async () => {
    const d = deps();
    expect(await call(d)).toEqual({
      status: 200,
      body: { ok: true, explanation: "Gravity never switches off. The velocity is zero at the top, not the acceleration." },
    });
    expect(d.verify).toHaveBeenCalledWith("tok", activityId);
    const sent = vi.mocked(d.model as Model).mock.calls[0][0];
    expect(sent.tools.map((t) => t.name)).toEqual(["write_explanation"]);
    expect(sent.requireTool).toBe(true);
    expect(sent.turns).toHaveLength(1);
    expect(sent.turns[0].text).toContain("B. 9.8 m/s² down");
    expect(sent.turns[0].text).toContain("Correct answer: B");
  });

  it("is switched off without a model, before reading anything else", async () => {
    const d = deps({ model: null });
    expect((await call(d, null)).status).toBe(503);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses a request with no sign-in", async () => {
    const d = deps();
    expect((await call(d, null)).status).toBe(401);
    expect((await call(d, "Basic abc")).status).toBe(401);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses a malformed body before checking the activity", async () => {
    const d = deps();
    expect((await call(d, "Bearer tok", { ...body, activityId: "nope" })).status).toBe(400);
    expect((await call(d, "Bearer tok", { ...body, question: { ...question, correctOption: 3 } })).status).toBe(400);
    expect((await call(d, "Bearer tok", [])).status).toBe(400);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses someone who does not own the activity, in its own words", async () => {
    const d = deps({ verify: vi.fn(async () => ({ ok: false as const, status: 403 as const, error: "other wording" })) });
    expect(await call(d)).toEqual({ status: 403, body: { ok: false, error: "Only this course's instructor can write explanations." } });
    expect(d.model).not.toHaveBeenCalled();
  });

  it("passes an expired sign-in through as it is", async () => {
    const d = deps({ verify: vi.fn(async () => ({ ok: false as const, status: 401 as const, error: "expired" })) });
    expect(await call(d)).toEqual({ status: 401, body: { ok: false, error: "expired" } });
  });

  it("says so when the sign-in check itself fails", async () => {
    const d = deps({ verify: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect((await call(d)).status).toBe(502);
    expect(d.log).toHaveBeenCalled();
    expect(d.model).not.toHaveBeenCalled();
  });

  it("refuses an owner who is not on the allow-list, before the rate limit", async () => {
    const d = deps({ allowed: vi.fn(() => false) });
    expect((await call(d)).status).toBe(403);
    expect(d.limiter.take).not.toHaveBeenCalled();
    expect(d.model).not.toHaveBeenCalled();
  });

  it("refuses past the rate limit, before the model", async () => {
    const d = deps({ limiter: { take: vi.fn(() => ({ ok: false as const, retryAfterSec: 30 })) } });
    const out = await call(d);
    expect(out.status).toBe(429);
    expect(!out.body.ok && out.body.error).toMatch(/30 seconds/);
    expect(d.model).not.toHaveBeenCalled();
  });

  it("sorts provider failures by what she can do about them", async () => {
    const auth = deps({ model: vi.fn<Model>(async () => Promise.reject(new ModelError("auth", "bad key"))) });
    expect(await call(auth)).toMatchObject({ status: 503, body: { error: expect.stringMatching(/key was refused/) } });
    const busy = deps({ model: vi.fn<Model>(async () => Promise.reject(new ModelError("busy", "429"))) });
    expect(await call(busy)).toMatchObject({ status: 503, body: { error: expect.stringMatching(/busy/) } });
    const other = deps({ model: vi.fn<Model>(async () => Promise.reject(new Error("socket"))) });
    expect((await call(other)).status).toBe(502);
    expect(other.log).toHaveBeenCalled();
  });

  it("offers nothing cut off, missing, or empty", async () => {
    const cut = deps({ model: vi.fn<Model>(async () => ({ ...explained, truncated: true })) });
    expect((await call(cut)).status).toBe(502);
    const none = deps({ model: vi.fn<Model>(async () => ({ text: "Sure! Here it is.", toolCalls: [] })) });
    expect((await call(none)).status).toBe(502);
    const empty = deps({ model: vi.fn<Model>(async () => ({ text: "", toolCalls: [{ name: "write_explanation", input: { explanation: "  " } }] })) });
    expect((await call(empty)).status).toBe(502);
  });

  it("never logs the sign-in token or the email", async () => {
    const d = deps({ model: vi.fn<Model>(async () => Promise.reject(new Error("socket"))) });
    await call(d);
    const logged = JSON.stringify(vi.mocked(d.log).mock.calls, (_k, v) => (v instanceof Error ? v.message : v));
    expect(logged).not.toContain("tok");
    expect(logged).not.toContain("kelly@x.edu");
  });
});

describe("parseLiveExplainRequest", () => {
  it("keeps only what each kind uses", () => {
    const out = parseLiveExplainRequest({
      activityId,
      question: { kind: "number", stem: " How fast? ", answer: 19.6, tolerance: 0.1, unit: " m/s ", options: ["x"], accept: ["y"] },
    });
    expect(out).toEqual({
      ok: true,
      request: {
        activityId,
        question: {
          kind: "number",
          stem: "How fast?",
          options: [],
          correctOption: null,
          answer: 19.6,
          tolerance: 0.1,
          unit: "m/s",
          accept: [],
          figure: false,
        },
      },
    });
  });
});
