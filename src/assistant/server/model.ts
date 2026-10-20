// The one seam between the assistant and whichever company's model answers it.
//
// Everything else — the prompt, the tools, the checks on what comes back — is
// written against this, so moving from Anthropic to Gemini is a second file
// beside anthropic.ts and one line in the route, not a rewrite.

import type { ToolSpec } from "../tools";
import type { Turn } from "../types";

/**
 * A file sent with a turn, whole, for the model to read itself — today only a
 * PDF of questions for the live-questions import. Base64, because both
 * providers take a document inline that way, and inline because the file is
 * small enough (the import caps it at 20 MB) that a separate upload API would
 * be one more thing to clean up afterwards.
 */
export interface FilePart {
  mimeType: "application/pdf";
  /** The file's bytes, base64-encoded. */
  data: string;
}

/**
 * A turn as the model is handed it. The browser's Turn (types.ts) carries words
 * only — a file never travels in a chat history — so the file part lives here,
 * on the server side of the seam, where only a route that downloaded the file
 * itself can add one.
 */
export interface ModelTurn extends Turn {
  file?: FilePart;
}

export interface ModelCall {
  system: string;
  turns: ModelTurn[];
  tools: ToolSpec[];
  /**
   * Answer with a tool call, not words. The import has exactly one useful
   * answer — a draft — and a model left free to chat about the PDF instead
   * hands back nothing the builder can open. Off for the assistant, which
   * answers questions in words as often as it drafts.
   */
  requireTool?: boolean;
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
