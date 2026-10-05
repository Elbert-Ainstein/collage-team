"use client";

// The way in to the assistant: one button, in the same corner of every screen.
//
// Not a sidebar item. The sidebar is navigation — every other row in it is a
// page you go to — and the assistant is not a page, it is a panel that opens
// beside whichever one you are on. Styled as a row it read as a destination,
// and on the rail it was one more unlabelled glyph. It was also simply absent
// on the activity page, the rubric and grading, which replace the sidebar with
// a gutter. The bottom-right corner is the one place on screen in every view,
// and where people already look for a helper.
//
// Labelled, not an icon: a sparkle on its own is exactly what went unnoticed.

import { forwardRef } from "react";
import { FIcon } from "../icons";

interface AssistantLauncherProps {
  onOpen: () => void;
}

export const AssistantLauncher = forwardRef<HTMLButtonElement, AssistantLauncherProps>(
  function AssistantLauncher({ onOpen }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="fv-as-launch"
        onClick={onOpen}
        title="Ask the assistant to change teams, or paste a class list"
      >
        <FIcon name="sparkle" size={17} />
        <span>Assistant</span>
      </button>
    );
  },
);
