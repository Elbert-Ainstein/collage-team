"use client";

import { useEffect, useState } from "react";
import { BUILD_ID, fetchServerBuild, isNewerBuild } from "./newerBuild";

/** However often the tab comes back, the server is asked at most this often. */
export const MIN_GAP_MS = 60_000;
/** And asked this often while the tab stays open in front of someone. */
export const CHECK_EVERY_MS = 30 * 60_000;

interface Options {
  /** This page's build; the one baked in unless a test says otherwise. */
  mine?: string;
  fetchBuild?: () => Promise<string | null>;
}

/**
 * True once the server is on a newer build than this page. Asked when the tab
 * comes back into view (the stale tab is the one left open for days and
 * returned to), and every so often while it stays there — never on load,
 * which is the newest build by definition. Once true, it stays true.
 */
export function useNewerBuild({ mine = BUILD_ID, fetchBuild = fetchServerBuild }: Options = {}): boolean {
  const [newer, setNewer] = useState(false);

  useEffect(() => {
    if (mine === "dev") return;
    let alive = true;
    let found = false;
    let lastAsked = Date.now();

    const check = async () => {
      if (found || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastAsked < MIN_GAP_MS) return;
      lastAsked = now;
      const server = await fetchBuild();
      if (alive && isNewerBuild(mine, server)) {
        found = true;
        setNewer(true);
      }
    };
    const onBack = () => void check();

    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    window.addEventListener("online", onBack);
    // A page restored from the back-forward cache is the old one, whatever the server says.
    window.addEventListener("pageshow", onBack);
    const timer = window.setInterval(onBack, CHECK_EVERY_MS);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("online", onBack);
      window.removeEventListener("pageshow", onBack);
      window.clearInterval(timer);
    };
  }, [mine, fetchBuild]);

  return newer;
}
