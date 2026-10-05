// The route, minus the network. Every gate is pinned in the order it runs —
// configured, signed in, well-formed, allowed on this course, under the rate
// limit — because each is what stops somebody spending the model key who
// should not, and a gate that moved behind the model call would still pass a
// test that only checked the happy path.

import { describe, expect, it, vi } from "vitest";
import { handleAssistant, type HandlerDeps } from "./handle";
import { ModelError, type Model } from "./model";

const body = {
  courseId: "6b1f3c2a-1111-4222-8333-944455556666",
  message: "Move Alan to Team 1",
  history: [],
  snapshot: {
    course: { name: "AP 50", code: null, term: null },
    students: [
      { ref: "s1", name: "Ada Lovelace", email: "ada@x.edu" },
      { ref: "s2", name: "Alan Turing", email: null },
    ],
    teams: [{ ref: "t1", name: "Team 1", members: ["s1"] }],
  },
};

function deps(over: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    model: vi.fn<Model>(async () => ({
      text: "",
      toolCalls: [
        {
          name: "seat_students",
          input: { summary: "Moves Alan to Team 1.", moves: [{ student: "s2", to_team: "t1" }] },
        },
      ],
    })),
    verify: vi.fn(async () => ({ ok: true as const, userId: "u1", email: "kelly@x.edu" })),
    allowed: vi.fn(() => true),
    limiter: { take: vi.fn(() => ({ ok: true as const })) },
    log: vi.fn(),
    ...over,
  };
}

const call = (d: HandlerDeps, auth: string | null = "Bearer tok", b: unknown = body) =>
  handleAssistant({ authorization: auth, body: b }, d);

describe("handleAssistant", () => {
  it("answers a drafted change as a proposal", async () => {
    const d = deps();
    const out = await call(d);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({
      ok: true,
      reply: {
        kind: "proposal",
        text: "Moves Alan to Team 1.",
        proposal: {
          kind: "seat",
          summary: "Moves Alan to Team 1.",
          moves: [{ student: "s2", toTeam: "t1", toNewTeam: null }],
          renames: [],
          unresolved: [],
        },
      },
    });
    // The model is told about the class, and offered both tools.
    const sent = vi.mocked(d.model as Model).mock.calls[0][0];
    expect(sent.system).toContain('t1 "Team 1"');
    expect(sent.tools.map((t) => t.name)).toEqual(["seat_students", "prepare_import"]);
    expect(sent.turns.at(-1)).toEqual({ role: "user", text: "Move Alan to Team 1" });
  });

  it("answers plain text as a message", async () => {
    const d = deps({ model: vi.fn<Model>(async () => ({ text: "Ada is on Team 1.", toolCalls: [] })) });
    const out = await call(d);
    expect(out.body).toEqual({ ok: true, reply: { kind: "message", text: "Ada is on Team 1." } });
  });

  it("turns an unreadable draft into a message, not a broken proposal", async () => {
    const d = deps({
      model: vi.fn<Model>(async () => ({
        text: "",
        toolCalls: [{ name: "seat_students", input: { summary: "x", moves: [{ student: "s2" }] } }],
      })),
    });
    const out = await call(d);
    expect(out.status).toBe(200);
    expect(out.body.ok && out.body.reply.kind).toBe("message");
    expect(d.log).toHaveBeenCalled();
  });

  it("is switched off without a model, before reading anything else", async () => {
    const d = deps({ model: null });
    const out = await call(d, null);
    expect(out.status).toBe(503);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses a request with no sign-in", async () => {
    const d = deps();
    expect((await call(d, null)).status).toBe(401);
    expect((await call(d, "Basic abc")).status).toBe(401);
    expect(d.model).not.toHaveBeenCalled();
  });

  it("refuses a malformed body before checking the course", async () => {
    const d = deps();
    const out = await call(d, "Bearer tok", { ...body, message: "" });
    expect(out.status).toBe(400);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses someone who may not change this course's teams", async () => {
    const d = deps({ verify: vi.fn(async () => ({ ok: false as const, status: 403 as const, error: "no" })) });
    const out = await call(d);
    expect(out).toEqual({ status: 403, body: { ok: false, error: "no" } });
    expect(d.model).not.toHaveBeenCalled();
  });

  // Owning a course proves nothing: any account can make one (0028). The list
  // of people allowed to spend the key is the real gate.
  it("refuses an owner who is not on the allow-list, before the rate limit and the model", async () => {
    const d = deps({ allowed: vi.fn(() => false) });
    const out = await call(d);
    expect(out.status).toBe(403);
    expect(d.allowed).toHaveBeenCalledWith("kelly@x.edu");
    expect(d.limiter.take).not.toHaveBeenCalled();
    expect(d.model).not.toHaveBeenCalled();
  });

  it("refuses past the rate limit, after the sign-in check", async () => {
    const d = deps({ limiter: { take: vi.fn(() => ({ ok: false as const, retryAfterSec: 90 })) } });
    const out = await call(d);
    expect(out.status).toBe(429);
    expect(out.body.ok).toBe(false);
    expect(!out.body.ok && out.body.error).toMatch(/2 minutes/);
    expect(d.limiter.take).toHaveBeenCalledWith("u1");
    expect(d.model).not.toHaveBeenCalled();
  });

  it("says the list was too long when the draft was cut off mid-way", async () => {
    const d = deps({
      model: vi.fn<Model>(async () => ({
        text: "",
        truncated: true,
        toolCalls: [{ name: "prepare_import", input: { summary: "x", rows: [{ name: "Ada" }] } }],
      })),
    });
    const out = await call(d);
    expect(out.status).toBe(200);
    // Never a proposal: a cut-off list would import the first half and say nothing.
    expect(out.body.ok && out.body.reply).toEqual({
      kind: "message",
      text: expect.stringMatching(/too long/),
    });
  });

  it("says so when the sign-in check itself fails", async () => {
    const d = deps({
      verify: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    const out = await call(d);
    expect(out.status).toBe(502);
    expect(d.model).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalled();
  });

  it("says the key was refused when the provider refuses it", async () => {
    const d = deps({
      model: vi.fn<Model>(async () => {
        throw new ModelError("auth", "401 invalid x-api-key");
      }),
    });
    const out = await call(d);
    expect(out.status).toBe(503);
    expect(!out.body.ok && out.body.error).toMatch(/key/);
    expect(d.log).toHaveBeenCalled();
  });

  it("says try again when the provider is busy or fails", async () => {
    const busy = deps({
      model: vi.fn<Model>(async () => {
        throw new ModelError("busy", "529 overloaded");
      }),
    });
    expect((await call(busy)).status).toBe(503);
    const broken = deps({
      model: vi.fn<Model>(async () => {
        throw new Error("socket hang up");
      }),
    });
    const out = await call(broken);
    expect(out.status).toBe(502);
    // The raw provider error stays in the server log, not on her screen.
    expect(!out.body.ok && out.body.error).not.toContain("socket");
  });
});
