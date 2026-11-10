/**
 * Placeholder environment for every assistant test.
 *
 * `@campuspilot/env/assistant` validates the environment at import and loads
 * `apps/assistant/.env` through dotenv first. dotenv never replaces a
 * variable that is already set, so setting every variable of that schema here
 * (through `test.env` in vitest.config.ts) makes the tests independent of a
 * developer's `.env` and keeps its real API keys out of the test process:
 * - required variables get an inert placeholder;
 * - optional variables are set to an empty string, which dotenv treats as
 *   set and the schema (`emptyStringAsUndefined`) treats as absent.
 *
 * Nothing here is reachable: the hosts are reserved `.invalid` names, so a
 * test that tries to use one fails instead of talking to a real service.
 * The integration project replaces `ASSISTANT_DATABASE_URL` and `REDIS_URL`
 * with its containers (test/setup.ts).
 *
 * Keep this in step with `packages/env/src/assistant.ts`: a variable added
 * there and missing here would be read from a developer's `.env` again.
 */
export const ASSISTANT_TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  // dotenv announces every load on stdout unless told not to.
  DOTENV_CONFIG_QUIET: 'true',
  // Only fatal logs, so test output is the test report.
  LOG_LEVEL: 'fatal',
  LOG_APP: 'assistant-test',

  ASSISTANT_PORT: '3104',
  CORS_ORIGIN: 'http://management.invalid',
  ASSISTANT_DATABASE_URL: 'postgresql://placeholder:placeholder@postgres.invalid:5432/placeholder',
  ASSISTANT_DB_MIGRATIONS_PATH: '',
  REDIS_URL: 'redis://redis.invalid:6379',

  CAMPUSPILOT_API_URL: 'http://api.invalid',
  CAMPUSPILOT_MCP_URL: 'http://api.invalid/mcp',
  ASSISTANT_SERVICE_SECRET: 'assistant-service-secret-for-tests-0123456789',

  RESTATE_INGRESS_URL: 'http://restate.invalid:8080',
  RESTATE_ADMIN_URL: 'http://restate.invalid:9070',
  RESTATE_SERVICE_PORT: '9081',
  RESTATE_SERVICE_URL: '',

  ASSISTANT_PROVIDER: 'anthropic',
  // Not real keys. Tests never call a model provider: every model step comes
  // from the scripted fake (src/runtime/providers/fake.ts).
  ANTHROPIC_API_KEY: 'test-anthropic-key-not-real',
  ANTHROPIC_MODEL: 'claude-opus-5-5',
  GEMINI_API_KEY: 'test-gemini-key-not-real',
  GEMINI_MODEL: 'gemini-test-model',

  ASSISTANT_DIAGNOSTICS: 'false',
};
