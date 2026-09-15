# Server route placement

- Every authentication- or account-authentication-related application handler must be implemented as an oRPC procedure under `packages/api/src/router/auth/*.ts`. Do not add one-off auth handlers to `apps/server`.
