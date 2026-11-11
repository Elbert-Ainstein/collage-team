// Which build this is: baked into the page and into /api/version alike, so a
// tab left open across a deploy can tell it's behind (src/lib/newerBuild.ts).
// Vercel's commit sha, not a timestamp: the config can be read more than once
// in a build, and the page and the server have to get the same string. "dev"
// where there's no sha, and then the check never fires.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Next 16 writes an AGENTS.md/CLAUDE.md into the repo on every `next dev`.
  // This app is three client pages on top of Supabase; nothing here needs
  // the framework's guidance, and the repo's own rules live in ~/.claude.
  agentRules: false,
  // A second dev server (scripts/dev-local.sh, against a local Supabase) needs
  // its own build folder: Next locks the one a running server is using.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
