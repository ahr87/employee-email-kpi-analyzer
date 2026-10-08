import type { NextConfig } from "next";

// Static export for GitHub Pages: no server, no API routes. See src/lib/config.ts.
const REPO = "employee-email-kpi-analyzer";
const production = process.env.NODE_ENV === "production";
// Production builds are served under /<repo>; override with BASE_PATH="" for a root-hosted build.
const basePath = process.env.BASE_PATH ?? (production ? `/${REPO}` : "");

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true, // /settings/ -> settings/index.html, so refreshing a page works on static hosting
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  reactStrictMode: true,
};

export default nextConfig;
