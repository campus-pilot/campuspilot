import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src",
  // The production image serves the client build as a static SPA through nginx.
  ssr: false,
} satisfies Config;
