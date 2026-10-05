import { describe, expect, it } from "vitest";
import { chooseProvider } from "./provider";

describe("chooseProvider", () => {
  it("uses Gemini when its key is set — the course's own key, not a stand-in", () => {
    expect(chooseProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toEqual({
      provider: "gemini",
      model: "gemini-3.8-flash",
      apiKey: "g",
    });
  });

  it("falls back to Anthropic when only that key is set", () => {
    expect(chooseProvider({ ANTHROPIC_API_KEY: "a" })).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      apiKey: "a",
    });
  });

  it("follows ASSISTANT_PROVIDER and ASSISTANT_MODEL when they are set", () => {
    expect(
      chooseProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", ASSISTANT_PROVIDER: "Anthropic", ASSISTANT_MODEL: "claude-x" }),
    ).toEqual({ provider: "anthropic", model: "claude-x", apiKey: "a" });
  });

  it("is off with no key, or when the chosen provider has none", () => {
    expect(chooseProvider({})).toBeNull();
    expect(chooseProvider({ ANTHROPIC_API_KEY: "a", ASSISTANT_PROVIDER: "gemini" })).toBeNull();
    expect(chooseProvider({ GEMINI_API_KEY: "  " })).toBeNull();
  });
});
