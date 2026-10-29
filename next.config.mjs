/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes an AGENTS.md/CLAUDE.md into the repo on every `next dev`.
  // This app is three client pages on top of Supabase; nothing here needs
  // the framework's guidance, and the repo's own rules live in ~/.claude.
  agentRules: false,
  // A second dev server (scripts/dev-local.sh, against a local Supabase) needs
  // its own build folder: Next locks the one a running server is using.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
