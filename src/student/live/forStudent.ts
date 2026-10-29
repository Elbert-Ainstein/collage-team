// What a student is shown when a save, vote or lock is refused.
//
// The live-questions checks (0047) refuse with sentences written for the
// student. Anything else — a constraint name, a dropped connection, a policy
// message — is shown as one plain line instead: it means nothing to them, and
// raw database text is not something to put on their screen.

const WRITTEN_FOR_STUDENTS = [
  "Everyone has to be on the same answer first",
  "Only someone on your team can be marked absent",
  "Only your team's leader",
  "Pick an answer first",
  "Pick someone on your team who's here",
  "Team mode has started, so answers on your own are closed",
  "Team mode isn't running",
  "There are still points for this one — keep trying",
  "Try the options that are left",
  "Vote first",
  "Votes are split — agree on one person",
  "Wait for one more vote",
  "That answer can't be used",
  "That question isn't available",
  "You're not on a team for this activity",
  "You're here — you can't mark yourself absent",
  "You're marked absent for this session",
  "Your team already has a leader",
  "Your team already tried that one",
  "Your team has already locked this one",
];

export function forStudent(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : "";
  return WRITTEN_FOR_STUDENTS.some((m) => message.startsWith(m)) ? message : fallback;
}
