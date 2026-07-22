import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/global.css";
import "./components/components.css";
import { App } from "./app/App";
import { useStore } from "./store";

// Dev affordance: expose the store for debugging + demoing the INDIVIDUAL variant
// (spec §9: "demo the INDIVIDUAL variant via a prop/toggle"). Not shipped in prod.
if (import.meta.env.DEV) {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}

// Dev/demo reset: visiting with ?reset clears persisted state back to the §9 seed.
// Clear storage AND reset the already-hydrated store (imports evaluate before this
// body, so the store may have hydrated from localStorage first).
if (new URLSearchParams(window.location.search).has("reset")) {
  window.localStorage.removeItem("collage-team-module");
  useStore.getState().reset();
  window.history.replaceState({}, "", window.location.pathname);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
