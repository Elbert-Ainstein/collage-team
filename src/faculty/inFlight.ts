/**
 * One promise per key while it is still running.
 *
 * For a write that must not go twice: React strict mode runs an effect twice
 * on mount, and two copies of "seed the rubric if it is blank" both read an
 * empty table before either insert lands — the second then trips the unique
 * constraint and the screen shows an error for a rubric that was written fine.
 * The second caller gets the first caller's promise instead. The map is the
 * caller's, so tests and modules each keep their own.
 */
export function shareInFlight<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>,
): Promise<T> {
  const running = pending.get(key);
  if (running) return running;
  const p = start().finally(() => {
    if (pending.get(key) === p) pending.delete(key);
  });
  pending.set(key, p);
  return p;
}
