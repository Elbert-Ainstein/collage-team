"use client";

// "+ Activity" on the Activities screen: an ordinary activity, or live
// questions. Closes on a pick, a click elsewhere, or Escape.

import { useEffect, useRef, useState } from "react";
import { Ic } from "@/live/ui";

export type NewKind = "activity" | "live";

interface Props {
  disabled: boolean;
  title?: string;
  onPick: (kind: NewKind) => void;
}

export function AddActivityMenu({ disabled, title, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (kind: NewKind) => {
    setOpen(false);
    onPick(kind);
  };

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        type="button"
        className="fv-btn primary sm"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Ic name="add" size={15} />
        Activity
      </button>
      {open ? (
        <div className="lq-fac lq-newmenu" role="menu">
          <button type="button" role="menuitem" className="lq-newitem" onClick={() => pick("activity")}>
            <span className="lq-newicon">
              <Ic name="assignment" size={18} />
            </span>
            <span>
              <b>Activity</b>
              <span className="fv-sub">Work they hand in</span>
            </span>
          </button>
          <button type="button" role="menuitem" className="lq-newitem" onClick={() => pick("live")}>
            <span className="lq-newicon team">
              <Ic name="groups" size={18} />
            </span>
            <span>
              <b>Live questions</b>
              <span className="fv-sub">On their own before class, then as teams in class</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
