// Changing the password of the account you are signed in as.

import { describe, expect, it, vi } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  changePassword,
  checkPasswordChange,
  type PasswordAuth,
  type PasswordChangeInput,
} from "./changePassword";

const EMAIL = "kelly@example.edu";

const input = (over: Partial<PasswordChangeInput> = {}): PasswordChangeInput => ({
  current: "old-secret",
  next: "new-secret",
  confirm: "new-secret",
  ...over,
});

type AuthErr = { message: string; code?: string; status?: number };

function fakeAuth({
  email = EMAIL as string | null,
  signInError = null as AuthErr | null,
  updateError = null as AuthErr | null,
  signInThrows = null as Error | null,
} = {}) {
  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: email === null ? null : { user: { email } } },
    })),
    signInWithPassword: vi.fn(async () => {
      if (signInThrows) throw signInThrows;
      return { error: signInError };
    }),
    updateUser: vi.fn(async () => ({ error: updateError })),
  };
  return auth satisfies PasswordAuth;
}

describe("checkPasswordChange", () => {
  it("accepts a filled-in, matching, long-enough new password", () => {
    expect(checkPasswordChange(input())).toBeNull();
  });

  it("asks for the current password first", () => {
    expect(checkPasswordChange(input({ current: "" }))).toMatchObject({ field: "current" });
  });

  it("refuses a new password under the minimum", () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(checkPasswordChange(input({ next: short, confirm: short }))).toMatchObject({
      field: "next",
      error: expect.stringMatching(/at least 6/),
    });
  });

  it("refuses a new password that is the current one", () => {
    expect(
      checkPasswordChange(input({ current: "same-one", next: "same-one", confirm: "same-one" })),
    ).toMatchObject({ field: "next" });
  });

  it("refuses a confirmation that does not match", () => {
    expect(checkPasswordChange(input({ confirm: "new-secreT" }))).toMatchObject({ field: "confirm" });
  });

  it("does not trim — a space is a real character in a password", () => {
    expect(checkPasswordChange(input({ next: "new-secret ", confirm: "new-secret" }))).toMatchObject({
      field: "confirm",
    });
  });
});

describe("changePassword", () => {
  it("checks the current password, then sets the new one", async () => {
    const auth = fakeAuth();
    await expect(changePassword(auth, input())).resolves.toEqual({ ok: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: "old-secret" });
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "new-secret",
      current_password: "old-secret",
    });
    // Order matters: never set the new one before the old one is proven.
    expect(auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0],
    );
  });

  it("touches nothing when the form itself is wrong", async () => {
    const auth = fakeAuth();
    const result = await changePassword(auth, input({ confirm: "nope" }));
    expect(result).toMatchObject({ ok: false, field: "confirm" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("stops at a wrong current password and says which field", async () => {
    const auth = fakeAuth({
      signInError: { message: "Invalid login credentials", code: "invalid_credentials", status: 400 },
    });
    const result = await changePassword(auth, input());
    expect(result).toEqual({
      ok: false,
      field: "current",
      error: "That isn't your current password.",
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("says so when there is no signed-in account to change", async () => {
    const auth = fakeAuth({ email: null });
    const result = await changePassword(auth, input());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/sign in again/i) });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("turns a rate limit into a plain instruction", async () => {
    const auth = fakeAuth({
      signInError: { message: "Request rate limit reached", code: "over_request_rate_limit", status: 429 },
    });
    const result = await changePassword(auth, input());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/too many tries/i) });
  });

  it("passes the server's reason through for a weak password", async () => {
    const reason = "Password should contain at least one character of each: abc, 123.";
    const auth = fakeAuth({ updateError: { message: reason, code: "weak_password", status: 422 } });
    const result = await changePassword(auth, input());
    expect(result).toEqual({ ok: false, field: "next", error: reason });
  });

  it("names a same-password refusal from the server", async () => {
    const auth = fakeAuth({
      updateError: {
        message: "New password should be different from the old password.",
        code: "same_password",
        status: 422,
      },
    });
    const result = await changePassword(auth, input());
    expect(result).toMatchObject({ ok: false, field: "next", error: expect.stringMatching(/already/i) });
  });

  it("explains an expired session instead of quoting auth jargon", async () => {
    const auth = fakeAuth({
      updateError: { message: "Auth session missing!", code: "session_not_found", status: 403 },
    });
    const result = await changePassword(auth, input());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/sign in again/i) });
  });

  it("never throws — a dropped network comes back as an error to show", async () => {
    const auth = fakeAuth({ signInThrows: new TypeError("Failed to fetch") });
    const result = await changePassword(auth, input());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't reach/i) });
  });

  it("does not leak an unknown server message raw when it is empty", async () => {
    const auth = fakeAuth({ updateError: { message: "" } });
    const result = await changePassword(auth, input());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/didn't change/i) });
  });
});
