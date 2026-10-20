// @vitest-environment node
// (Node's own Blob: the handler reads the PDF with arrayBuffer(), as the route does.)
//
// The import route, minus the network. As with the assistant (handle.test.ts),
// every gate is pinned in the order it runs, because each stops somebody
// spending the model key who should not — and the download is pinned as well,
// because it is made with the caller's sign-in and must come after the check
// that the course is hers.

import { describe, expect, it, vi } from "vitest";
import { MAX_IMPORT_BYTES } from "../liveDraft";
import { handleLiveImport, looksLikePdf, parseLiveImportRequest, type LiveImportDeps } from "./liveImportHandle";
import { ModelError, type Model } from "./model";

const courseId = "6b1f3c2a-1111-4222-8333-944455556666";
const activityId = "7c2a4d3b-2222-4333-8444-a55566667777";
const path = `${courseId}/${activityId}/1760000000000-Module-9.pdf`;
const body = { courseId, activityId, path };

const pdf = (extra = "") => new Blob([`%PDF-1.7\n${extra}`], { type: "application/pdf" });

const drafted = {
  text: "",
  toolCalls: [
    {
      name: "draft_questions",
      input: {
        title: "Module 9",
        items: [{ page: 2, kind: "mc", stem: "Which way?", options: ["Left", "Right"], correct_option: 1 }],
        left_out: [{ page: 1, kind: "instructions", reason: "Instructions." }],
      },
    },
  ],
};

function deps(over: Partial<LiveImportDeps> = {}): LiveImportDeps {
  return {
    model: vi.fn<Model>(async () => drafted),
    verify: vi.fn(async () => ({ ok: true as const, userId: "u1", email: "kelly@x.edu" })),
    allowed: vi.fn(() => true),
    limiter: { take: vi.fn(() => ({ ok: true as const })) },
    download: vi.fn(async () => ({ ok: true as const, file: pdf() })),
    log: vi.fn(),
    ...over,
  };
}

const call = (d: LiveImportDeps, auth: string | null = "Bearer tok", b: unknown = body) =>
  handleLiveImport({ authorization: auth, body: b }, d);

describe("handleLiveImport", () => {
  it("drafts the questions in the PDF", async () => {
    const d = deps();
    const out = await call(d);
    expect(out).toEqual({
      status: 200,
      body: {
        ok: true,
        draft: {
          title: "Module 9",
          items: [{ page: 2, kind: "mc", stem: "Which way?", options: ["Left", "Right"], correctOption: 1, needsPick: false }],
          leftOut: [{ page: 1, kind: "instructions", reason: "Instructions." }],
        },
      },
    });
    // Downloaded with her token, and sent whole to the model, which must answer with the draft tool.
    expect(d.download).toHaveBeenCalledWith("tok", path);
    const sent = vi.mocked(d.model as Model).mock.calls[0][0];
    expect(sent.tools.map((t) => t.name)).toEqual(["draft_questions"]);
    expect(sent.requireTool).toBe(true);
    expect(sent.turns).toHaveLength(1);
    expect(sent.turns[0].file?.mimeType).toBe("application/pdf");
    expect(Buffer.from(sent.turns[0].file!.data, "base64").toString()).toBe("%PDF-1.7\n");
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
    expect(d.download).not.toHaveBeenCalled();
  });

  it("refuses a malformed body before checking the course", async () => {
    const d = deps();
    expect((await call(d, "Bearer tok", { ...body, courseId: "nope" })).status).toBe(400);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses a path outside this course and activity, before fetching anything", async () => {
    const d = deps();
    const other = "00000000-0000-4000-8000-000000000000";
    for (const p of [`${other}/${activityId}/1-a.pdf`, `${courseId}/${other}/1-a.pdf`, `${courseId}/${activityId}/../x/1-a.pdf`, `${courseId}/${activityId}/1-a.exe`]) {
      expect((await call(d, "Bearer tok", { ...body, path: p })).status).toBe(400);
    }
    expect(d.download).not.toHaveBeenCalled();
  });

  it("refuses someone who does not own the course, in the import's own words", async () => {
    const d = deps({ verify: vi.fn(async () => ({ ok: false as const, status: 403 as const, error: "teams wording" })) });
    expect(await call(d)).toEqual({ status: 403, body: { ok: false, error: "Only this course's instructor can import questions." } });
    expect(d.download).not.toHaveBeenCalled();
  });

  it("passes an expired sign-in through as it is", async () => {
    const d = deps({ verify: vi.fn(async () => ({ ok: false as const, status: 401 as const, error: "expired" })) });
    expect(await call(d)).toEqual({ status: 401, body: { ok: false, error: "expired" } });
  });

  it("says so when the sign-in check itself fails", async () => {
    const d = deps({ verify: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect((await call(d)).status).toBe(502);
    expect(d.log).toHaveBeenCalled();
  });

  it("refuses an owner who is not on the allow-list, before the rate limit", async () => {
    const d = deps({ allowed: vi.fn(() => false) });
    expect((await call(d)).status).toBe(403);
    expect(d.limiter.take).not.toHaveBeenCalled();
    expect(d.download).not.toHaveBeenCalled();
  });

  it("refuses past the rate limit, before the download", async () => {
    const d = deps({ limiter: { take: vi.fn(() => ({ ok: false as const, retryAfterSec: 30 })) } });
    const out = await call(d);
    expect(out.status).toBe(429);
    expect(!out.body.ok && out.body.error).toMatch(/30 seconds/);
    expect(d.download).not.toHaveBeenCalled();
  });

  it("tells a missing PDF from a failed fetch", async () => {
    const missing = deps({ download: vi.fn(async () => ({ ok: false as const, missing: true, message: "Object not found" })) });
    expect((await call(missing)).status).toBe(404);
    const failed = deps({ download: vi.fn(async () => Promise.reject(new Error("socket hang up"))) });
    expect((await call(failed)).status).toBe(502);
    expect(failed.model).not.toHaveBeenCalled();
  });

  it("refuses a file over the limit without reading it", async () => {
    const big = { size: MAX_IMPORT_BYTES + 1, arrayBuffer: vi.fn() } as unknown as Blob;
    const d = deps({ download: vi.fn(async () => ({ ok: true as const, file: big })) });
    const out = await call(d);
    expect(out.status).toBe(413);
    expect(!out.body.ok && out.body.error).toMatch(/over 20 MB/);
    expect(big.arrayBuffer).not.toHaveBeenCalled();
    expect(d.model).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a PDF, whatever it was stored as", async () => {
    const d = deps({ download: vi.fn(async () => ({ ok: true as const, file: new Blob(["<html>"], { type: "application/pdf" }) })) });
    expect(await call(d)).toEqual({ status: 415, body: { ok: false, error: "That file is not a PDF." } });
    expect(d.model).not.toHaveBeenCalled();
  });

  it("sorts provider failures by what the instructor can do", async () => {
    const auth = deps({ model: vi.fn<Model>(async () => Promise.reject(new ModelError("auth", "bad key"))) });
    expect(await call(auth)).toMatchObject({ status: 503, body: { error: expect.stringMatching(/key was refused/) } });
    const busy = deps({ model: vi.fn<Model>(async () => Promise.reject(new ModelError("busy", "429"))) });
    expect(await call(busy)).toMatchObject({ status: 503, body: { error: expect.stringMatching(/busy/) } });
    const other = deps({ model: vi.fn<Model>(async () => Promise.reject(new Error("boom"))) });
    expect(await call(other)).toMatchObject({ status: 502, body: { ok: false } });
  });

  it("refuses a draft cut off at the output limit", async () => {
    const d = deps({ model: vi.fn<Model>(async () => ({ ...drafted, truncated: true })) });
    const out = await call(d);
    expect(out.status).toBe(422);
    expect(!out.body.ok && out.body.error).toMatch(/Split it/);
  });

  it("says when the model found nothing to draft", async () => {
    const d = deps({ model: vi.fn<Model>(async () => ({ text: "This PDF has no questions.", toolCalls: [] })) });
    expect(await call(d)).toEqual({ status: 422, body: { ok: false, error: "No questions were found in that PDF." } });
  });

  it("says when the draft cannot be read back", async () => {
    const d = deps({ model: vi.fn<Model>(async () => ({ text: "", toolCalls: [{ name: "draft_questions", input: { items: "x" } }] })) });
    const out = await call(d);
    expect(out.status).toBe(502);
    expect(d.log).toHaveBeenCalledWith("live-import: unreadable draft", expect.anything());
  });
});

describe("parseLiveImportRequest", () => {
  it("reads a well-formed request", () => {
    expect(parseLiveImportRequest(body)).toEqual({ ok: true, request: body });
  });

  it("refuses anything else", () => {
    expect(parseLiveImportRequest(null).ok).toBe(false);
    expect(parseLiveImportRequest({ ...body, activityId: undefined }).ok).toBe(false);
    expect(parseLiveImportRequest({ ...body, path: 5 }).ok).toBe(false);
  });
});

describe("looksLikePdf", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("finds the header at the start, or after a little junk", () => {
    expect(looksLikePdf(bytes("%PDF-1.4"))).toBe(true);
    expect(looksLikePdf(bytes(`${" ".repeat(500)}%PDF-1.4`))).toBe(true);
  });

  it("does not find one that is not there, or too far in", () => {
    expect(looksLikePdf(bytes("PK\u0003\u0004"))).toBe(false);
    expect(looksLikePdf(bytes(`${" ".repeat(1100)}%PDF-1.4`))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});
