// What the team drive will and will not hold.
//
// 0017 allowed images and nothing else, which made this impossible by accident.
// 0035 opens the bucket so a team can keep the data it is working from — and
// that puts the question back on the app: storage objects are served from the
// Supabase project's own origin, so a file the browser renders as a document is
// a page running on that origin, reached through a link this app handed to
// every teammate and to course staff.

import { describe, expect, it, vi } from "vitest";

const put = vi.fn(async () => null);
const signedUrls = vi.fn(async () => ({ urls: new Map(), error: null }));

vi.mock("./storage", () => ({
  put,
  remove: vi.fn(async () => null),
  signedUrl: vi.fn(async () => ({ url: null, error: null })),
  signedUrls,
}));

vi.mock("@/lib/supabaseClient", () => ({
  requireSupabase: () => ({
    from: () => ({
      insert: () => ({ select: async () => ({ data: [{ id: "r1" }], error: null }) }),
    }),
  }),
  isSupabaseConfigured: true,
}));

const { previewable, resourceUrlsByKind, uploadTeamResource } = await import("./resources");

const file = (name: string, type: string, bytes = 10): File =>
  ({ name, type, size: bytes }) as File;

const where = { courseId: "c1", teamId: "t1" };

describe("files the drive refuses", () => {
  it("refuses an HTML page, whatever it is called", async () => {
    await expect(uploadTeamResource(where, file("notes.html", "text/html"), "notes")).rejects.toThrow(
      /web page/,
    );
    await expect(
      uploadTeamResource(where, file("notes.txt", "text/html"), "notes"),
    ).rejects.toThrow(/web page/);
    await expect(
      uploadTeamResource(where, file("notes.html", "application/octet-stream"), "notes"),
    ).rejects.toThrow(/web page/);
  });

  it("refuses an SVG, which is a script that looks like a picture", async () => {
    await expect(uploadTeamResource(where, file("logo.svg", "image/svg+xml"), "logo")).rejects.toThrow(
      /web page/,
    );
  });

  it("says what to do instead, rather than just no", async () => {
    await expect(uploadTeamResource(where, file("p.html", "text/html"), "p")).rejects.toThrow(
      /PDF|link/,
    );
  });

  it("refuses nothing else — a drive has to hold what a class works on", async () => {
    for (const f of [
      file("spectra.csv", "text/csv"),
      file("paper.pdf", "application/pdf"),
      file("board.jpg", "image/jpeg"),
      file("model.ipynb", ""),
      file("data.zip", "application/zip"),
    ]) {
      await expect(uploadTeamResource(where, f, f.name)).resolves.toBeTruthy();
    }
  });
});

describe("what may be shown in the page", () => {
  it("is pictures, and not the formats that carry script", () => {
    expect(previewable("image/jpeg", "a.jpg")).toBe(true);
    expect(previewable("image/heic", "a.heic")).toBe(true);
    expect(previewable("image/svg+xml", "a.svg")).toBe(false);
    expect(previewable("application/pdf", "a.pdf")).toBe(false);
    expect(previewable(null, "a.png")).toBe(true);
    expect(previewable(null, "a.csv")).toBe(false);
  });
});

describe("how a link is signed", () => {
  it("shows a picture and hands everything else over as a download", async () => {
    const rows = [
      { id: "1", mime: "image/jpeg", path: "c1/files/t1/a.jpg" },
      { id: "2", mime: "application/pdf", path: "c1/files/t1/b.pdf" },
    ] as never;
    await resourceUrlsByKind(rows);

    // Two calls, and the download flag is the fourth argument.
    const [shown, saved] = signedUrls.mock.calls as unknown as unknown[][];
    expect(shown[1]).toEqual(["c1/files/t1/a.jpg"]);
    expect(shown[3]).toBeUndefined();
    expect(saved[1]).toEqual(["c1/files/t1/b.pdf"]);
    expect(saved[3]).toBe(true);
  });
});
