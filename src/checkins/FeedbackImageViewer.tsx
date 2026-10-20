"use client";

// The comment's images in the full-screen viewer, opened at the one clicked.

import { feedbackImageLabel } from "./feedbackImages";
import { ImageViewer } from "./ImageViewer";
import type { FeedbackImagesState } from "./useFeedbackImages";

interface FeedbackImageViewerProps {
  state: FeedbackImagesState;
  /** Which image is open, or null for none. */
  open: number | null;
  onOpen: (index: number | null) => void;
}

export function FeedbackImageViewer({ state, open, onOpen }: FeedbackImageViewerProps) {
  const { images, urls, download } = state;
  if (open == null || !images[open]) return null;
  return (
    <ImageViewer
      images={images.map((img, i) => ({
        id: img.id,
        url: urls.get(img.path) ?? null,
        name: feedbackImageLabel(img, i),
      }))}
      index={open}
      onIndex={onOpen}
      onClose={() => onOpen(null)}
      onDownload={(i) => download(images[i])}
    />
  );
}
