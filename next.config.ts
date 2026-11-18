import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./lib/security-headers";

// The headers themselves (and why each one is there) are in
// lib/security-headers.ts, so they can be unit tested.
const nextConfig: NextConfig = {
  // The test setup builds into its own folder so it never disturbs a normal
  // dev server or build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders(process.env) }];
  },
};

export default nextConfig;
