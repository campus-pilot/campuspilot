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
- Register new procedures only in the normal application router; never add separate per-procedure MCP registration. Every leaf under `appRouter` must declare `.meta({ mcp: { exposure, access, destructive, module } })` (types in `src/mcp-metadata.ts`); the MCP catalog fails to build otherwise. Tools use their dot-joined router path as the name.
  - `exposure`: `core` (listed directly; everyday work of principals, managers, teachers and the finance desk), `advanced` (setup, configuration, lifecycle transitions, deletion/reversal, bulk or corrective money operations, maintenance, platform administration, large rarely used inputs; reached through the meta tools), or `hidden` (no agent value or must stay a human action; still served over RPC/OpenAPI). Exposure never decides who may call a tool; OPA does. Keep `core` within the tested budget (36 tools, 38k characters for tools/list); promoting a tool means demoting another or raising the budget deliberately.
  - `access`: `read` only if the handler never changes persisted state; otherwise `write`. Decide by reading the handler and the helpers it calls, not from the name.
  - `destructive`: `true` when the procedure may overwrite, remove or cancel existing data (update, upsert, delete, reverse, reorder, replace a selection, change an existing record's state); `false` for reads and purely additive writes.
  - `module`: the functional area used to filter the advanced index.
- The four meta tools (`listAdvancedTools`, `describeAdvancedTools`, `runAdvancedReadTool`, `runAdvancedWriteTool`) are MCP-only and live in `apps/server/src/mcp-meta-tools.ts`. The runners accept only advanced tools of their own access class.
- Give input fields a one-sentence `.describe()` when the name alone does not say what to send or where to get it (for example slugs, minor-unit amounts, idempotency keys, cursors). Every description is paid for in model tokens, so do not describe self-explanatory fields.
- User-owned API keys must work as either `x-api-key: <key>` or `Authorization: Bearer <key>` across RPC, OpenAPI, direct authenticated handlers, and MCP. If both are supplied, the explicit `x-api-key` value takes precedence. On MCP a Bearer value is first verified as a CampusPilot OAuth access token and only then as an API key; never decide by prefix.
- An MCP-exposed procedure must have either no input or a top-level Zod object input schema, because MCP tool arguments are named JSON object properties. Procedure outputs must be JSON-serializable.
- Every input field must be representable in JSON Schema. Do not accept `z.date()`/`z.coerce.date()`; declare instants as ISO 8601 strings (for finance, `financeInstantInputSchema`) or calendar dates as `YYYY-MM-DD` strings and convert inside the schema. The MCP catalog converts every input once at boot and fails with the procedure and field path otherwise.
- Direct HTTP handlers that depend on multipart uploads, binary request bodies, streaming mutations, or raw `Request`/`Response` behavior are not part of `appRouter` and do not need MCP exposure. This includes the school logo upload handler.

# Auth route placement

- Every authentication- or account-authentication-related application handler must be implemented as an oRPC procedure under `packages/api/src/router/auth/*.ts`. Do not add one-off auth handlers to `apps/server`.
- Approved exception (MCP OAuth, decision D4): the OAuth discovery documents (`/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server/api/auth`, `/.well-known/openid-configuration/api/auth`) are served by Hono in `apps/server` at the origin root, and the OAuth endpoints (`/api/auth/oauth2/*`, JWKS) are Better Auth endpoints. Protocols fix their URLs and payloads, so they cannot be oRPC procedures. The `/mcp` credential gate (`apps/server/src/mcp-auth.ts`) is part of the MCP transport. Application data the OAuth screens need (for example the consent client facts) is still an oRPC procedure here.
- `/mcp` accepts API keys (`x-api-key`, or `Authorization: Bearer` when the bearer value is not a CampusPilot OAuth access token) and OAuth access tokens issued for `MCP_RESOURCE_URL`; it never accepts session cookies. OAuth principals are limited by their grant's scopes (`mcp:read`, `mcp:write`) according to each procedure's `mcp.access`.

# Integration testing with Testcontainers

- Whenever any route or procedure is added to `packages/api` or an existing route is modified, agents MUST immediately add or update full integration tests covering that route.
- Tests execute against a real containerized dev stack spun up automatically with Testcontainers in `test/global-setup.ts`:
  - **PostgreSQL** (with all Drizzle migrations applied via `@campuspilot/db/migrate`).
  - **Redis** (for session and caching storage).
  - **OPA** (mounting `packages/opa/src/policies` for live authorization evaluations).
  - **RustFS** (S3-compatible object storage for files and logos with the `campuspilot` bucket created).
- Use `createTestClient(session)` from `test/fixtures` to test procedures directly and with full type safety via oRPC's `createRouterClient`. Its inputs and outputs cross a JSON round trip, so send ISO strings rather than `Date` objects and expect dates back as strings, exactly as an MCP, OpenAPI or curl client would:
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

# School documents

Before modifying document DTOs, procedures, contexts, templates, rendering,
storage, or artifact persistence, read the canonical
[Document system guide](../../docs/document-system.md) and the package-local
[backend contract](src/routers/school/document/README.md). Preserve strict
per-document source schemas, immutable template/PDF revisions, optimistic template
selection, explicit context fields, network-free rendering, and the all-classroom
timetable invariant. Update integration tests and the user-facing template context
reference whenever those contracts change.
