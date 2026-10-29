// One read at a time, per screen.
//
// A live screen reads on realtime, on a poll and after every tap. When the
// database is slow, a poll that fires again before the last read landed used to
// start another — every phone in the room stacking reads on a server that was
// already behind, until none of them came back. Now a call while a read is
// running queues exactly one more, run after it; any further calls share that
// one. A slow server gets fewer reads, not more, and reads land in order.

export function singleFlight(run: () => Promise<void>): () => Promise<void> {
  let running = false;
  let queued: { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } | null = null;

  const start = (): Promise<void> => {
    running = true;
    const p = run();
    p.then(settle, settle);
    return p;
  };

  // The read ending and the queued one starting happen in one step: a call
  // can't slip in between and put a second read out beside it.
  function settle() {
    running = false;
    const next = queued;
    queued = null;
    if (next) start().then(next.resolve, next.reject);
  }

  return () => {
    if (!running) return start();
    if (!queued) {
      let resolve!: () => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      queued = { promise, resolve, reject };
    }
    return queued.promise;
  };
}

/** A delay spread over [ms, ms + spread): a room of phones woken by one event doesn't read in the same instant. */
export const spread = (ms: number, by: number): number => ms + Math.floor(Math.random() * by);
