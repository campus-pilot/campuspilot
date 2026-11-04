/**
 * Integration tests run against the same Testcontainers stack as
 * `@campuspilot/api` (PostgreSQL with migrations, Redis, OPA, RustFS,
 * Gotenberg), so server transports are tested with real authorization.
 */
export { default } from '@campuspilot/api/test/global-setup';
