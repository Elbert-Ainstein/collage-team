"use client";

// Opening an image the way Google Drive opens a file: the page dims to black,
// the image sits in the middle, the name and the way out are along the top,
// and the arrows step through the rest of the set without closing.
//
// Shared by the grader and the student, so it carries its own icons and its
// own stylesheet rather than borrowing either app's.
//
// Keyboard: Esc closes, ←/→ step, + / − zoom, 0 fits the image back to the screen.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./imageViewer.css";

export interface ViewerImage {
  id: string;
  url: string | null;
  name: string;
}

interface ImageViewerProps {
  images: ViewerImage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Saves the file under its own name. Absent hides the button. */
  onDownload?: (index: number) => Promise<void>;
}

const ZOOMS = [1, 1.5, 2, 3, 4] as const;

const ICONS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18.5 13.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h5.5"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8 11h6"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8.5 8.5"/>',
} as const;

function Icon({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export function ImageViewer({ images, index, onIndex, onClose, onDownload }: ImageViewerProps) {
  const count = images.length;
  const current = images[Math.min(Math.max(index, 0), count - 1)];
  const [zoom, setZoom] = useState(0);
  const [saving, setSaving] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  const step = useCallback(
    (by: number) => {
      if (count < 2) return;
      onIndex((index + by + count) % count);
    },
    [count, index, onIndex],
  );
  const zoomBy = useCallback(
    (by: number) => setZoom((z) => Math.min(Math.max(z + by, 0), ZOOMS.length - 1)),
    [],
  );

  // Each image opens fitted to the screen, whatever the last one was zoomed to.
  useEffect(() => setZoom(0), [index]);

  // Zooming keeps the middle of the image in the middle of the screen.
  useEffect(() => {
    const el = stage.current;
    if (!el || zoom === 0) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [zoom]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "+" || e.key === "=") zoomBy(1);
      else if (e.key === "-" || e.key === "_") zoomBy(-1);
      else if (e.key === "0") setZoom(0);
      else return;
      // Captured and stopped: the grading screen behind steps questions on
      // ←/→, and those keys belong to the viewer while it is open.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, step, zoomBy]);

  if (!current) return null;

  async function download() {
    if (!onDownload || saving) return;
    setSaving(true);
    try {
      await onDownload(index);
    } finally {
      setSaving(false);
    }
  }

  const scale = ZOOMS[zoom];
  const fitted = zoom === 0;

  return createPortal(
    <div className="iv" role="dialog" aria-modal="true" aria-label={`${current.name}, image ${index + 1} of ${count}`}>
      <div className="iv-bar">
        <button ref={closeBtn} type="button" className="iv-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon name="close" />
        </button>
        <span className="iv-kind" aria-hidden="true">
          <Icon name="image" size={18} />
        </span>
        <span className="iv-name" title={current.name}>
          {current.name}
        </span>
        {count > 1 ? (
          <span className="iv-count">
            {index + 1} of {count}
          </span>
        ) : null}
        <span className="iv-spacer" />
        {current.url ? (
          <a
            className="iv-btn"
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            title="Open in new tab"
          >
            <Icon name="open" />
          </a>
        ) : null}
        {onDownload ? (
          <button
            type="button"
            className="iv-btn"
            onClick={() => void download()}
            disabled={saving}
            aria-label="Download"
            title="Download"
          >
            <Icon name="download" />
          </button>
        ) : null}
      </div>

      {/* A click on the dark around the image closes, as in Drive; a click on
          the image itself does not. */}
      <div
        ref={stage}
        className={`iv-stage${fitted ? "" : " zoomed"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {current.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.id}
            className="iv-img"
            src={current.url}
            alt={current.name}
            style={fitted ? undefined : { width: `${scale * 100}%`, maxWidth: "none", maxHeight: "none" }}
            onDoubleClick={() => setZoom((z) => (z === 0 ? 2 : 0))}
            draggable={false}
          />
        ) : (
          <div className="iv-missing">This image couldn't be loaded. Close and try again.</div>
        )}
      </div>

      {count > 1 ? (
        <>
          <button type="button" className="iv-nav prev" onClick={() => step(-1)} aria-label="Previous image" title="Previous (←)">
            <Icon name="left" size={26} />
          </button>
          <button type="button" className="iv-nav next" onClick={() => step(1)} aria-label="Next image" title="Next (→)">
            <Icon name="right" size={26} />
          </button>
        </>
      ) : null}

      <div className="iv-zoom" role="group" aria-label="Zoom">
        <button type="button" className="iv-btn" onClick={() => zoomBy(-1)} disabled={zoom === 0} aria-label="Zoom out" title="Zoom out (−)">
          <Icon name="zoomOut" />
        </button>
        <button type="button" className="iv-pct" onClick={() => setZoom(0)} title="Fit to screen (0)">
          {fitted ? "Fit" : `${Math.round(scale * 100)}%`}
        </button>
        <button
          type="button"
          className="iv-btn"
          onClick={() => zoomBy(1)}
          disabled={zoom === ZOOMS.length - 1}
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <Icon name="zoomIn" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
