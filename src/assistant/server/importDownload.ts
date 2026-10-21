// Fetching an imported PDF from the private "imports" bucket, as the person
// who uploaded it.
//
// Same rule as verify.ts: the client is made with her token, so the download
// goes through the bucket's owner-only policies (0047) exactly as it would
// from her browser. There is no service-role key in this app, and the import
// does not need one — a PDF she cannot read is one this route cannot read.

import { createClient } from "@supabase/supabase-js";
import type { Downloaded } from "./liveImportHandle";

export function supabaseDownloader(url: string, anonKey: string) {
  return async (token: string, path: string): Promise<Downloaded> => {
    const sb = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await sb.storage.from("imports").download(path);
    if (error || !data) {
      const message = error?.message ?? "no file came back";
      // Storage answers "not found" both for an object that is not there and
      // for one the policies hide — which, for this route, is the same thing.
      const status = error?.status;
      return { ok: false, missing: status === 400 || status === 404 || /not found/i.test(message), message };
    }
    return { ok: true, file: data };
  };
}
