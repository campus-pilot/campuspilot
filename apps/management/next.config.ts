import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // School identifiers are runtime tenant data, so the management app cannot
  // use static export's build-time-only dynamic route enumeration.
  output: "standalone",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@campuspilot/ui"],
  /**
   * The OAuth consent screen must never be framed, so another site cannot
   * trick a signed-in user into approving an AI app's access (clickjacking).
   */
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
