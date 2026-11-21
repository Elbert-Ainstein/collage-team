// Small text helpers shared by the prompt builders.

/** One line per thing, whatever a name had in it. */
export function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
