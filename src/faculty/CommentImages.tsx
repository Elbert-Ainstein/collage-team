"use client";

// The images under a grading comment: thumbnails, a remove on each, and an
// attach button. Paste and drop are handled by the caller on the comment card,
// so a screenshot can go straight in from the clipboard.

import { useRef, useState } from "react";
import { FEEDBACK_IMAGE_TYPES, feedbackImageLabel } from "@/checkins/feedbackImages";
import { FeedbackImageViewer } from "@/checkins/FeedbackImageViewer";
import type { FeedbackImagesState } from "@/checkins/useFeedbackImages";
import { FIcon } from "./icons";

interface CommentImagesProps {
  state: FeedbackImagesState;
  /** False for a grader who may not write here — they still see what is attached. */
  canEdit: boolean;
}

export function CommentImages({ state, canEdit }: CommentImagesProps) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const { images, urls, uploading, unavailable, attach, remove } = state;

  if (unavailable) {
    return (
      <div className="fv-sub fv-cimg-note" role="note">
        {unavailable}
      </div>
    );
  }

  return (
    <div className="fv-cimg">
      {images.length || uploading ? (
        <ul className="fv-cimg-grid" aria-label="Images on this comment">
          {images.map((img, i) => (
            <Thumb
              key={img.id}
              url={urls.get(img.path) ?? null}
              label={feedbackImageLabel(img, i)}
              onOpen={() => setOpen(i)}
              onRemove={canEdit ? () => void remove(img) : null}
            />
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <li key={`up-${i}`} className="fv-cimg-thumb pending" aria-label="Uploading image">
              <span className="fv-sub">Uploading…</span>
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <>
          <button
            type="button"
            className="fv-btn outline sm"
            onClick={() => input.current?.click()}
            title="PNG, JPEG, WebP or GIF, up to 25 MB. You can also paste or drop a screenshot here."
          >
            <FIcon name="attachFile" size={14} />
            Attach image
          </button>
          <input
            ref={input}
            type="file"
            accept={FEEDBACK_IMAGE_TYPES.join(",")}
            multiple
            hidden
            aria-label="Attach images to this comment"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Cleared so choosing the same file again still fires a change.
              e.target.value = "";
              void attach(files);
            }}
          />
        </>
      ) : null}

      <FeedbackImageViewer state={state} open={open} onOpen={setOpen} />
    </div>
  );
}

function Thumb({
  url,
  label,
  onOpen,
  onRemove,
}: {
  url: string | null;
  label: string;
  onOpen: () => void;
  onRemove: (() => void) | null;
}) {
  return (
    <li className="fv-cimg-thumb">
      {url ? (
        <button type="button" className="fv-cimg-open" onClick={onOpen} title={`Open ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} />
        </button>
      ) : (
        <span className="fv-sub">Image</span>
      )}
      {onRemove ? (
        <button
          type="button"
          className="fv-cimg-x"
          onClick={onRemove}
          aria-label="Remove this image"
          title="Remove this image"
        >
          <FIcon name="close" size={12} />
        </button>
      ) : null}
    </li>
  );
}
