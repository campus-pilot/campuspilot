/** Launch a disposable synthetic school. See docs/local-document-preview.md. */
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { parseArgs } from "node:util";
import { z } from "zod";
import { spawn } from "node:child_process";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import setup from "../packages/api/test/global-setup";

const { values: options } = parseArgs({
  options: {
    "api-port": { type: "string", default: "3090" },
    "app-port": { type: "string", default: "3092" },
  },
});
const portSchema = z.coerce.number().int().min(1).max(65535);
const apiPort = portSchema.parse(options["api-port"]);
const appPort = portSchema.parse(options["app-port"]);
if (apiPort === appPort) throw new Error("API and app ports must differ.");
/** Fail before seeding if an existing preview owns either requested port. */
for (const port of [apiPort, appPort])
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
const values: Record<string, string> = {};
const teardown = await setup({
  provide: (key: string, value: string) => {
    values[key] = value;
  },
} as never);
const previewEnvironment = {
  NODE_ENV: "development",
  SYSTEM_ADMIN_EMAIL: "admin@preview.test",
  BETTER_AUTH_SECRET: "test-document-preview-secret-at-least-32-characters",
  BETTER_AUTH_URL: `http://localhost:${apiPort}`,
  GOOGLE_CLIENT_ID: "fixture",
  GOOGLE_CLIENT_SECRET: "fixture",
  PUBLIC_APP_URL: `http://localhost:${appPort}`,
  CORS_ORIGIN: `http://localhost:${appPort}`,
  SECURE_COOKIES: "false",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  S3_FORCE_PATH_STYLE: "true",
  RESTATE_ADMIN_URL: "http://localhost:9070",
  RESTATE_FABRIC_URL: "http://localhost:8080",
  RESTATE_INGRESS_URL: "http://localhost:8080",
  NEXT_PUBLIC_SERVER_URL: `http://localhost:${apiPort}`,
};
const child = spawn(
  execPath,
  [
    "--import",
    createRequire(
      new URL("../apps/server/package.json", import.meta.url),
    ).resolve("tsx"),
    fileURLToPath(new URL("./document-preview-app.ts", import.meta.url)),
  ],
  { env: { ...values, ...previewEnvironment }, stdio: "inherit" },
);
/** The parent owns container cleanup; restarting only the HTTP child preserves data. */
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", async (code) => {
  await teardown?.();
  process.exit(code ?? 0);
});
