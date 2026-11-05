import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next build` also emits .next/standalone (a self-contained server.js) that the
  // desktop app ships and runs with Electron's Node. No effect on `next dev`.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "node-pty", "@resvg/resvg-js"],
  devIndicators: false,
};

export default nextConfig;
