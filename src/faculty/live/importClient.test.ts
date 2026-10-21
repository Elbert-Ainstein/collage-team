// The browser side of the PDF import: the checks made before anything is
// uploaded, where the file goes, and how the route's answer is read back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPath, isImportPath, type LiveDraft } from "@/assistant/liveDraft";

const put = vi.fn();
const getSession = vi.fn();
vi.mock("@/checkins/storage", () => ({ put: (...a: unknown[]) => put(...a) }));
vi.mock("@/lib/supabaseClient", () => ({ requireSupabase: () => ({ auth: { getSession } }) }));

const { importLivePdf } = await import("./importClient");

const courseId = "6b1f3c2a-1111-4222-8333-944455556666";
const activityId = "7c2a4d3b-2222-4333-8444-a55566667777";
const draft: LiveDraft = { items: [], leftOut: [{ page: 1, kind: "instructions", reason: "Instructions." }] };
const pdf = (name = "Module 9.pdf", type = "application/pdf") => new File(["%PDF-1.7"], name, { type });

describe("importPath", () => {
  it("puts the course and activity first, and a safe name after the time", () => {
    expect(importPath(courseId, activityId, "AP50 F2025 — Module 9 (final).PDF", 1760000000000)).toBe(
      `${courseId}/${activityId}/1760000000000-AP50-F2025-Module-9-final.pdf`,
    );
  });

  it("never lets the name leave its folder", () => {
    const p = importPath(courseId, activityId, "../../other/x.pdf", 1);
    expect(p).toBe(`${courseId}/${activityId}/1-other-x.pdf`);
    expect(isImportPath(p, courseId, activityId)).toBe(true);
  });

  it("names a file with nothing usable in its name", () => {
    expect(importPath(courseId, activityId, "测验.pdf", 1)).toBe(`${courseId}/${activityId}/1-questions.pdf`);
  });

  it("makes only paths the route will accept", () => {
    for (const name of ["a.pdf", "x".repeat(300), "—.pdf", "résumé.pdf", ".hidden.pdf"]) {
      expect(isImportPath(importPath(courseId, activityId, name, Date.now()), courseId, activityId)).toBe(true);
    }
  });
});

describe("importLivePdf", () => {
  beforeEach(() => {
    put.mockResolvedValue(null);
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, draft })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uploads to the course's folder, then asks the route with the sign-in", async () => {
    await expect(importLivePdf({ courseId, activityId, file: pdf() })).resolves.toEqual(draft);
    const [bucket, path, , type] = put.mock.calls[0];
    expect(bucket).toBe("imports");
    expect(isImportPath(path, courseId, activityId)).toBe(true);
    expect(type).toBe("application/pdf");
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/live-import");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ courseId, activityId, path });
  });

  it("refuses a file that is not a PDF, or too big, before uploading", async () => {
    await expect(importLivePdf({ courseId, activityId, file: pdf("notes.docx", "application/msword") })).rejects.toThrow(/not a PDF/);
    const big = pdf();
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    await expect(importLivePdf({ courseId, activityId, file: big })).rejects.toThrow(/over 20 MB/);
    expect(put).not.toHaveBeenCalled();
  });

  it("takes a .pdf the browser gave no type", async () => {
    await expect(importLivePdf({ courseId, activityId, file: pdf("q.pdf", "") })).resolves.toEqual(draft);
  });

  it("stops at an expired sign-in or a failed upload", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(importLivePdf({ courseId, activityId, file: pdf() })).rejects.toThrow(/sign-in has expired/);
    put.mockResolvedValueOnce({ message: "new row violates row-level security policy" });
    await expect(importLivePdf({ courseId, activityId, file: pdf() })).rejects.toThrow(/could not be uploaded/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes the route's own wording through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "No questions were found in that PDF." }, { status: 422 })));
    await expect(importLivePdf({ courseId, activityId, file: pdf() })).rejects.toThrow("No questions were found in that PDF.");
  });

  it("explains a host timeout page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>timeout</html>", { status: 504 })));
    await expect(importLivePdf({ courseId, activityId, file: pdf() })).rejects.toThrow(/took too long/);
  });
});
