import type { Metadata, Viewport } from "next";
import "@/styles/app.css";
import { AppShell } from "@/shell/AppShell";

export const metadata: Metadata = {
  title: "Collage AI — Team Learning",
  description: "Team-based learning activity engine for Collage AI.",
};

export const viewport: Viewport = {
  width: 1280,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
