// Who is asking, checked against Supabase with their own sign-in.
//
// The token the browser sends is the instructor's session, so the course row
// is read AS her, through the same row-level security as everything else. The
// server holds no key that could read past that — there is no service-role key
// anywhere in this app, and the assistant does not need one.
//
// Owner only — and owning is necessary, not sufficient: any account can make a
// course (0028), so allowList.ts decides who may spend the key at all. Owner,
// because every change the assistant can draft is a roster write, and
// roster writes are the owner's alone in RLS (Capabilities.manageRoster). A TF
// let in here could draft and preview a change that would then fail on Apply,
// which is the "control that always fails" the faculty app avoids everywhere.

import { createClient } from "@supabase/supabase-js";
import type { Verified } from "./handle";

export function supabaseVerifier(url: string, anonKey: string) {
  return async (token: string, courseId: string): Promise<Verified> => {
    const sb = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth.user) {
      return {
        ok: false,
        status: 401,
        error: "Your sign-in has expired. Reload the page and sign in again.",
      };
    }

    const { data: course, error } = await sb
      .from("courses")
      .select("id, owner_id")
      .eq("id", courseId)
      .maybeSingle();
    if (error) throw new Error(`reading the course failed: ${error.message}`);
    if (!course || course.owner_id !== auth.user.id) {
      return {
        ok: false,
        status: 403,
        error:
          "Only this course's instructor can use the assistant. It drafts changes to the teams, " +
          "and teams are the instructor's to change.",
      };
    }
    return { ok: true, userId: auth.user.id, email: auth.user.email ?? null };
  };
}

/**
 * The same check for an activity, for the explanation route: does this
 * sign-in own the course the activity is on? Asked through owns_activity
 * (0044), the rule that lets her save an explanation (0051) — so nobody is
 * handed a draft they could not keep. A TF gets a 403, as with the import.
 */
export function supabaseActivityVerifier(url: string, anonKey: string) {
  return async (token: string, activityId: string): Promise<Verified> => {
    const sb = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth.user) {
      return { ok: false, status: 401, error: "Your sign-in has expired. Reload the page and sign in again." };
    }

    const { data: owns, error } = await sb.rpc("owns_activity", { aid: activityId });
    if (error) throw new Error(`checking the activity failed: ${error.message}`);
    if (owns !== true) {
      return { ok: false, status: 403, error: "Only this course's instructor can write explanations." };
    }
    return { ok: true, userId: auth.user.id, email: auth.user.email ?? null };
  };
}
