import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@campuspilot/ui"],
};

export default nextConfig;
