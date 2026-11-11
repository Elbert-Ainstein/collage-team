"use client";

import { useState } from "react";
import { useNewerBuild } from "./useNewerBuild";

interface Props {
  /** For tests: this page's build, and how to ask the server for its own. */
  mine?: string;
  fetchBuild?: () => Promise<string | null>;
  reload?: () => void;
}

/**
 * Says so when a newer Collage is out than this tab is running, and offers the
 * reload. It doesn't reload on its own: an instructor may have a draft open
 * that isn't saved. A student lands back where they were (StudentApp keeps it).
 */
export function UpdateBar({ mine, fetchBuild, reload = () => window.location.reload() }: Props) {
  const newer = useNewerBuild({ mine, fetchBuild });
  const [putOff, setPutOff] = useState(false);
  if (!newer || putOff) return null;
  return (
    <div className="ct-update" role="status">
      <span>Collage has been updated</span>
      <button type="button" className="ct-update-go" onClick={reload}>
        Reload
      </button>
      <button type="button" className="ct-update-x" aria-label="Not now" onClick={() => setPutOff(true)}>
        ×
      </button>
    </div>
  );
}
