import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/global.css";
import "./components/components.css";
import { App } from "./app/App";

// Dev/demo reset: visiting with ?reset clears persisted state back to the §9 seed.
if (new URLSearchParams(window.location.search).has("reset")) {
  window.localStorage.removeItem("collage-team-module");
  window.history.replaceState({}, "", window.location.pathname);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
