"use client";

// Long writing, a few lines at a time. The comments grid holds a dozen
// answers per team; one student's three paragraphs shouldn't make every row
// of it a screen tall. Shows More only when there's more.

import { useLayoutEffect, useRef, useState } from "react";

export function Clamp({ text, lines, className }: { text: string; lines: number; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    // The column can change width (the window, the sidebar), and with it how
    // many lines the text takes.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open, lines]);

  return (
    <>
      <p
        ref={ref}
        className={`${className ?? ""} te-clamp${open ? " open" : ""}`}
        style={open ? undefined : { WebkitLineClamp: lines }}
      >
        {text}
      </p>
      {over ? (
        <button type="button" className="te-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </>
  );
}
