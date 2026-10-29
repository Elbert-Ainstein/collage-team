// The timeout every database and sign-in request goes through, on any device:
// a request the server never answers fails after REQUEST_TIMEOUT_MS instead of
// waiting forever, and storage uploads are left alone.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from "./supabaseClient";

/** A fetch that never answers, but rejects when its signal aborts — as a browser's does. */
const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }),
);

beforeEach(() => {
  vi.useFakeTimers();
  hanging.mockClear();
  vi.stubGlobal("fetch", hanging);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("gives up on a database read the server never answers", async () => {
    const read = fetchWithTimeout("https://x.supabase.co/rest/v1/live_state?select=*");
    const outcome = expect(read).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await outcome;
  });

  it("and on a sign-in request", async () => {
    const auth = fetchWithTimeout("https://x.supabase.co/auth/v1/token?grant_type=refresh_token", { method: "POST" });
    const outcome = expect(auth).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await outcome;
  });

  it("doesn't give up early", async () => {
    let settled = false;
    void fetchWithTimeout("https://x.supabase.co/rest/v1/live_votes").catch(() => undefined).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
  });

  it("leaves storage uploads without a timeout", async () => {
    void fetchWithTimeout("https://x.supabase.co/storage/v1/object/activity-files/a.pdf", { method: "POST" });
    expect(hanging.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it("keeps a signal the caller set itself", () => {
    const own = new AbortController().signal;
    void fetchWithTimeout("https://x.supabase.co/rest/v1/live_state", { signal: own });
    expect(hanging.mock.calls[0][1]?.signal).toBe(own);
  });

  it("passes a Request object through with its URL read correctly", async () => {
    const req = new Request("https://x.supabase.co/storage/v1/object/b.png");
    void fetchWithTimeout(req);
    expect(hanging.mock.calls[0][1]?.signal).toBeUndefined();
  });
});
