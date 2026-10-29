import { describe, expect, it } from "vitest";
import { singleFlight, spread } from "./singleFlight";

function gate() {
  let open!: () => void;
  let fail!: (e: Error) => void;
  const p = new Promise<void>((res, rej) => {
    open = res;
    fail = rej;
  });
  return { p, open, fail };
}

describe("singleFlight", () => {
  it("never runs two reads at once, however many calls pile up", async () => {
    const gates = [gate(), gate()];
    let calls = 0;
    let inFlight = 0;
    let most = 0;
    const read = singleFlight(async () => {
      const g = gates[calls++];
      inFlight++;
      most = Math.max(most, inFlight);
      try {
        await g.p;
      } finally {
        inFlight--;
      }
    });

    const first = read();
    const queued = [read(), read(), read(), read()];
    expect(calls).toBe(1);

    gates[0].open();
    await first;
    await Promise.resolve();
    expect(calls).toBe(2);

    gates[1].open();
    await Promise.all(queued);
    expect(calls).toBe(2);
    expect(most).toBe(1);
  });

  it("still runs the queued read after a failed one", async () => {
    const g = gate();
    let calls = 0;
    const read = singleFlight(async () => {
      calls++;
      if (calls === 1) await g.p;
    });
    const first = read();
    const second = read();
    g.fail(new Error("timed out"));
    await expect(first).rejects.toThrow("timed out");
    await second;
    expect(calls).toBe(2);
  });

  it("starts fresh once everything has landed", async () => {
    let calls = 0;
    const read = singleFlight(async () => {
      calls++;
    });
    await read();
    await read();
    expect(calls).toBe(2);
  });
});

describe("spread", () => {
  it("stays inside its window", () => {
    for (let i = 0; i < 200; i++) {
      const ms = spread(200, 800);
      expect(ms).toBeGreaterThanOrEqual(200);
      expect(ms).toBeLessThan(1000);
    }
  });
});
