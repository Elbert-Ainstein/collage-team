// The one seam between the assistant and whichever company's model answers it.
//
// Everything else — the prompt, the tools, the checks on what comes back — is
// written against this, so moving from Anthropic to Gemini is a second file
// beside anthropic.ts and one line in the route, not a rewrite.

import type { ToolSpec } from "../tools";
import type { Turn } from "../types";

export interface ModelCall {
  system: string;
  turns: Turn[];
  tools: ToolSpec[];
}

export interface ModelResult {
  /** Whatever the model said in words. Empty when it only called a tool. */
  text: string;
  toolCalls: { name: string; input: unknown }[];
  /**
   * The answer hit the output limit and stops mid-way. A tool call in it is
   * then missing its tail — for a class list, the last students — and must not
   * be offered as if it were whole.
   */
  truncated?: boolean;
}

export type Model = (call: ModelCall) => Promise<ModelResult>;

/**
 * A provider failure, sorted by what the instructor can do about it: nothing
 * but tell whoever runs the site ("auth"), or wait a minute ("busy").
 */
export class ModelError extends Error {
  constructor(
    readonly kind: "auth" | "busy" | "other",
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}
