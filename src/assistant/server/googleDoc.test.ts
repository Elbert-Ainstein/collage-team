// Reading a linked Google Doc: which links count, and that the server only
// ever talks to Google — whatever a redirect or a pasted link says.

import { describe, expect, it, vi } from "vitest";
import { googleDocFetcher, googleDocIds, linkedDoc, MAX_DOC_CHARS } from "./googleDoc";

const ID = "1nDGFdHqkBX47AoWmrGGkdmVjVtmUF8fCxxh-J3xiEEc";
const LINK = `https://docs.google.com/document/d/${ID}/edit?usp=sharing`;

const fresh = { timeoutMs: 5_000, cached: false };

const reply = (status: number, body = "", headers: Record<string, string> = {}) =>
  new Response(status >= 300 && status < 400 ? null : body, { status, headers });

describe("googleDocIds", () => {
  it("finds a doc's id in a sharing link, an /u/0/ link and a bare one", () => {
    expect(googleDocIds(`fill this out ${LINK} thanks`)).toEqual([ID]);
    expect(googleDocIds(`https://docs.google.com/document/u/0/d/${ID}/edit`)).toEqual([ID]);
    expect(googleDocIds(`https://docs.google.com/document/d/${ID}`)).toEqual([ID]);
  });

  it("ignores sheets, slides, published docs and look-alike hosts", () => {
    expect(googleDocIds(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toEqual([]);
    expect(googleDocIds(`https://docs.google.com/document/d/e/2PACX-1vQ${ID}/pub`)).toEqual([]);
    expect(googleDocIds(`https://docs.google.com.evil.example/document/d/${ID}`)).toEqual([]);
    expect(googleDocIds(`https://evil.example/docs.google.com/document/d/${ID}`)).toEqual([]);
  });
});

describe("linkedDoc", () => {
  it("prefers this message's link, then her most recent earlier one", () => {
    const other = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg";
    const history = [
      { role: "user" as const, text: `https://docs.google.com/document/d/${other}/edit` },
      { role: "assistant" as const, text: `I read https://docs.google.com/document/d/${ID}/edit` },
    ];
    expect(linkedDoc(`use ${LINK}`, history)).toEqual({ id: ID, inMessage: true });
    // The assistant's own words are not a link she gave.
    expect(linkedDoc("use the revised scales instead", history)).toEqual({ id: other, inMessage: false });
    expect(linkedDoc("set the late penalty to 20", [])).toBeNull();
  });
});

describe("googleDocFetcher", () => {
  it("asks Google for the Markdown export and follows its redirect to the download host", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.startsWith("https://docs.google.com/")) {
        return reply(307, "", { location: "https://doc-0g-cc-docstext.googleusercontent.com/export/abc?format=md" });
      }
      return reply(200, "# AP50 Teamwork Evaluation\r\n\r\n| **5** | Consistently… |", { "content-type": "text/x-markdown; charset=utf-8" });
    });
    const got = await googleDocFetcher(fetchImpl)(ID, fresh);
    expect(got).toEqual({ ok: true, id: ID, text: "# AP50 Teamwork Evaluation\n\n| **5** | Consistently… |", truncated: false });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`https://docs.google.com/document/d/${ID}/export?format=md`);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("calls a 404 or a sign-in redirect private, and does not retry it as text", async () => {
    const notFound = vi.fn<typeof fetch>(async () => reply(404, "<html>", { "content-type": "text/html" }));
    expect(await googleDocFetcher(notFound)(ID, fresh)).toEqual({ ok: false, id: ID, reason: "private" });
    expect(notFound).toHaveBeenCalledTimes(1);

    const signIn = vi.fn<typeof fetch>(async () =>
      reply(302, "", { location: "https://accounts.google.com/ServiceLogin?continue=x" }),
    );
    expect(await googleDocFetcher(signIn)(ID, fresh)).toEqual({ ok: false, id: ID, reason: "private" });
  });

  it("will not follow a redirect off Google's hosts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(302, "", { location: "http://169.254.169.254/latest/meta-data" }));
    expect(await googleDocFetcher(fetchImpl)(ID, fresh)).toEqual({ ok: false, id: ID, reason: "unreachable" });
    expect(fetchImpl.mock.calls.every(([u]) => String(u).startsWith("https://docs.google.com/"))).toBe(true);
  });

  it("treats an HTML page as not the doc", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, "<html>Sign in</html>", { "content-type": "text/html" }));
    expect(await googleDocFetcher(fetchImpl)(ID, fresh)).toMatchObject({ ok: false, reason: "private" });
  });

  it("falls back to plain text when Markdown fails for another reason", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("format=md")
        ? reply(500, "oops")
        : reply(200, "AP50 TEAMWORK", { "content-type": "text/plain; charset=utf-8" }),
    );
    expect(await googleDocFetcher(fetchImpl)(ID, fresh)).toMatchObject({ ok: true, text: "AP50 TEAMWORK" });
  });

  it("says unreachable when the network fails, without trying the second format", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await googleDocFetcher(fetchImpl)(ID, fresh)).toEqual({ ok: false, id: ID, reason: "unreachable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up when Google takes longer than the budget", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")))),
    );
    const got = await googleDocFetcher(fetchImpl)(ID, { timeoutMs: 30, cached: false });
    expect(got).toEqual({ ok: false, id: ID, reason: "unreachable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reuses a recent read for a follow-up, but reads a link sent again afresh", async () => {
    let clock = 0;
    let reads = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, `v${++reads}`, { "content-type": "text/plain" }));
    const read = googleDocFetcher(fetchImpl, () => clock);
    expect(await read(ID, fresh)).toMatchObject({ text: "v1" });
    expect(await read(ID, { timeoutMs: 5_000, cached: true })).toMatchObject({ text: "v1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await read(ID, fresh)).toMatchObject({ text: "v2" });
    clock += 11 * 60_000;
    expect(await read(ID, { timeoutMs: 5_000, cached: true })).toMatchObject({ text: "v3" });
  });

  it("cuts a very long doc to what the prompt can hold, and says so", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply(200, "w".repeat(MAX_DOC_CHARS + 50), { "content-type": "text/plain" }),
    );
    const got = await googleDocFetcher(fetchImpl)(ID, fresh);
    expect(got).toMatchObject({ ok: true, truncated: true });
    expect(got.ok && got.text.length).toBe(MAX_DOC_CHARS);
  });
});

describe("isGoogleHost", () => {
  it("allows Google's doc hosts on the standard port only", async () => {
    const { isGoogleHost } = await import("./googleDoc");
    expect(isGoogleHost(new URL("https://docs.google.com/document/d/x/export"))).toBe(true);
    expect(isGoogleHost(new URL("https://doc-0g-cc-docstext.googleusercontent.com/export/x"))).toBe(true);
    expect(isGoogleHost(new URL("https://docs.google.com:8443/x"))).toBe(false);
    expect(isGoogleHost(new URL("https://user:pw@docs.google.com/x"))).toBe(false);
    expect(isGoogleHost(new URL("http://docs.google.com/x"))).toBe(false);
    expect(isGoogleHost(new URL("https://googleusercontent.com.evil.example/x"))).toBe(false);
  });
});
