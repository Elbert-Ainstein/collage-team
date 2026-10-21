// The live-questions PDF import route, with everything that touches the
// network passed in.
//
// Same plumbing as the assistant (handle.ts), in the same cheapest-first
// order, and for the same reason: the model call is the step that costs money,
// so every gate that can refuse runs before it. The PDF is not in the request —
// a request body is capped near 4.5 MB on the host — so the browser uploads it
// to the private "imports" bucket first and sends its path, and the download
// here is made with HER sign-in, through the bucket's owner-only policies. The
// route holds no key that could read past them.

import {
  MAX_IMPORT_BYTES,
  isImportPath,
  type LiveImportRequest,
  type LiveImportResponse,
} from "../liveDraft";
import { bearer, wait, type Verified } from "./handle";
import { DRAFT_QUESTIONS, LIVE_IMPORT_PROMPT, parseDraftQuestions } from "./liveImport";
import { ModelError, type Model, type ModelResult } from "./model";
import type { RateLimiter } from "./rateLimit";

/** What fetching the PDF came to. `missing` is "no such object, or not hers" — storage does not say which. */
export type Downloaded = { ok: true; file: Blob } | { ok: false; missing: boolean; message: string };

export interface LiveImportDeps {
  /** Null when no provider key is configured — the import is then off. */
  model: Model | null;
  verify: (token: string, courseId: string) => Promise<Verified>;
  /** Whether this account may spend the key at all — see allowList.ts. */
  allowed: (email: string | null) => boolean;
  limiter: RateLimiter;
  /** Fetch an object from the "imports" bucket as the person whose token this is. */
  download: (token: string, path: string) => Promise<Downloaded>;
  /** Server-side only. Never shown to the instructor. */
  log: (message: string, detail?: unknown) => void;
}

export interface LiveImportResult {
  status: number;
  body: LiveImportResponse;
}

const refuse = (status: number, error: string): LiveImportResult => ({ status, body: { ok: false, error } });

const MB = Math.round(MAX_IMPORT_BYTES / (1024 * 1024));
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseLiveImportRequest(body: unknown): { ok: true; request: LiveImportRequest } | { ok: false; error: string } {
  if (!isObj(body)) return { ok: false, error: "it is not an object" };
  const { courseId, activityId, path } = body;
  if (typeof courseId !== "string" || !ID_RE.test(courseId)) return { ok: false, error: "no course" };
  if (typeof activityId !== "string" || !ID_RE.test(activityId)) return { ok: false, error: "no activity" };
  // Only a path made for THIS course and activity is fetched: the course is
  // the one the sign-in check below is about, and nothing else in the bucket
  // is this request's business.
  if (typeof path !== "string" || !isImportPath(path, courseId, activityId)) return { ok: false, error: "no PDF" };
  return { ok: true, request: { courseId, activityId, path } };
}

/**
 * A PDF says so in its first bytes ("%PDF-"), and the spec lets that sit
 * anywhere in the first 1024. Checked here rather than trusting the stored
 * content type, which is whatever the uploader claimed.
 */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function looksLikePdf(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 1024) - PDF_MAGIC.length;
  for (let i = 0; i <= end; i++) {
    if (PDF_MAGIC.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

function providerFailure(e: unknown, log: LiveImportDeps["log"]): LiveImportResult {
  log("live-import: model call failed", e);
  if (e instanceof ModelError && e.kind === "auth") {
    return refuse(503, "The assistant's AI key was refused. Whoever runs this site needs to replace it.");
  }
  if (e instanceof ModelError && e.kind === "busy") {
    return refuse(503, "The assistant is busy right now. Try again in a minute.");
  }
  return refuse(502, "The assistant could not read that PDF just now. Try again.");
}

/** What the model returned, as a draft or a sentence saying why there is none. */
function toDraft(result: ModelResult, log: LiveImportDeps["log"]): LiveImportResult {
  const call = result.toolCalls.find((c) => c.name === DRAFT_QUESTIONS.name);
  // Cut off at the output limit: a draft missing its last questions must not
  // be offered as the whole PDF.
  if (result.truncated) {
    log("live-import: answer cut off at the output limit", { drafted: Boolean(call) });
    return refuse(422, "That PDF has too many questions to draft at once. Split it and import each part.");
  }
  if (!call) {
    log("live-import: no draft in the answer", { said: result.text.length, calls: result.toolCalls.map((c) => c.name) });
    return refuse(422, "No questions were found in that PDF.");
  }
  const parsed = parseDraftQuestions(call.input);
  if (!parsed.ok) {
    log("live-import: unreadable draft", { error: parsed.error });
    return refuse(502, `The draft could not be read back (${parsed.error}). Try again.`);
  }
  return { status: 200, body: { ok: true, draft: parsed.draft } };
}

export async function handleLiveImport(
  req: { authorization: string | null; body: unknown },
  deps: LiveImportDeps,
): Promise<LiveImportResult> {
  if (!deps.model) return refuse(503, "PDF import is not switched on for this site yet.");

  const token = bearer(req.authorization);
  if (!token) return refuse(401, "Sign in to import questions.");

  const parsed = parseLiveImportRequest(req.body);
  if (!parsed.ok) return refuse(400, `That request could not be read: ${parsed.error}.`);
  const { request } = parsed;

  let who: Verified;
  try {
    who = await deps.verify(token, request.courseId);
  } catch (e) {
    deps.log("live-import: sign-in check failed", e);
    return refuse(502, "Your sign-in could not be checked just now. Try again.");
  }
  if (!who.ok) {
    // The verifier's own 403 explains the TEAMS assistant; this is the import.
    return refuse(who.status, who.status === 403 ? "Only this course's instructor can import questions." : who.error);
  }
  if (!deps.allowed(who.email)) {
    return refuse(403, "PDF import is not switched on for your account. Ask whoever runs this site to add you.");
  }

  const taken = deps.limiter.take(who.userId);
  if (!taken.ok) {
    return refuse(429, `That is a lot of imports in a short time. Try again in ${wait(taken.retryAfterSec)}.`);
  }

  let got: Downloaded;
  try {
    got = await deps.download(token, request.path);
  } catch (e) {
    got = { ok: false, missing: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!got.ok) {
    deps.log("live-import: download failed", { path: request.path, message: got.message });
    return got.missing
      ? refuse(404, "That PDF could not be found. Upload it again.")
      : refuse(502, "That PDF could not be fetched just now. Try again.");
  }
  // Size first, from the blob, so an oversized file is never read into memory.
  if (got.file.size > MAX_IMPORT_BYTES) return refuse(413, `That PDF is over ${MB} MB. Split it and import each part.`);
  const bytes = new Uint8Array(await got.file.arrayBuffer());
  if (!looksLikePdf(bytes)) return refuse(415, "That file is not a PDF.");

  let result: ModelResult;
  try {
    result = await deps.model({
      system: LIVE_IMPORT_PROMPT,
      turns: [
        {
          role: "user",
          text: "Draft every question in this PDF.",
          file: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") },
        },
      ],
      tools: [DRAFT_QUESTIONS],
      requireTool: true,
    });
  } catch (e) {
    return providerFailure(e, deps.log);
  }
  return toDraft(result, deps.log);
}
