import type { Metadata, Viewport } from "next";
import "@/styles/base.css";

export const metadata: Metadata = {
  title: "Collage-Team",
  // What a link to this shows in Slack or a Canvas page. It named one course,
  // which was true when there was one — the app now holds whatever courses the
  // people using it set up, and a preview naming AP 50 to somebody in another
  // class reads as the wrong link.
  description: "Team-based learning, in one place.",
};

// The gradebook scrolls horizontally inside its own container, so the page
// itself is responsive rather than pinned to a desktop width.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
