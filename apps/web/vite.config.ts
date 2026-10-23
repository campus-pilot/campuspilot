import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  /**
   * React Router prerenders the SPA shell through Vite's preview server during
   * production builds. Binding the listener explicitly keeps the request and
   * listener on the same address family in minimal container images.
   */
  preview: {
    host: "127.0.0.1",
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), reactRouter()],
});
