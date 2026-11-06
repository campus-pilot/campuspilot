import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@campuspilot/ui"],
  /**
   * The Cadet Portal's sign-in (and, later, the OAuth consent screen) must
   * never be framed, so another site cannot trick a student into signing in
   * or approving an AI app's access (clickjacking).
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
