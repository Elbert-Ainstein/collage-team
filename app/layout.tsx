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
        <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
