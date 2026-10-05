// The assistant route, with everything that touches the network passed in.
//
// The gates run cheapest-first, and every one of them runs before the model is
// called: the model call is the only step here that costs money, so a request
// that will be refused must be refused before it.

import { conversation, systemPrompt } from "../prompt";
import { parseRequest } from "../request";
import { parseToolCall, toolsFor } from "../tools";
import type { AssistantReply, AssistantResponse } from "../types";
import { ModelError, type Model, type ModelResult } from "./model";
import type { RateLimiter } from "./rateLimit";

/** Who is asking, and whether this course's teams are theirs to change. */
export type Verified =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; status: 401 | 403; error: string };

export interface HandlerDeps {
  /** Null when no provider key is configured — the assistant is then off. */
  model: Model | null;
  verify: (token: string, courseId: string) => Promise<Verified>;
  /** Whether this account may spend the key at all — see allowList.ts. */
  allowed: (email: string | null) => boolean;
  limiter: RateLimiter;
  /** Server-side only. Never shown to the instructor. */
  log: (message: string, detail?: unknown) => void;
}

export interface HandlerResult {
  status: number;
  body: AssistantResponse;
}

const refuse = (status: number, error: string): HandlerResult => ({ status, body: { ok: false, error } });

function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

function wait(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** What the model returned, as something the browser can draw. */
function toReply(result: ModelResult, log: HandlerDeps["log"]): AssistantReply {
  const said = result.text.trim();
  const call = result.toolCalls[0];
  if (!call && result.truncated) {
    log("assistant: answer cut off at the output limit before any draft", { said: said.length });
    return {
      kind: "message",
      text: "That was too much to work out in one go, so nothing was prepared. Try asking for part of it at a time.",
    };
  }
  if (!call) {
    return { kind: "message", text: said || "I don't have an answer for that. Could you put it another way?" };
  }
  if (result.truncated) {
    log("assistant: draft cut off at the output limit", { name: call.name });
    return {
      kind: "message",
      text: "That list was too long for me to rewrite in one go, so nothing was prepared. Try sending half of it at a time.",
    };
  }
  const parsed = parseToolCall(call.name, call.input);
  if (!parsed.ok) {
    log("assistant: unreadable tool call", { name: call.name, error: parsed.error });
    return {
      kind: "message",
      text:
        `I drafted a change but could not read it back (${parsed.error}), so nothing was prepared. ` +
        "Try asking again, a step at a time.",
    };
  }
  return { kind: "proposal", text: said || parsed.proposal.summary, proposal: parsed.proposal };
}

function providerFailure(e: unknown, log: HandlerDeps["log"]): HandlerResult {
  log("assistant: model call failed", e);
  if (e instanceof ModelError && e.kind === "auth") {
    return refuse(503, "The assistant's AI key was refused. Whoever runs this site needs to replace it.");
  }
  if (e instanceof ModelError && e.kind === "busy") {
    return refuse(503, "The assistant is busy right now. Try again in a minute.");
  }
  return refuse(502, "The assistant could not answer just now. Try again.");
}

export async function handleAssistant(
  req: { authorization: string | null; body: unknown },
  deps: HandlerDeps,
): Promise<HandlerResult> {
  if (!deps.model) return refuse(503, "The assistant is not switched on for this site yet.");

  const token = bearer(req.authorization);
  if (!token) return refuse(401, "Sign in to use the assistant.");

  const parsed = parseRequest(req.body);
  if (!parsed.ok) return refuse(400, `That request could not be read: ${parsed.error}.`);
  const { request } = parsed;

  let who: Verified;
  try {
    who = await deps.verify(token, request.courseId);
  } catch (e) {
    deps.log("assistant: sign-in check failed", e);
    return refuse(502, "Your sign-in could not be checked just now. Try again.");
  }
  if (!who.ok) return refuse(who.status, who.error);
  if (!deps.allowed(who.email)) {
    return refuse(403, "The assistant is not switched on for your account. Ask whoever runs this site to add you.");
  }

  const taken = deps.limiter.take(who.userId);
  if (!taken.ok) {
    return refuse(429, `That is a lot of requests in a short time. Try again in ${wait(taken.retryAfterSec)}.`);
  }

  let result: ModelResult;
  try {
    result = await deps.model({
      system: systemPrompt(request.snapshot, request.attachment),
      turns: conversation(request.history, request.message),
      tools: toolsFor(Boolean(request.attachment)),
    });
  } catch (e) {
    return providerFailure(e, deps.log);
  }
  return { status: 200, body: { ok: true, reply: toReply(result, deps.log) } };
}
