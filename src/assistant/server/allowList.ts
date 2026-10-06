// Who may spend the model key.
//
// Owning a course is not enough: any signed-in account can make one (0028), so
// "owns this course" proves only that somebody signed up. The list is set by
// whoever runs the site, in ASSISTANT_ALLOWED_EMAILS, comma-separated:
//
//   kelly@harvard.edu   one person
//   @harvard.edu        everyone at that domain, subdomains included — only as
//                       strong as Supabase's email confirmation, which proves
//                       the address belongs to whoever signed up with it
//   *                   every course owner — anyone who signs up and makes a
//                       course spends the key, so the provider's spending cap
//                       becomes the only budget. A deliberate choice, never a
//                       default.
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
  const entries = (raw ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (entries.includes("*")) return { on: true, may: (e) => Boolean(e) };
  if (!entries.length) {
    return env === "production" ? { on: false, may: () => false } : { on: true, may: () => true };
  }

  const emails = new Set(entries.filter((e) => !e.startsWith("@")));
  const domains = entries.filter((e) => e.startsWith("@")).map((e) => e.slice(1));
  return {
    on: true,
    may: (email) => {
      if (!email) return false;
      const e = email.toLowerCase();
      if (emails.has(e)) return true;
      // Exactly the domain, or a subdomain of it: "seas.harvard.edu" is in
      // "@harvard.edu", "fakeharvard.edu" and "harvard.edu.evil.com" are not.
      const domain = e.slice(e.lastIndexOf("@") + 1);
      return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
    },
  };
}
