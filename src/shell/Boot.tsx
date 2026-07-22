"use client";

import { useEffect } from "react";
import { useStore } from "@/store";

// Client-side boot tasks that used to live in the Vite entry (main.tsx):
//  • ?reset — clear persisted state back to the §9 seed
//  • dev-only store exposure for debugging + demoing the INDIVIDUAL variant
export function Boot() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("reset")) {
      // ?reset → populated "grading day" seed; ?reset=fresh → pre-prep seed.
      const fresh = params.get("reset") === "fresh";
      window.localStorage.removeItem("collage-team-module");
      useStore.getState().reset(fresh);
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      // Load persisted state after mount (store uses skipHydration to avoid a
      // server/client hydration mismatch on the first render).
      void useStore.persist.rehydrate();
    }
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __store: typeof useStore }).__store = useStore;
    }
  }, []);
  return null;
}
