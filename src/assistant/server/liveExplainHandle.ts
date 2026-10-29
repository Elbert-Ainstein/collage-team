// The "Generate explanation" route, with everything that touches the network
// passed in.
//
// Same gates as the import (liveImportHandle.ts), in the same cheapest-first
// order, for the same reason: the model call costs money, so every gate that
// can refuse runs before it. The caller must own the activity's course — the
// rule that lets her save the explanation (0051, beside live_keys), checked as
// her through Supabase — so nobody is handed a draft they could not keep.

import type { ExplainQuestion, LiveExplainRequest, LiveExplainResponse } from "../liveExplain";
import { bearer, wait, type Verified } from "./handle";
import { describeQuestion, LIVE_EXPLAIN_PROMPT, parseExplainQuestion, parseExplanation, WRITE_EXPLANATION } from "./liveExplain";
import { ModelError, type Model, type ModelResult } from "./model";
import type { RateLimiter } from "./rateLimit";

export interface LiveExplainDeps {
  /** Null when no provider key is configured — explanations are then off. */
  model: Model | null;
  /** Does this sign-in own the activity's course? */
  verify: (token: string, activityId: string) => Promise<Verified>;
  /** Whether this account may spend the key at all — see allowList.ts. */
  allowed: (email: string | null) => boolean;
  limiter: RateLimiter;
  /** Server-side only. Never shown to the instructor. */
  log: (message: string, detail?: unknown) => void;
}

export interface LiveExplainResult {
  status: number;
  body: LiveExplainResponse;
}

const refuse = (status: number, error: string): LiveExplainResult => ({ status, body: { ok: false, error } });

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseLiveExplainRequest(
  body: unknown,
): { ok: true; request: LiveExplainRequest } | { ok: false; error: string } {
  if (!isObj(body)) return { ok: false, error: "it is not an object" };
  const { activityId, question } = body;
  if (typeof activityId !== "string" || !ID_RE.test(activityId)) return { ok: false, error: "no activity" };
  const parsed = parseExplainQuestion(question);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, request: { activityId, question: parsed.value } };
}

function providerFailure(e: unknown, log: LiveExplainDeps["log"]): LiveExplainResult {
  log("live-explain: model call failed", e);
  if (e instanceof ModelError && e.kind === "auth") {
    return refuse(503, "The assistant's AI key was refused. Whoever runs this site needs to replace it.");
  }
  if (e instanceof ModelError && e.kind === "busy") {
    return refuse(503, "The assistant is busy right now. Try again in a minute.");
  }
  return refuse(502, "No explanation came back just now. Try again.");
}

/** What the model returned, as an explanation or a sentence saying why there is none. */
function toExplanation(result: ModelResult, log: LiveExplainDeps["log"]): LiveExplainResult {
  const call = result.toolCalls.find((c) => c.name === WRITE_EXPLANATION.name);
  if (result.truncated || !call) {
    log("live-explain: no whole explanation in the answer", {
      truncated: Boolean(result.truncated),
      calls: result.toolCalls.map((c) => c.name),
    });
    return refuse(502, "No explanation came back just now. Try again.");
  }
  const parsed = parseExplanation(call.input);
  if (!parsed.ok) {
    log("live-explain: unreadable explanation", { error: parsed.error });
    return refuse(502, "No explanation came back just now. Try again.");
  }
  return { status: 200, body: { ok: true, explanation: parsed.value } };
}

async function gate(token: string, activityId: string, deps: LiveExplainDeps): Promise<LiveExplainResult | null> {
  let who: Verified;
  try {
    who = await deps.verify(token, activityId);
  } catch (e) {
    deps.log("live-explain: sign-in check failed", e);
    return refuse(502, "Your sign-in could not be checked just now. Try again.");
  }
  if (!who.ok) {
    return refuse(who.status, who.status === 403 ? "Only this course's instructor can write explanations." : who.error);
  }
  if (!deps.allowed(who.email)) {
    return refuse(403, "AI explanations are not switched on for your account. Ask whoever runs this site to add you.");
  }
  const taken = deps.limiter.take(who.userId);
  if (!taken.ok) {
    return refuse(429, `That is a lot of explanations in a short time. Try again in ${wait(taken.retryAfterSec)}.`);
  }
  return null;
}

async function ask(model: Model, question: ExplainQuestion, log: LiveExplainDeps["log"]): Promise<LiveExplainResult> {
  let result: ModelResult;
  try {
    result = await model({
      system: LIVE_EXPLAIN_PROMPT,
      turns: [{ role: "user", text: describeQuestion(question) }],
      tools: [WRITE_EXPLANATION],
      requireTool: true,
    });
  } catch (e) {
    return providerFailure(e, log);
  }
  return toExplanation(result, log);
}

export async function handleLiveExplain(
  req: { authorization: string | null; body: unknown },
  deps: LiveExplainDeps,
): Promise<LiveExplainResult> {
  if (!deps.model) return refuse(503, "AI explanations are not switched on for this site yet.");

  const token = bearer(req.authorization);
  if (!token) return refuse(401, "Sign in to write explanations.");

  const parsed = parseLiveExplainRequest(req.body);
  if (!parsed.ok) return refuse(400, `That request could not be read: ${parsed.error}.`);

  const refused = await gate(token, parsed.request.activityId, deps);
  if (refused) return refused;

  return ask(deps.model, parsed.request.question, deps.log);
}
