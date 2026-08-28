"use client";

import { useEffect } from "react";

/**
 * The real app is Collage-Team, at /ck. This is the doormat.
 *
 * The query string and the FRAGMENT come along, and carrying the fragment is
 * the entire reason this is not a one-line redirect. A password-reset link
 * lands on whatever the Supabase project has as its Site URL — the bare origin,
 * unless the redirect this app asks for is in the URL allow-list — and the
 * token that proves whose password it is rides in the fragment. Dropping it
 * here meant the link signed the browser in and went straight to the app, with
 * no way to set a password and nothing on screen to say why. From the outside
 * that is exactly "the forgot password thing doesn't work".
 *
 * A full-page replace rather than router.replace, because the fragment has to
 * be on window.location by the time /ck's chunk evaluates: that is when the
 * Supabase client is constructed, and detectSessionInUrl reads the URL there
 * and nowhere else. A soft navigation updates history around the render and is
 * not a promise about that ordering. There is no client state on this page to
 * lose, so the only cost is the load /ck was about to do anyway.
 */
export default function Home() {
  useEffect(() => {
    window.location.replace("/ck" + window.location.search + window.location.hash);
  }, []);
  return null;
}
