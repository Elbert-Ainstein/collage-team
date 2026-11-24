// Changing the password of the account you are signed in as.
//
// The reset link (AuthGate's SetNewPassword) is the way back in when the
// password is lost. This is the other case: you know it and want a different
// one. The current password is asked for and checked first, so a laptop left
// signed in on a lab bench cannot have its owner locked out by whoever sits
// down next.

/** Supabase's default minimum, and what the sign-up form already promises. */
export const MIN_PASSWORD_LENGTH = 6;

export interface PasswordChangeInput {
  current: string;
  next: string;
  confirm: string;
}

/** Which box the error belongs to, so the form can point at it. */
export type PasswordField = "current" | "next" | "confirm";

export interface PasswordChangeProblem {
  error: string;
  field?: PasswordField;
}

export type PasswordChangeResult = { ok: true } | ({ ok: false } & PasswordChangeProblem);

interface AuthErrorLike {
  message: string;
  code?: string;
  status?: number;
}

/** The slice of supabase.auth this needs — small enough to fake in a test. */
export interface PasswordAuth {
  getSession(): Promise<{ data: { session: { user: { email?: string | null } } | null } }>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{ error: AuthErrorLike | null }>;
  updateUser(attributes: {
    password: string;
    current_password: string;
  }): Promise<{ error: AuthErrorLike | null }>;
}

const SIGNED_OUT = "You've been signed out. Sign in again, then change your password.";
const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";
const RATE_LIMITED = "Too many tries. Wait a few minutes and try again.";
const UNCHANGED = "Your password didn't change. Try again.";
const SAME_AS_CURRENT = "That's the password you already have.";

/**
 * What is wrong with the form before anything is sent, or null if nothing is.
 * Nothing is trimmed: a trailing space is a character the sign-in form will
 * also send, so it is part of the password.
 */
export function checkPasswordChange({ current, next, confirm }: PasswordChangeInput): PasswordChangeProblem | null {
  if (current === "") return { field: "current", error: "Enter your current password." };
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { field: "next", error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (next === current) return { field: "next", error: SAME_AS_CURRENT };
  if (next !== confirm) return { field: "confirm", error: "Those two passwords don't match." };
  return null;
}

function isRateLimit(e: AuthErrorLike): boolean {
  return e.status === 429 || /rate.?limit/i.test(e.code ?? "") || /rate limit/i.test(e.message);
}

function isSessionGone(e: AuthErrorLike): boolean {
  return (
    /session_not_found|session_expired|bad_jwt|no_authorization/i.test(e.code ?? "") ||
    /auth session missing|jwt expired/i.test(e.message)
  );
}

/** A refusal from checking the current password, in words for the form. */
function explainVerifyError(e: AuthErrorLike): PasswordChangeProblem {
  if (isRateLimit(e)) return { error: RATE_LIMITED };
  if (e.code === "invalid_credentials" || /invalid login credentials/i.test(e.message)) {
    return { field: "current", error: "That isn't your current password." };
  }
  return { error: e.message || UNCHANGED };
}

/** A refusal from setting the new password, in words for the form. */
function explainUpdateError(e: AuthErrorLike): PasswordChangeProblem {
  if (isRateLimit(e)) return { error: RATE_LIMITED };
  if (isSessionGone(e)) return { error: SIGNED_OUT };
  if (e.code === "same_password" || /different from the old password/i.test(e.message)) {
    return { field: "next", error: SAME_AS_CURRENT };
  }
  // The server's own words are the useful part here: it says which kinds of
  // character a stricter project policy wants.
  if (e.code === "weak_password") return { field: "next", error: e.message || UNCHANGED };
  // Only when the project enforces it server-side; the check above has already
  // made this unlikely, but the server is the one that decides.
  if (/current_password/i.test(e.code ?? "")) {
    return { field: "current", error: "That isn't your current password." };
  }
  if (e.code === "reauthentication_needed") {
    return { error: "Sign out and back in, then change your password." };
  }
  return { error: e.message || UNCHANGED };
}

/**
 * Prove the current password, then set the new one. Never throws: every
 * failure comes back as a sentence the form can show.
 *
 * The current password is checked by signing in with it. A wrong one leaves
 * the existing session as it was (auth-js only saves a session on success); a
 * right one swaps in a fresh session for the same account, which is also what
 * a project with "secure password change" turned on wants to see before it
 * accepts an update. `current_password` rides along on the update for a
 * project that enforces the check on the server as well.
 */
export async function changePassword(
  auth: PasswordAuth,
  input: PasswordChangeInput,
): Promise<PasswordChangeResult> {
  const problem = checkPasswordChange(input);
  if (problem) return { ok: false, ...problem };

  try {
    const { data } = await auth.getSession();
    const email = data.session?.user.email;
    if (!email) return { ok: false, error: SIGNED_OUT };

    const verified = await auth.signInWithPassword({ email, password: input.current });
    if (verified.error) return { ok: false, ...explainVerifyError(verified.error) };

    const updated = await auth.updateUser({ password: input.next, current_password: input.current });
    if (updated.error) return { ok: false, ...explainUpdateError(updated.error) };

    return { ok: true };
  } catch {
    // fetch rejects (offline, timed out) rather than returning an AuthError.
    return { ok: false, error: UNREACHABLE };
  }
}
