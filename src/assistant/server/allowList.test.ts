import { describe, expect, it } from "vitest";
import { allowListFrom } from "./allowList";

describe("allowListFrom", () => {
  it("reads addresses separated by commas, spaces or new lines, in any case", () => {
    const allowed = allowListFrom(" Kelly@Harvard.edu, tf@harvard.edu\ncaleb@x.edu ", "production");
    expect(allowed.on).toBe(true);
    expect(allowed.may("kelly@harvard.edu")).toBe(true);
    expect(allowed.may("CALEB@X.EDU")).toBe(true);
    expect(allowed.may("student@harvard.edu")).toBe(false);
    expect(allowed.may(null)).toBe(false);
  });

  it("is off in production without a list — the safe default is nobody", () => {
    const allowed = allowListFrom(undefined, "production");
    expect(allowed.on).toBe(false);
    expect(allowed.may("kelly@harvard.edu")).toBe(false);
  });

  it("lets any course owner in while developing locally, so testing needs no setup", () => {
    const allowed = allowListFrom("", "development");
    expect(allowed.on).toBe(true);
    expect(allowed.may("anyone@x.edu")).toBe(true);
  });
});
