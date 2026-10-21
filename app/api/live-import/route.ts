// POST /api/live-import — draft a live-questions activity from a PDF.
//
// The browser has already uploaded the PDF to the private "imports" bucket
// (src/faculty/live/importClient.ts); this reads the path, checks who is
// asking, fetches the PDF as them, and asks the model for a draft. It writes
// nothing: the draft goes back to the builder, where the instructor edits it
// and saves it herself. See src/assistant/server/liveImportHandle.ts for the
// gates and src/assistant/liveDraft.ts for what comes back.

import { allowListFrom } from "@/assistant/server/allowList";
import { anthropicModel } from "@/assistant/server/anthropic";
import { geminiModel } from "@/assistant/server/gemini";
import { supabaseDownloader } from "@/assistant/server/importDownload";
import { handleLiveImport, type LiveImportDeps } from "@/assistant/server/liveImportHandle";
import { chooseProvider } from "@/assistant/server/provider";
import { createRateLimiter } from "@/assistant/server/rateLimit";
import { supabaseVerifier } from "@/assistant/server/verify";

export const runtime = "nodejs";
// A long PDF read whole can take the model a minute or more, and the provider
// call is allowed one retry (see gemini.ts and anthropic.ts).
export const maxDuration = 300;

/** Three ids and a path. Anything bigger is not this request. */
const MAX_BODY_BYTES = 4_000;

// Module scope, so the window survives between requests on a warm instance.
// Tighter than the assistant's: each import sends a whole PDF to the model.
const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000 });

let deps: LiveImportDeps | null = null;

function getDeps(): LiveImportDeps {
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
    verify: supabaseVerifier(url, anonKey),
    allowed: allowList.may,
    limiter,
    download: supabaseDownloader(url, anonKey),
    log: (message, detail) => console.error(message, detail ?? ""),
  };
  return deps;
}

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request): Promise<Response> {
  // Nobody without a sign-in gets as far as having their body read.
  const authorization = req.headers.get("authorization");
  if (!authorization) return fail(401, "Sign in to import questions.");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return fail(413, "That request could not be read.");

  let body: unknown;
  try {
    // Measured as read, not only as declared: a chunked body has no length header.
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, "That request could not be read.");
    body = JSON.parse(raw);
  } catch {
    return fail(400, "That request could not be read.");
  }

  try {
    const out = await handleLiveImport({ authorization, body }, getDeps());
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    console.error("live-import: unhandled failure", e);
    return fail(500, "The import ran into a problem. Try again.");
  }
}
