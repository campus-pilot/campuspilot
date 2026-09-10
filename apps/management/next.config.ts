import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit static assets only. No Next.js server (and therefore no runtime SSR)
  // is included in the production image.
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@campuspilot/ui"],
};

export default nextConfig;
