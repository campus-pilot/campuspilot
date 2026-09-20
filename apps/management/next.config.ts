import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // School identifiers are runtime tenant data, so the management app cannot
  // use static export's build-time-only dynamic route enumeration.
  output: "standalone",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@campuspilot/ui"],
};

export default nextConfig;
