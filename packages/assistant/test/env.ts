/**
 * Placeholder environment for every assistant test.
 *
 * The assistant runs inside the API server and the worker, so it reads their
 * environment modules (`@campuspilot/env/server`, `@campuspilot/env/assistant`),
 * which validate at import and load a `.env` through dotenv first. dotenv
 * never replaces a variable that is already set, so setting every variable
 * here (through `test.env` in vitest.config.ts) makes the tests independent of
 * a developer's `.env` and keeps its real API keys out of the test process:
 * - required variables get an inert placeholder;
 * - optional variables are set to an empty string, which dotenv treats as
 *   set and the schemas (`emptyStringAsUndefined`) treat as absent.
 *
 * Nothing here is reachable: the hosts are reserved `.invalid` names (or a
 * localhost port nothing listens on, where the auth library insists on
 * HTTPS or loopback), so a test that tries to use one fails instead of
 * talking to a real service.
 * The integration project replaces `DATABASE_URL` and `REDIS_URL` with its
 * containers (test/setup.ts).
 */
export const ASSISTANT_TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  // dotenv announces every load on stdout unless told not to.
  DOTENV_CONFIG_QUIET: 'true',
  // Only fatal logs, so test output is the test report.
  LOG_LEVEL: 'fatal',
  LOG_APP: 'assistant-test',

  // The API server's environment (`@campuspilot/env/server`).
  DATABASE_URL: 'postgresql://placeholder:placeholder@postgres.invalid:5432/placeholder',
  DB_MIGRATIONS_PATH: '',
  REDIS_URL: 'redis://redis.invalid:6379',
  PUBLIC_APP_URL: 'http://management.invalid',
  CORS_ORIGIN: 'http://management.invalid',
  SYSTEM_ADMIN_EMAIL: 'admin@campuspilot.invalid',
  BETTER_AUTH_SECRET: 'a-placeholder-secret-that-is-at-least-32-chars',
  BETTER_AUTH_URL: 'http://localhost:3999',
  MCP_RESOURCE_URL: 'http://localhost:3999/mcp',
  CADET_APP_URL: 'http://localhost:3998',
  CADET_MCP_RESOURCE_URL: 'http://localhost:3999/cadet/mcp',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  S3_BUCKET: 'campuspilot',
  S3_REGION: 'us-east-1',
  S3_ENDPOINT: '',
  S3_ACCESS_KEY_ID: '',
  S3_SECRET_ACCESS_KEY: '',
  GOTENBERG_URL: 'http://gotenberg.invalid',
  OPA_URL: 'http://opa.invalid',
  RESTATE_ADMIN_URL: 'http://restate.invalid:9070',
  RESTATE_FABRIC_URL: 'http://restate.invalid:8080',
  RESTATE_INGRESS_URL: 'http://restate.invalid:8080',
  WORKER_CONTROL_SECRET: 'worker-control-secret-for-tests-0123456789',
  ASSISTANT_TOKEN_SIGNING_SECRET: 'assistant-token-signing-secret-for-tests-0123',
  WEB_PUSH_ENABLED: '',
  WHATSAPP_ENABLED: '',

  // The assistant's own environment (`@campuspilot/env/assistant`).
  ASSISTANT_PROVIDER: 'gemini',
  CAMPUSPILOT_MCP_URL: 'http://api.invalid/mcp',
  // Not real keys. Tests never call a model provider: every model step comes
  // from the scripted fake (src/runtime/providers/fake.ts).
  GEMINI_API_KEY: 'test-gemini-key-not-real',
  GEMINI_MODEL: 'gemini-test-model',
  GEMINI_PRICE_INPUT_USD_PER_MTOK: '0.75',
  GEMINI_PRICE_OUTPUT_USD_PER_MTOK: '3.75',
  GEMINI_PRICE_CACHE_READ_USD_PER_MTOK: '0.075',
  GEMINI_PRICE_CACHE_WRITE_USD_PER_MTOK: '0',
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_MODEL: '',
  ANTHROPIC_PRICE_INPUT_USD_PER_MTOK: '',
  ANTHROPIC_PRICE_OUTPUT_USD_PER_MTOK: '',
  ANTHROPIC_PRICE_CACHE_READ_USD_PER_MTOK: '',
  ANTHROPIC_PRICE_CACHE_WRITE_USD_PER_MTOK: '',

  ASSISTANT_DIAGNOSTICS: 'false',
};
