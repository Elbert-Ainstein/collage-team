// The Anthropic side of the model seam, minus the network: the messages it
// builds from the turns.

import { describe, expect, it } from "vitest";
import { anthropicMessages } from "./anthropic";

describe("anthropicMessages", () => {
  it("keeps words-only turns as plain strings, as they always were", () => {
    expect(
      anthropicMessages([
        { role: "user", text: "Move Ada" },
        { role: "assistant", text: "Drafted." },
      ]),
    ).toEqual([
      { role: "user", content: "Move Ada" },
      { role: "assistant", content: "Drafted." },
    ]);
  });

  it("sends a file as a base64 document block before the words", () => {
    expect(
      anthropicMessages([{ role: "user", text: "Draft these.", file: { mimeType: "application/pdf", data: "JVBERi0=" } }]),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } },
          { type: "text", text: "Draft these." },
        ],
      },
    ]);
  });
});
