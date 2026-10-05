// The assistant's model, answered by Google's Gemini.
//
// The same seam as anthropic.ts (see model.ts): the prompt, the tools and the
// checks on what comes back do not know which company answered. Plain fetch
// against the Gemini REST API rather than an SDK — one endpoint, one request
// shape, nothing to keep up to date.
//
// Server only. The key goes in the x-goog-api-key header, never in the URL,
// where it would end up in every log line that prints one.

import type { ToolSpec } from "../tools";
import { ModelError, type Model, type ModelCall, type ModelResult } from "./model";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Inside the route's ceiling with room for one retry — see the route's maxDuration. */
const TIMEOUT_MS = 120_000;
/** Gemini counts its thinking against this, so it is set well above the longest answer. */
const MAX_OUTPUT_TOKENS = 32_768;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A tool schema in Gemini's dialect: the OpenAPI subset, with upper-case type
 * names. Only the keys Gemini reads are carried over — tools.ts already keeps
 * to what every provider accepts.
 */
export function toGeminiSchema(s: unknown): unknown {
  if (!isObj(s)) return s;
  const out: Obj = {};
  if (typeof s.type === "string") out.type = s.type.toUpperCase();
  if (typeof s.description === "string") out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (isObj(s.properties)) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  if (s.items !== undefined) out.items = toGeminiSchema(s.items);
  if (Array.isArray(s.required)) out.required = s.required;
  return out;
}

const declaration = (t: ToolSpec) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.schema) });

export function geminiRequest(call: ModelCall) {
  return {
    systemInstruction: { parts: [{ text: call.system }] },
    contents: call.turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
    tools: [{ functionDeclarations: call.tools.map(declaration) }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  };
}

/** Gemini's answer as the seam's. Its own thinking is not part of the answer. */
export function readGeminiResponse(body: unknown): ModelResult {
  const b = isObj(body) ? body : {};
  const candidate = Array.isArray(b.candidates) && isObj(b.candidates[0]) ? b.candidates[0] : null;
  if (!candidate) {
    const reason = isObj(b.promptFeedback) ? String(b.promptFeedback.blockReason ?? "no answer") : "no answer";
    throw new ModelError("other", `Gemini returned no answer: ${reason}`);
  }
  const content = isObj(candidate.content) ? candidate.content : {};
  const parts = Array.isArray(content.parts) ? content.parts.filter(isObj) : [];
  const text = parts
    .filter((p) => typeof p.text === "string" && p.thought !== true)
    .map((p) => p.text as string)
    .join("\n")
    .trim();
  const toolCalls = parts.flatMap((p) =>
    isObj(p.functionCall) && typeof p.functionCall.name === "string"
      ? [{ name: p.functionCall.name, input: p.functionCall.args ?? {} }]
      : [],
  );
  return { text, toolCalls, truncated: candidate.finishReason === "MAX_TOKENS" };
}

function classify(status: number, message: string): ModelError {
  if (status === 401 || status === 403 || /api key/i.test(message)) return new ModelError("auth", message);
  if (status === 429 || status >= 500) return new ModelError("busy", message);
  return new ModelError("other", message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function geminiModel(opts: {
  apiKey: string;
  model: string;
  /** Tests pass their own; the route uses the platform's. */
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}): Model {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${ENDPOINT}/${encodeURIComponent(opts.model)}:generateContent`;

  async function once(call: ModelCall): Promise<ModelResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify(geminiRequest(call)),
        signal: controller.signal,
      });
    } catch (e) {
      throw new ModelError("busy", e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let message = raw;
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        message = parsed.error?.message ?? raw;
      } catch {
        // Not JSON: keep the text as it came.
      }
      throw classify(res.status, `${res.status} ${message}`.trim());
    }
    return readGeminiResponse(await res.json());
  }

  return async (call) => {
    try {
      return await once(call);
    } catch (e) {
      // One retry, and only for "busy": a refused key or a bad request fails
      // the same way every time.
      if (!(e instanceof ModelError) || e.kind !== "busy") throw e;
      await sleep(opts.retryDelayMs ?? 1500);
      return once(call);
    }
  };
}
