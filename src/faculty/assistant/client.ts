// Asking the assistant from the browser.
//
// The instructor's own Supabase session goes with the request: it is how the
// route knows who is asking, and that this course is hers. Nothing else about
// her account leaves the page.

import type { AssistantReply, AssistantRequest, AssistantResponse } from "@/assistant/types";
import { requireSupabase } from "@/lib/supabaseClient";

export async function askAssistant(req: AssistantRequest, signal?: AbortSignal): Promise<AssistantReply> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your sign-in has expired. Reload the page and sign in again.");

  let res: Response;
  try {
    res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error("The assistant could not be reached. Check your connection and try again.");
  }

  let body: AssistantResponse | null = null;
  try {
    body = (await res.json()) as AssistantResponse;
  } catch {
    // A host timeout or crash page is HTML, not the route's JSON.
  }
  if (!body) {
    throw new Error(
      res.status === 504
        ? "The assistant took too long to answer. Try a shorter list, or ask again."
        : "The assistant sent back something unreadable. Try again.",
    );
  }
  if (!body.ok) throw new Error(body.error);
  return body.reply;
}
