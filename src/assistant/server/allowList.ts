// Who may spend the model key.
//
// Owning a course is not enough: any signed-in account can make one (0028), so
// "owns this course" proves only that somebody signed up. The list is set by
// whoever runs the site, in ASSISTANT_ALLOWED_EMAILS — the instructors the
// assistant is for, and nobody else.
//
// In production an unset list means NOBODY, so forgetting it leaves the
// assistant off rather than open to the internet. Locally an unset list lets
// any course owner in, so trying it needs no setup.

export interface AllowList {
  /** False when the assistant is off for everyone. */
  on: boolean;
  may: (email: string | null) => boolean;
}

export function allowListFrom(raw: string | undefined, env: string | undefined): AllowList {
  const emails = new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  if (emails.size) return { on: true, may: (e) => Boolean(e) && emails.has((e as string).toLowerCase()) };
  if (env === "production") return { on: false, may: () => false };
  return { on: true, may: () => true };
}
