"use client";

import { useEffect } from "react";
import { useStore } from "@/store";

// Client-side boot tasks that used to live in the Vite entry (main.tsx):
//  • ?reset — clear persisted state back to the §9 seed
//  • dev-only store exposure for debugging + demoing the INDIVIDUAL variant
export function Boot() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("reset")) {
      window.localStorage.removeItem("collage-team-module");
      useStore.getState().reset();
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __store: typeof useStore }).__store = useStore;
    }
  }, []);
  return null;
}
