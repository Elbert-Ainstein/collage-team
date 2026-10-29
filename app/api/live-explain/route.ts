// POST /api/live-explain — write a question's explanation for the builder.
//
// The browser sends the question as the instructor has it, key included
// (src/faculty/live/explainClient.ts); this checks who is asking and asks the
// model for a short explanation. It writes nothing: the text goes into her
// textbox, and she saves it with the questions. See
// src/assistant/server/liveExplainHandle.ts for the gates.

import { allowListFrom } from "@/assistant/server/allowList";
import { anthropicModel } from "@/assistant/server/anthropic";
import { geminiModel } from "@/assistant/server/gemini";
import { handleLiveExplain, type LiveExplainDeps } from "@/assistant/server/liveExplainHandle";
import { chooseProvider } from "@/assistant/server/provider";
import { createRateLimiter } from "@/assistant/server/rateLimit";
import { supabaseActivityVerifier } from "@/assistant/server/verify";

export const runtime = "nodejs";
// One short answer, but the provider call is allowed one retry (gemini.ts, anthropic.ts).
export const maxDuration = 120;

/** One question at its longest (a 4,000-character stem, eight long options), escaped. */
const MAX_BODY_BYTES = 40_000;

// Module scope, so the window survives between requests on a warm instance.
// Roomier than the import's — one question each — but a brake on a stuck loop.
const limiter = createRateLimiter({ limit: 40, windowMs: 10 * 60_000 });

let deps: LiveExplainDeps | null = null;

function getDeps(): LiveExplainDeps {
  if (deps) return deps;
  const choice = chooseProvider(process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured on the server.");
  const allowList = allowListFrom(process.env.ASSISTANT_ALLOWED_EMAILS, process.env.NODE_ENV);
  deps = {
    // Off without a key, and off in production without a list of who may use it.
    model:
      choice && allowList.on
        ? choice.provider === "gemini"
          ? geminiModel({ apiKey: choice.apiKey, model: choice.model })
          : anthropicModel({ apiKey: choice.apiKey, model: choice.model })
        : null,
    verify: supabaseActivityVerifier(url, anonKey),
    allowed: allowList.may,
    limiter,
    log: (message, detail) => console.error(message, detail ?? ""),
  };
  return deps;
}

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request): Promise<Response> {
  // Nobody without a sign-in gets as far as having their body read.
  const authorization = req.headers.get("authorization");
  if (!authorization) return fail(401, "Sign in to write explanations.");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return fail(413, "That question is too long to explain.");

  let body: unknown;
  try {
    // Measured as read, not only as declared: a chunked body has no length header.
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, "That question is too long to explain.");
    body = JSON.parse(raw);
  } catch {
    return fail(400, "That request could not be read.");
  }

  try {
    const out = await handleLiveExplain({ authorization, body }, getDeps());
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    console.error("live-explain: unhandled failure", e);
    return fail(500, "The explanation ran into a problem. Try again.");
  }
}
