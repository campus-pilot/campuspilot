# API pagination conventions

- Name collection procedures `list<PluralResource>` (for example, `listSchools`). Reserve `get<Resource>` for fetching one resource.
- Every list procedure must accept an input created with `createListInputSchema` from `src/paginations` and return an output created with `createPaginatedOutputSchema`.
- Build list responses with `createPaginatedResult`; do not return a bare array. The response shape is `{ items, pagination }`.
- Pagination metadata must explicitly include `nextCursor`, `currentPage`, `totalPages`, `totalItems`, and `pageSize`.
- The default and maximum page size are both 20. A caller may request fewer items but not more.
- Page numbers are one-based. A cursor produced by the shared page pagination helper contains the next one-based page number. Callers must send either `cursor` or `page`, never both.
- Every list query must have an explicit default `orderBy` and a deterministic tie-breaker. Only expose an allowlist of sortable fields; never pass client-provided column names directly to the database.
- Keep resource-specific `filters`, `searchQuery`, and `orderBy` fields in that resource's list input schema. Apply the same conditions to both the item query and the total-count query.
- Add new filters as independent, explicit fields. Do not infer one filter from another field that happens to correlate with it.
- Search text must be trimmed and length-limited. Search only an explicit set of columns.

# MCP exposure

- Every oRPC procedure must define `.route({ summary, description, tags })` with a useful human-readable summary and description. This metadata powers both OpenAPI documentation and automatic MCP tool discovery.
- Register new procedures only in the normal application router. Every leaf under `appRouter` is exposed automatically as an MCP tool using its dot-joined router path; never add separate per-procedure MCP registration.
- User-owned API keys must work as either `x-api-key: <key>` or `Authorization: Bearer <key>` across RPC, OpenAPI, direct authenticated handlers, and MCP. If both are supplied, the explicit `x-api-key` value takes precedence.
- An MCP-exposed procedure must have either no input or a top-level Zod object input schema, because MCP tool arguments are named JSON object properties. Procedure outputs must be JSON-serializable.
- Direct HTTP handlers that depend on multipart uploads, binary request bodies, streaming mutations, or raw `Request`/`Response` behavior are not part of `appRouter` and do not need MCP exposure. This includes the school logo upload handler.

# Auth route placement

- Every authentication- or account-authentication-related application handler must be implemented as an oRPC procedure under `packages/api/src/router/auth/*.ts`. Do not add one-off auth handlers to `apps/server`.

# Integration testing with Testcontainers

- Whenever any route or procedure is added to `packages/api` or an existing route is modified, agents MUST immediately add or update full integration tests covering that route.
- Tests execute against a real containerized dev stack spun up automatically with Testcontainers in `test/global-setup.ts`:
  - **PostgreSQL** (with all Drizzle migrations applied via `@campuspilot/db/migrate`).
  - **Redis** (for session and caching storage).
  - **OPA** (mounting `packages/opa/src/policies` for live authorization evaluations).
  - **MinIO** (S3-compatible object storage for files and logos with the `campuspilot` bucket created).
- Use `createTestClient(session)` from `test/fixtures` to test procedures directly and with full type safety via oRPC's `createRouterClient`:
  - `createTestClient(null)` for anonymous / public callers.
  - `createTestClient(await createAdminSession())` for platform administrators (`role: 'admin'`).
  - `createTestClient((await createSchoolStaffSession(schoolId, roles)).session)` for tenant-scoped school roles (`principal`, `manager`, `teacher` with class metadata, etc.).
  - `createTestClient(await createRegularUserSession())` for ordinary users (`role: 'user'`).
- For direct HTTP handlers (for example, logo upload), test the handlers with standard `Request`, `FormData`, and `{ db, headers, session }` context.
- Every route test suite must cover:
  1. **Authentication & Authorization**: Verify unauthenticated callers are rejected with `UNAUTHORIZED`, ungranted roles or mismatched tenant scopes are rejected with `FORBIDDEN`, and granted roles succeed.
  2. **Input Validation**: Verify invalid inputs (regex formats, missing fields, illegal boundaries) fail validation before hitting database or OPA.
  3. **Domain Logic & Errors**: Verify happy paths and domain errors (`NOT_FOUND` for non-existent entities, `CONFLICT` for duplicate memberships/resources, `BAD_REQUEST` for invalid state transitions).
  4. **State Persistence**: Verify database rows or S3 objects are correctly inserted, updated, or removed.
- Run tests via `pnpm --filter @campuspilot/api test`.
