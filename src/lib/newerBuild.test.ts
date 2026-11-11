// A tab left open across a deploy is running the old build against the new
// database. These pin how it finds out.

import { describe, expect, it, vi } from "vitest";
import { fetchServerBuild, isNewerBuild } from "./newerBuild";

const answering = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("fetchServerBuild", () => {
  it("reads the build the server is on, never from a cache", async () => {
    const f = answering(200, { build: "b2" });
    expect(await fetchServerBuild(f as unknown as typeof fetch)).toBe("b2");
    expect(f).toHaveBeenCalledWith("/api/version", { cache: "no-store" });
  });

  it("is no news when the server can't be asked", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchServerBuild(offline as unknown as typeof fetch)).toBeNull();
    expect(await fetchServerBuild(answering(500, { build: "b2" }) as unknown as typeof fetch)).toBeNull();
  });

  it("is no news when the answer isn't a build", async () => {
    expect(await fetchServerBuild(answering(200, { build: 7 }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchServerBuild(answering(200, { build: "" }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchServerBuild(answering(200, null) as unknown as typeof fetch)).toBeNull();
    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await fetchServerBuild(html as unknown as typeof fetch)).toBeNull();
  });
});

describe("isNewerBuild", () => {
  it("is newer when the server is on a different build", () => {
    expect(isNewerBuild("b1", "b2")).toBe(true);
  });

  it("is not when it's the same build, or there's no answer", () => {
    expect(isNewerBuild("b1", "b1")).toBe(false);
    expect(isNewerBuild("b1", null)).toBe(false);
  });

  it("never fires on a build without an id (local dev)", () => {
    expect(isNewerBuild("dev", "b2")).toBe(false);
    expect(isNewerBuild("b1", "dev")).toBe(false);
  });
});
