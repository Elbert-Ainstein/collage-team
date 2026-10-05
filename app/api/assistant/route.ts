// POST /api/assistant — the faculty assistant's one server endpoint.
//
// The only server code in the app, and it exists for one reason: the model key
// cannot live in the browser. It reads the request, checks who sent it, asks
// the model, and hands back a reply or a proposal. It writes nothing; see
// src/assistant/types.ts for why that is the design and not a shortcut.

import { allowListFrom } from "@/assistant/server/allowList";
import { anthropicModel } from "@/assistant/server/anthropic";
import { handleAssistant, type HandlerDeps } from "@/assistant/server/handle";
import { createRateLimiter } from "@/assistant/server/rateLimit";
import { supabaseVerifier } from "@/assistant/server/verify";

export const runtime = "nodejs";
// A whole class list rewritten as rows can take the model a minute or more,
// and the provider call is allowed one retry (see anthropic.ts).
export const maxDuration = 300;

/** A 500-student list with a long conversation is well under this. */
const MAX_BODY_BYTES = 1_000_000;

/** Sonnet: careful with names, quick enough for a list. ASSISTANT_MODEL overrides it. */
const DEFAULT_MODEL = "claude-sonnet-5-5";

// Module scope, so the window survives between requests on a warm instance.
const limiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000 });

let deps: HandlerDeps | null = null;

function getDeps(): HandlerDeps {
  if (deps) return deps;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured on the server.");
  const allowList = allowListFrom(process.env.ASSISTANT_ALLOWED_EMAILS, process.env.NODE_ENV);
  deps = {
    // Off without a key, and off in production without a list of who may use it.
    model:
      apiKey && allowList.on
        ? anthropicModel({ apiKey, model: process.env.ASSISTANT_MODEL || DEFAULT_MODEL })
        : null,
    verify: supabaseVerifier(url, anonKey),
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
  if (!authorization) return fail(401, "Sign in to use the assistant.");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return fail(413, "That is too much to send at once. Try a shorter list.");

  let body: unknown;
  try {
    // Measured as read, not only as declared: a chunked body has no length header.
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, "That is too much to send at once. Try a shorter list.");
    body = JSON.parse(raw);
  } catch {
    return fail(400, "That request could not be read.");
  }

  try {
    const out = await handleAssistant({ authorization, body }, getDeps());
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    console.error("assistant: unhandled failure", e);
    return fail(500, "The assistant ran into a problem. Try again.");
  }
}
