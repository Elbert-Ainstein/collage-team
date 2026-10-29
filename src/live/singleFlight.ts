// One read at a time, per screen.
//
// A live screen reads on realtime, on a poll and after every tap. When the
// database is slow, a poll that fires again before the last read landed used to
// start another — every phone in the room stacking reads on a server that was
// already behind, until none of them came back. Now a call while a read is
// running queues exactly one more, run after it; any further calls share that
// one. A slow server gets fewer reads, not more, and reads land in order.

export function singleFlight(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  const start = (): Promise<void> => {
    const p = run().finally(() => {
      if (running === p) running = null;
    });
    running = p;
    return p;
  };

  return () => {
    if (!running) return start();
    if (!queued) {
      queued = running
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return start();
        });
    }
    return queued;
  };
}

/** A delay spread over [ms, ms + spread): a room of phones woken by one event doesn't read in the same instant. */
export const spread = (ms: number, by: number): number => ms + Math.floor(Math.random() * by);
