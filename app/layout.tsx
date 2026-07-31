import type { Metadata, Viewport } from "next";
import "@/styles/base.css";

export const metadata: Metadata = {
  title: "Class Check-ins — Applied Physics 50",
  description: "Weekly team-based learning check-ins for AP 50.",
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
