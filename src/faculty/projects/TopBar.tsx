"use client";

import type { ReactNode } from "react";
import { FIcon } from "../icons";

/** The back button and title every level below the list has. */
export function TopBar({
  onBack,
  label,
  title,
  sub,
  children,
}: {
  onBack: () => void;
  label: string;
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="fv-topbar pj-topbar">
      <button type="button" className="fv-back" aria-label={label} title={label} onClick={onBack}>
        <FIcon name="chevronLeft" size={18} />
      </button>
      <div className="pj-titles">
        <h1 className="fv-h1 pj-h1">{title}</h1>
        {sub ? <div className="fv-sub pj-sub">{sub}</div> : null}
      </div>
      {children ? <div className="pj-topacts">{children}</div> : null}
    </div>
  );
}
