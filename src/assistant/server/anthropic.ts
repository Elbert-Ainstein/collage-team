// The assistant's model, answered by Anthropic.
//
// Server only: it is handed the key by the route, which reads it from an
// environment variable with no NEXT_PUBLIC_ prefix — so even an accidental
// import from the browser would find no key to send.

import Anthropic from "@anthropic-ai/sdk";
import { ModelError, type Model, type ModelTurn } from "./model";

/**
 * Room for a 500-student list rewritten as rows, which is the longest answer
 * the assistant gives. Kept under the point where the SDK insists on streaming.
 */
const MAX_OUTPUT_TOKENS = 16_000;

function classify(e: unknown): ModelError {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ModelError("auth", e.message);
  }
  if (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.InternalServerError ||
    e instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return new ModelError("busy", e.message);
  }
  return new ModelError("other", e instanceof Error ? e.message : String(e));
}

/**
 * The turns in Anthropic's shape. Words alone stay a plain string, as they
 * always were; a turn with a file becomes a document block followed by the
 * words, which is the order Anthropic recommends for asking about a document.
 */
export function anthropicMessages(turns: ModelTurn[]): Anthropic.MessageParam[] {
  return turns.map((t) =>
    t.file
      ? {
          role: t.role,
          content: [
            { type: "document", source: { type: "base64", media_type: t.file.mimeType, data: t.file.data } },
            { type: "text", text: t.text },
          ],
        }
      : { role: t.role, content: t.text },
  );
}

/**
 * Two tries of two minutes, inside the route's five-minute ceiling — so a slow
 * answer ends here as a sentence she can read, not as the host cutting the
 * function off and the browser getting an HTML error page.
 */
const TIMEOUT_MS = 120_000;
const RETRIES = 1;

export function anthropicModel(opts: { apiKey: string; model: string }): Model {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: RETRIES, timeout: TIMEOUT_MS });

  return async ({ system, turns, tools, requireTool }) => {
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model: opts.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Cached: the rules and the class are the same on every turn of one
        // conversation, and only the new message changes.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: anthropicMessages(turns),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.schema,
        })),
        // "any" makes Claude call one of the tools it was given.
        ...(requireTool ? { tool_choice: { type: "any" as const } } : {}),
      });
    } catch (e) {
      throw classify(e);
    }

    const text = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    const toolCalls = res.content.flatMap((b) =>
      b.type === "tool_use" ? [{ name: b.name, input: b.input }] : [],
    );
    return { text, toolCalls, truncated: res.stop_reason === "max_tokens" };
  };
}
