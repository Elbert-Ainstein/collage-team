/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes an AGENTS.md/CLAUDE.md into the repo on every `next dev`.
  // This app is three client pages on top of Supabase; nothing here needs
  // the framework's guidance, and the repo's own rules live in ~/.claude.
  agentRules: false,
};

export default nextConfig;
