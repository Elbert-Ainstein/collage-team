// The Gemini side of the model seam, minus the network: the request it builds,
// how it reads an answer back, and how failures are sorted for the instructor.

import { describe, expect, it, vi } from "vitest";
import { PREPARE_IMPORT, SEAT_STUDENTS } from "../tools";
import { geminiModel, geminiRequest, readGeminiResponse, toGeminiSchema } from "./gemini";
import { ModelError } from "./model";

const call = {
  system: "You are the assistant.",
  turns: [
    { role: "user" as const, text: "Move Ada" },
    { role: "assistant" as const, text: "Drafted." },
    { role: "user" as const, text: "And Alan" },
  ],
  tools: [SEAT_STUDENTS, PREPARE_IMPORT],
};

describe("toGeminiSchema", () => {
  it("upper-cases types all the way down and keeps what Gemini reads", () => {
    const s = toGeminiSchema(SEAT_STUDENTS.schema) as Record<string, any>;
    expect(s.type).toBe("OBJECT");
    expect(s.required).toEqual(["summary", "moves"]);
    expect(s.properties.moves.type).toBe("ARRAY");
    expect(s.properties.moves.items.type).toBe("OBJECT");
    expect(s.properties.moves.items.properties.student.type).toBe("STRING");
  });

  it("keeps an enum", () => {
    expect(toGeminiSchema({ type: "string", enum: ["category", "number"] })).toEqual({
      type: "STRING",
      enum: ["category", "number"],
    });
  });
});

describe("geminiRequest", () => {
  it("sends the rules as the system instruction and the turns as user and model", () => {
    const r = geminiRequest(call);
    expect(r.systemInstruction).toEqual({ parts: [{ text: "You are the assistant." }] });
    expect(r.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(r.tools[0].functionDeclarations.map((f) => f.name)).toEqual(["seat_students", "prepare_import"]);
  });
});

describe("readGeminiResponse", () => {
  it("reads words and a function call, and skips the model's own thinking", () => {
    const out = readGeminiResponse({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { text: "thinking about it", thought: true },
              { text: "Here is a draft." },
              { functionCall: { name: "seat_students", args: { summary: "x", moves: [] } } },
            ],
          },
        },
      ],
    });
    expect(out).toEqual({
      text: "Here is a draft.",
      toolCalls: [{ name: "seat_students", input: { summary: "x", moves: [] } }],
      truncated: false,
    });
  });

  it("says when the answer was cut off at the output limit", () => {
    expect(readGeminiResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }).truncated).toBe(true);
  });

  it("treats a blocked prompt as a failure, not an empty answer", () => {
    expect(() => readGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(ModelError);
  });
});

describe("geminiModel", () => {
  const ok = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Ada is on Team 1." }] } }] };
  const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("calls the model by name with the key in a header, never in the URL", async () => {
    const fetchImpl = vi.fn(() => reply(200, ok));
    const out = await geminiModel({ apiKey: "k-123", model: "gemini-x", fetchImpl, retryDelayMs: 0 })(call);
    expect(out.text).toBe("Ada is on Team 1.");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
    expect(url).not.toContain("k-123");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-123");
  });

  it("sorts a refused key as auth, without retrying", async () => {
    const fetchImpl = vi.fn(() => reply(400, { error: { message: "API key not valid. Please pass a valid API key." } }));
    const m = geminiModel({ apiKey: "bad", model: "gemini-x", fetchImpl, retryDelayMs: 0 });
    await expect(m(call)).rejects.toMatchObject({ kind: "auth" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once when Google is busy, then says busy", async () => {
    const fetchImpl = vi.fn(() => reply(503, { error: { message: "overloaded" } }));
    const m = geminiModel({ apiKey: "k", model: "gemini-x", fetchImpl, retryDelayMs: 0 });
    await expect(m(call)).rejects.toMatchObject({ kind: "busy" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the retry when the first try was busy", async () => {
    const fetchImpl = vi.fn().mockReturnValueOnce(reply(429, {})).mockReturnValueOnce(reply(200, ok));
    const out = await geminiModel({ apiKey: "k", model: "gemini-x", fetchImpl, retryDelayMs: 0 })(call);
    expect(out.text).toBe("Ada is on Team 1.");
  });
});
