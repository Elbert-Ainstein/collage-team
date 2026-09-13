import { describe, expect, it } from "vitest";
import { shareInFlight } from "./inFlight";

// Two callers asking for the same write while it is still in the air get the
// same promise, and once it settles the next caller starts a fresh one.

describe("shareInFlight", () => {
  it("hands a second caller the promise already running under that key", async () => {
    const pending = new Map<string, Promise<number>>();
    let started = 0;
    let finish!: (n: number) => void;
    const start = () => {
      started += 1;
      return new Promise<number>((r) => (finish = r));
    };

    const a = shareInFlight(pending, "act1", start);
    const b = shareInFlight(pending, "act1", start);
    expect(started).toBe(1);
    expect(a).toBe(b);

    finish(7);
    expect(await b).toBe(7);
  });

  it("starts again once the earlier one has settled", async () => {
    const pending = new Map<string, Promise<number>>();
    let started = 0;
    const start = async () => ++started;

    await shareInFlight(pending, "act1", start);
    await shareInFlight(pending, "act1", start);
    expect(started).toBe(2);
    expect(pending.size).toBe(0);
  });

  it("forgets a key whose promise rejected, so the failure is not replayed", async () => {
    const pending = new Map<string, Promise<number>>();
    await expect(shareInFlight(pending, "k", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(pending.has("k")).toBe(false);
  });

  it("keeps different keys apart", () => {
    const pending = new Map<string, Promise<number>>();
    const a = shareInFlight(pending, "a", () => new Promise(() => undefined));
    const b = shareInFlight(pending, "b", () => new Promise(() => undefined));
    expect(a).not.toBe(b);
  });
});
