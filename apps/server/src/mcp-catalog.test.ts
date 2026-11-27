import type { Context } from '@campuspilot/api/context';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { OpenAPIGenerator } from '@orpc/openapi';
import { type AnyRouter, resolveContractProcedures } from '@orpc/server';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildMcpCatalog,
  createCampusPilotMcpHandler,
  type McpCatalog,
  type McpToolDefinition,
} from './mcp';
import { MAX_DESCRIBED_TOOLS, META_TOOL_NAMES } from './mcp-meta-tools';
import { assistantToolDecision } from '@campuspilot/api/assistant/tool-policy';
import { ASSISTANT_TOOL_META } from '@campuspilot/assistant-contract/protocol';

vi.mock('@campuspilot/auth/server', () => ({
  createAuth: vi.fn(),
}));
// The catalog never runs auth; like the staff instance, the cadet instance
// (which needs CADET_APP_URL) is not built in this env-less unit test.
vi.mock('@campuspilot/auth/cadet', () => ({
  cadetAuth: {},
  revokeCadetLoginAccess: vi.fn(),
}));

type JsonSchema = Record<string, unknown>;

/** The approved everyday set (plan Appendix B); changes are deliberate. */
const CORE_TOOLS = [
  'school.createAdmission',
  'school.createManualBill',
  'school.generateDocument',
  'school.getAdmission',
  'school.getAdmissionBill',
  'school.getAdmissionFinanceSummary',
  'school.getAdmissionLedger',
  'school.getClass',
  'school.getCollectionRegister',
  'school.getDashboard',
  'school.getDocumentDownload',
  // Generation is a background job: generateDocument returns it, this reads its outcome.
  'school.getDocumentGenerationJob',
  'school.getExam',
  'school.getExamOverview',
  'school.getExamResult',
  'school.getMember',
  'school.getPayment',
  'school.getSchool',
  'school.getSession',
  'school.getStudent',
  'school.listAdmissionBills',
  'school.listAdmissions',
  'school.listClasses',
  'school.listDocumentArtifacts',
  'school.listExamResults',
  'school.listExams',
  'school.listMembers',
  'school.listMySchools',
  'school.listPayments',
  'school.listSections',
  'school.listSessions',
  'school.listStudents',
  'school.recordAdjustment',
  'school.recordPayment',
  'school.recordPaymentWithDiscount',
  'school.updateAdmission',
  'school.upsertExamResult',
];

const HIDDEN_TOOLS = [
  // Template PDF previews: each call is a Gotenberg conversion for a person
  // looking at the editor or the marketplace, never an agent tool.
  'school.previewDocumentTemplatePdf',
  'school.previewDocumentTemplateRevisionPdf',
  'school.previewMarketplaceTemplatePdf',
  // The data the template editor's previews render with (students, results,
  // finance as the caller may read them): the editor's, not an agent tool;
  // agents read that data through its own tools.
  'school.getDocumentTemplatePreviewContext',
  'auth.setPassword',
  'auth.getOAuthConsentClient',
  'auth.listOAuthConnections',
  'auth.disconnectOAuthConnection',
  'authorization.checkPermissions',
  'healthCheck',
  'school.getLogo',
  // Returns a credential and signs a student out everywhere: a human action.
  'school.issueAdmissionCadetPassword',
  // Staff passwords and sign-in details: credentials and account takeover
  // stay human actions.
  'school.issueMemberPassword',
  'systemAdmin.listUsers',
  'systemAdmin.setUserPassword',
  'systemAdmin.updateUserSignIn',
  'systemAdmin.listOAuthClients',
  'systemAdmin.createOAuthClient',
  'systemAdmin.rotateOAuthClientSecret',
  'systemAdmin.deleteOAuthClient',
  'systemAdmin.setOAuthClientDisabled',
  // Who may use the in-app assistant is a human setting; never offered to the assistant itself.
  'school.getAssistantAccess',
  'school.updateAssistantRoles',
  'school.getAssistantAllowance',
  'systemAdmin.getSchoolAssistantUsage',
  'systemAdmin.getAssistantPlatformStatus',
  'systemAdmin.getPlatformAssistantUsage',
  // The staff notification inbox is app chrome with no agent value.
  'school.listNotifications',
  'school.getUnreadNotificationCount',
  'school.markNotificationsRead',
  'school.markAllNotificationsRead',
  'school.dismissNotifications',
  // Data migrations change every school's data: human platform-admin actions.
  'systemAdmin.listDataMigrations',
  'systemAdmin.listDataMigrationSkippedItems',
  'systemAdmin.requestDataMigrationRun',
  // Website leads carry prospects' contact details: platform admins only.
  'systemAdmin.listLeads',
  // School Onboarding submissions carry a school's contact details and recordings.
  'systemAdmin.listSchoolRegistrationRequests',
  'systemAdmin.getSchoolRegistrationRequestMedia',
  // Setting up a school from a submission creates schools and accounts: a human decision.
  'systemAdmin.getSchoolSetup',
  'systemAdmin.saveSchoolSetupDraft',
  'systemAdmin.startSchoolSetup',
  // Demo provisioning, credentials and purge stay human admin actions.
  'systemAdmin.listDemoClassCatalogue',
  'systemAdmin.createDemoSchool',
  'systemAdmin.startDemoSchoolJob',
  'systemAdmin.retryDemoSchoolJob',
  'systemAdmin.getDemoSchoolJob',
  'systemAdmin.getSchoolDemoJob',
  'systemAdmin.getDemoCredentialsDownload',
  'systemAdmin.purgeDemoSchool',
  'systemAdmin.watchDemoSchoolJob',
  'systemAdmin.retryDemoSchoolPurge',
  'systemAdmin.getDemoSchoolPurge',
  'systemAdmin.watchDemoSchoolPurge',
  'systemAdmin.listDemoSchoolPurges',
  // Which features a school has is app chrome; switching them is a human
  // platform decision (systemAdmin.getSchoolFeatureFlags stays advanced).
  'school.getFeatureFlags',
  'systemAdmin.updateSchoolFeatureFlag',
  // So is the tier a school is on (what it pays for and has).
  'systemAdmin.updateSchoolTier',
  // Suspending a school, and lifting it, takes away or restores a school's
  // ability to work: a human platform decision, made in the admin app.
  'systemAdmin.suspendSchool',
  'systemAdmin.unsuspendSchool',
  // So is a school's billing (docs/school-billing.md): its periods, payments
  // and the price catalogue are read and changed only where they are managed.
  'systemAdmin.getSchoolBilling',
  'systemAdmin.startSchoolTrial',
  'systemAdmin.updateSchoolTrial',
  'systemAdmin.endSchoolBillingPeriod',
  'systemAdmin.addSchoolBillingPeriods',
  'systemAdmin.voidSchoolInvoice',
  'systemAdmin.listSubscriptionPrices',
  'systemAdmin.setSubscriptionPrice',
  // The school's assistant role list as the platform administrator edits it;
  // hidden like every assistant setting (school.getAssistantAccess,
  // school.updateAssistantRoles), so never offered to the assistant itself.
  'systemAdmin.getSchoolAssistantRoles',
  'systemAdmin.updateSchoolAssistantRoles',
  // Question paper actions that must stay a person's: the AI generation job
  // (chat agents author papers themselves), page photo management (reserve,
  // release, reorder, turn, delete: a person looks at the photo), previews and
  // downloads (the app and the paper's versions tools cover agents).
  'school.startQuestionPaperGeneration',
  'school.getQuestionPaperDetail',
  'school.reserveQuestionPaperPages',
  'school.releaseQuestionPaperPage',
  'school.reorderQuestionPaperPages',
  'school.rotateQuestionPaperPage',
  'school.deleteQuestionPaperPage',
  'school.deleteQuestionPaper',
  'school.getQuestionPaperPreview',
  'school.previewQuestionPaperDraft',
  'school.getQuestionPaperDownload',
  // Starting a paper from an earlier one is a button in the paper screen; an agent
  // reads any paper with getQuestionPaper and saves its own edit instead.
  'school.listQuestionPaperCopySources',
  'school.copyQuestionPaperVersion',
  // Opening a school and asking CampusPilot for more are a person's own
  // decisions (docs/school-creation.md), and so is deciding such a request,
  // or naming a school's owner.
  'schoolCreation.getStatus',
  'schoolCreation.createSchool',
  'schoolCreation.requestMore',
  // So is the new school's guided setup: the owner's first walk through it.
  'school.getOnboarding',
  'school.completeOnboarding',
  'school.skipOnboarding',
  'systemAdmin.listSchoolCreationRequests',
  'systemAdmin.countPendingSchoolCreationRequests',
  'systemAdmin.decideSchoolCreationRequest',
  'systemAdmin.updateSchoolOwner',
  // A personal space is opened by its person (docs/personal-space.md).
  'personalSpace.getStatus',
  'personalSpace.create',
  // The standalone paper screen's own procedures, human actions as for exam papers.
  'school.startStandalonePaperGeneration',
  'school.getStandalonePaperDetail',
  'school.reserveStandalonePaperPages',
  'school.releaseStandalonePaperPage',
  'school.reorderStandalonePaperPages',
  'school.rotateStandalonePaperPage',
  'school.deleteStandalonePaperPage',
  'school.deleteStandalonePaper',
  'school.getStandalonePaperPreview',
  'school.previewStandalonePaperDraft',
  'school.getStandalonePaperDownload',
  // The school's Question papers page (a screen read; agents use the per-kind paper tools).
  'school.listSchoolQuestionPapers',
  'school.listSchoolQuestionPaperFilterOptions',
];

/**
 * Upper bound for what the model reads from tools/list (core + meta tools):
 * each tool's name, title, description and input schema as serialized JSON,
 * the same measure the plan's budget uses. Annotations and `_meta` (for
 * example ChatGPT's securitySchemes) are client metadata and not counted. It
 * is paid in model tokens on every conversation, so growing it must be a
 * deliberate decision.
 */
// 38,500 since getDocumentGenerationJob joined core (37 tools; packages/api/AGENTS.md):
// tightening the generation descriptions could not bring the listing back under 38,000.
// 39,400 since generateDocument's source gained the Bill due branch (about 900
// characters: its recipients are an explicit session / class / admissions choice).
const CORE_LISTING_BUDGET_CHARS = 39_400;

let appRouter: AnyRouter;
let catalog: McpCatalog;
let leafNames: string[];

beforeAll(async () => {
  vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
  ({ appRouter } = await import('@campuspilot/api/routers/index'));
  catalog = await buildMcpCatalog(appRouter);
  leafNames = [];
  await resolveContractProcedures({ router: appRouter, path: [] }, ({ path }) => {
    leafNames.push(path.join('.'));
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const exposedTools = () => [...catalog.core, ...catalog.advanced];

type Connection = { client: Client; close: () => Promise<void> };
const connections: Connection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map(({ close }) => close()));
});

/**
 * Connects to the real catalog over the Streamable HTTP transport, as an
 * anonymous caller or as an OAuth grant with the given scopes.
 */
async function connect(oauthScopes?: string[] | 'assistant'): Promise<Client> {
  const context = (
    oauthScopes === 'assistant'
      ? {
          session: null,
          principal: {
            authMethod: 'assistant',
            assistantRun: { conversationId: 'c', runId: 'r', schoolId: 's' },
          },
        }
      : oauthScopes
      ? {
          session: null,
          principal: {
            authMethod: 'oauth',
            oauthGrant: { clientId: 'test', scopes: oauthScopes, grantId: 'g' },
          },
        }
      : { session: null, principal: { authMethod: 'anonymous' } }
  ) as Context;
  const handler = createCampusPilotMcpHandler({
    catalog: Promise.resolve(catalog),
    currentContext: () => context,
    reportError: vi.fn(),
  });
  const client = new Client({ name: 'catalog-test', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    }),
  );
  connections.push({
    client,
    close: async () => {
      await client.close();
      await handler.close();
    },
  });
  return client;
}

function textJson(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

describe('catalog metadata', () => {
  it('classifies every appRouter leaf exactly once', () => {
    const classified = [
      ...catalog.core.map(({ name }) => name),
      ...catalog.advanced.map(({ name }) => name),
      ...HIDDEN_TOOLS,
    ].sort();

    expect(classified).toEqual([...leafNames].sort());
    expect(catalog.core.map(({ name }) => name).sort()).toEqual(CORE_TOOLS);
    // 37 since getDocumentGenerationJob (deliberate: generation is a background job, and the
    // assistant cannot fetch a PDF it generated without reading the job; packages/api/AGENTS.md).
    expect(catalog.core).toHaveLength(37);
    // 85 on main, plus releaseExamToCadet, withdrawExamFromCadet,
    // get/saveStudentExamRemark and get/updateCadetPortalSettings (+6);
    // +4 result notification tools (release preview, release batch read,
    // single preview/send) and +2 delivery log tools (list, resend);
    // +1 systemAdmin.getSchoolFeatureFlags; +9 notice tools (list, get,
    // create, update, delete, preview, publish preview, publish, download);
    // +3 exam timetable publication tools (publish preview, publish, withdraw);
    // +8 question paper tools (list, get, versions, learn, validate, save, get draft, edit);
    // +1 school.updateExamClasses (change the classes taking part in an exam);
    // +10 standalone paper tools of a personal space and a school's quick papers (list, filter options, create,
    // get, get draft, versions, learn, validate, save, edit);
    // +1 systemAdmin.getPersonalSpaceStats (the admin dashboard's personal space counts);
    // +4 school.addClassSubject, updateClassSubject, removeClassSubject and
    // moveClassSubjectToClassroom (one subject at a time, subjects added from an exam);
    // +1 school.listDocumentGenerationJobs (PDFs being created, and recent failures);
    // +4 template tools (list and get revisions, learn template editing, validate a template draft).
    expect(catalog.advanced).toHaveLength(139);
  });
});

describe('school feature gates in the catalog', () => {
  const byName = () => new Map(exposedTools().map((tool) => [tool.name, tool]));

  it('marks the admission, student, billing, result, timetable and student document tools as student management', () => {
    const tools = byName();
    for (const name of [
      'school.listAdmissions',
      'school.createAdmission',
      'school.listStudents',
      'school.listBillingRuns',
      'school.recordPayment',
      'school.getSessionFinance',
      'school.listExamResults',
      'school.listExamStudents',
      'school.getExamTimetable',
      'school.sendStudentResultNotification',
      'school.getStudentExamRemark',
      'school.listDocumentArtifacts',
      // Every source they generate from is a student management document, so the gate is theirs.
      'school.generateDocument',
      'school.getDocumentGenerationJob',
      'school.listDocumentGenerationJobs',
      'school.previewDocument',
      'school.listNotificationDeliveries',
    ]) {
      expect(tools.get(name)?.features, name).toContain('studentManagement');
      expect(tools.get(name)?.description, name).toMatch(/Only for schools that have (.+ and )?Student management\.$/);
    }
  });

  it('leaves staff, classes, examinations, their lifecycle and question papers ungated', () => {
    const tools = byName();
    for (const name of [
      'school.listMembers',
      'school.listClasses',
      'school.listExams',
      'school.transitionExam',
      'school.listExamPlans',
      'school.listQuestionPapers',
      'school.getDashboard',
      'school.withdrawExamFromCadet',
      // Template tools also serve the question paper and notice templates: refused per call, by document type.
      'school.getActiveDocumentTemplate',
      'school.saveDocumentTemplate',
      // Session settings stay for examinations; only their student-only parts are refused, in the handler.
      'school.updateSession',
    ]) {
      expect(tools.get(name)?.features, name).not.toContain('studentManagement');
    }
  });

  it('gives every gated tool a schoolId input, which its gate reads', () => {
    for (const tool of exposedTools().filter(({ features }) => features.length > 0)) {
      expect(Object.keys(tool.inputSchema.shape), tool.name).toContain('schoolId');
    }
  });
});

describe('cadet catalog', () => {
  it('builds from cadetRouter alone: read-only core tools and no staff tools', async () => {
    const { cadetRouter } = await import('@campuspilot/api/routers/cadet/cadet.router');
    const cadetCatalog = await buildMcpCatalog(cadetRouter);
    expect(cadetCatalog.core.map(({ name }) => name)).toEqual(['getAdmission', 'getProfile', 'getFeeSummary', 'listFeeLedger', 'getBill', 'listExams', 'getExam', 'getExamResult', 'getGrowth', 'listRemarks', 'listNotices', 'getNotice', 'listTimetables', 'getTimetable']);
    expect(cadetCatalog.advanced).toEqual([]);
    expect(cadetCatalog.core.every((tool) => tool.mcp.access === 'read')).toBe(true);
    expect(catalog.core.map(({ name }) => name)).not.toContain('getAdmission');
  });
});

/**
 * Runs the real catalog through the Streamable HTTP transport a remote client
 * uses, so a single unconvertible schema fails here instead of in production.
 */
describe('real appRouter over Streamable HTTP', () => {
  it('lists exactly the core tools and the four meta tools, with annotations', async () => {
    const client = await connect();
    const listed = await client.listTools();
    const byName = new Map(catalog.core.map((tool) => [tool.name, tool]));

    expect(listed.tools.map(({ name }) => name).sort()).toEqual(
      [...CORE_TOOLS, ...Object.values(META_TOOL_NAMES)].sort(),
    );
    for (const tool of listed.tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe('object');
      const definition = byName.get(tool.name);
      if (!definition) continue;
      expect(tool.annotations, tool.name).toEqual({
        readOnlyHint: definition.mcp.access === 'read',
        destructiveHint: definition.mcp.destructive,
        openWorldHint: false,
      });
    }
    expect(
      listed.tools.find(({ name }) => name === META_TOOL_NAMES.runWrite)
        ?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const name of [
      META_TOOL_NAMES.list,
      META_TOOL_NAMES.describe,
      META_TOOL_NAMES.runRead,
    ]) {
      expect(
        listed.tools.find((tool) => tool.name === name)?.annotations,
        name,
      ).toMatchObject({ readOnlyHint: true });
    }
  });

  it('shows read-only credentials no write tools, and gives every tool its OAuth security scheme', async () => {
    const readOnly = await (await connect(['mcp:read'])).listTools();
    const readWrite = await (await connect(['mcp:read', 'mcp:write'])).listTools();
    const readOnlyAdvanced = textJson(
      await (await connect(['mcp:read'])).callTool({
        name: META_TOOL_NAMES.list,
        arguments: {},
      }),
    ) as Array<{ access: string }>;
    const coreReads = catalog.core.filter(({ mcp }) => mcp.access === 'read');

    expect(readOnly.tools.map(({ name }) => name).sort()).toEqual(
      [
        ...coreReads.map(({ name }) => name),
        META_TOOL_NAMES.list,
        META_TOOL_NAMES.describe,
        META_TOOL_NAMES.runRead,
      ].sort(),
    );
    expect(readOnly.tools.every(({ annotations }) => annotations?.readOnlyHint)).toBe(true);
    expect(readOnlyAdvanced.every(({ access }) => access === 'read')).toBe(true);
    expect(readWrite.tools).toHaveLength(CORE_TOOLS.length + 4);
    for (const tool of readWrite.tools) {
      const write = tool.annotations?.readOnlyHint === false;
      expect(tool._meta, tool.name).toEqual({
        securitySchemes: [
          {
            type: 'oauth2',
            scopes: write ? ['mcp:read', 'mcp:write'] : ['mcp:read'],
          },
        ],
      });
    }
  });

  it('keeps the listing within the token budget', async () => {
    const client = await connect();
    const listed = await client.listTools();

    const modelVisible = listed.tools.map(
      ({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema,
      }),
    );

    expect(JSON.stringify(modelVisible).length).toBeLessThanOrEqual(
      CORE_LISTING_BUDGET_CHARS,
    );
  });

  it('indexes exactly the advanced tools and filters by module and access', async () => {
    const client = await connect();

    const all = textJson(
      await client.callTool({ name: META_TOOL_NAMES.list, arguments: {} }),
    ) as Array<{ name: string; access: string; module: string }>;
    const billingWrites = textJson(
      await client.callTool({
        name: META_TOOL_NAMES.list,
        arguments: { module: 'billing', access: 'write' },
      }),
    ) as Array<{ name: string; access: string; module: string }>;

    expect(all.map(({ name }) => name).sort()).toEqual(
      catalog.advanced.map(({ name }) => name).sort(),
    );
    expect(Object.keys(all[0]!).sort()).toEqual([
      'access',
      'module',
      'name',
      'title',
    ]);
    expect(billingWrites.length).toBeGreaterThan(0);
    expect(
      billingWrites.every(
        ({ access, module }) => access === 'write' && module === 'billing',
      ),
    ).toBe(true);
  });

  it('describes every advanced tool', async () => {
    const client = await connect();
    const names = catalog.advanced.map(({ name }) => name);

    for (let index = 0; index < names.length; index += MAX_DESCRIBED_TOOLS) {
      const batch = names.slice(index, index + MAX_DESCRIBED_TOOLS);
      const result = await client.callTool({
        name: META_TOOL_NAMES.describe,
        arguments: { names: batch },
      });
      expect(result.isError, batch.join(', ')).toBeFalsy();
      const described = textJson(result) as Array<{
        name: string;
        inputSchema: JsonSchema;
      }>;
      expect(described.map(({ name }) => name)).toEqual(batch);
      for (const tool of described) {
        expect(tool.inputSchema.type, tool.name).toBe('object');
      }
    }
  });

  it('refuses hidden, core, unknown and wrong-access names in the runners', async () => {
    const client = await connect();
    const advancedRead = catalog.advanced.find(
      ({ mcp }) => mcp.access === 'read',
    )!;
    const advancedWrite = catalog.advanced.find(
      ({ mcp }) => mcp.access === 'write',
    )!;
    const cases: Array<[string, string, string]> = [
      [META_TOOL_NAMES.runRead, 'healthCheck', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runWrite, 'auth.setPassword', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runRead, 'school.listStudents', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runWrite, 'school.recordPayment', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runRead, 'school.noSuchTool', 'UNKNOWN_ADVANCED_TOOL'],
      [META_TOOL_NAMES.runRead, advancedWrite.name, 'WRONG_ACCESS_CLASS'],
      [META_TOOL_NAMES.runWrite, advancedRead.name, 'WRONG_ACCESS_CLASS'],
    ];

    for (const [runner, name, code] of cases) {
      const result = await client.callTool({
        name: runner,
        arguments: { name, arguments: {} },
      });
      expect(result.isError, `${runner} ${name}`).toBe(true);
      expect(textJson(result), `${runner} ${name}`).toMatchObject({ code });
    }
    const unknownDescribe = await client.callTool({
      name: META_TOOL_NAMES.describe,
      arguments: { names: ['healthCheck'] },
    });
    expect(textJson(unknownDescribe)).toMatchObject({
      code: 'UNKNOWN_ADVANCED_TOOL',
    });
  });

  it('runs an advanced tool through its runner with the normal procedure checks', async () => {
    const client = await connect();
    const advancedRead = catalog.advanced.find(
      ({ mcp }) => mcp.access === 'read',
    )!;

    const result = await client.callTool({
      name: META_TOOL_NAMES.runRead,
      arguments: { name: advancedRead.name, arguments: {} },
    });

    // The anonymous context reaches the procedure, whose own validation or
    // authentication middleware answers (never an internal error).
    expect(result.isError).toBe(true);
    expect(['BAD_REQUEST', 'UNAUTHORIZED']).toContain(textJson(result).code);
  });
});

function requiredProperties(schema: JsonSchema | undefined): string[] {
  return [...((schema?.required as string[] | undefined) ?? [])].sort();
}

/**
 * OpenAPI uses oRPC's converter and MCP uses Zod's; both must advertise an
 * object input with the same required properties for every procedure.
 */
describe('OpenAPI contract', () => {
  it('documents every procedure, with inputs matching the MCP input shapes', async () => {
    const generator = new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    });
    const document = await generator.generate(appRouter, {
      info: { title: 'CampusPilot API', version: '0.0.0' },
    });
    const operationFor = (name: string) =>
      document.paths?.[`/${name.split('.').join('/')}`]?.post;

    for (const name of leafNames) {
      expect(operationFor(name), `${name} is missing from OpenAPI`).toBeDefined();
    }
    for (const tool of exposedTools()) {
      const body = operationFor(tool.name)?.requestBody as
        | { content?: Record<string, { schema?: JsonSchema }> }
        | undefined;
      const openApiInput = body?.content?.['application/json']?.schema;
      if (!tool.acceptsInput) {
        expect(openApiInput, tool.name).toBeUndefined();
        continue;
      }
      expect(openApiInput?.type, tool.name).toBe('object');
      expect(requiredProperties(openApiInput), tool.name).toEqual(
        requiredProperties(tool.inputJsonSchema),
      );
    }
  });
});

const PATTERN_CANDIDATES = [
  '1',
  'INR',
  'a',
  '0',
  '10',
  '2026-04-01',
  '2026-04-01T09:30:00.000Z',
  '09:30',
  'user@example.com',
  '0'.repeat(64),
];

function sampleString(schema: JsonSchema): string {
  if (schema.format === 'date-time') return '2026-04-01T09:30:00.000Z';
  if (schema.format === 'date') return '2026-04-01';
  if (schema.format === 'email') return 'user@example.com';
  const minLength = (schema.minLength as number | undefined) ?? 1;
  const maxLength = (schema.maxLength as number | undefined) ?? Infinity;
  const fits = (value: string) =>
    value.length >= minLength && value.length <= maxLength;
  if (typeof schema.pattern === 'string') {
    const pattern = new RegExp(schema.pattern);
    const match = PATTERN_CANDIDATES.find(
      (value) => pattern.test(value) && fits(value),
    );
    if (!match) throw new Error(`No sample for pattern ${schema.pattern}`);
    return match;
  }
  return 'x'.repeat(Math.max(minLength, 1));
}

/**
 * Samples a number at its lower bound plus the property's position, so sibling
 * numbers such as a start and end year are distinct and ascending.
 */
function sampleNumber(schema: JsonSchema, ordinal: number): number {
  const minimum = schema.minimum as number | undefined;
  const exclusiveMinimum = schema.exclusiveMinimum as number | undefined;
  const maximum = (schema.maximum as number | undefined) ?? Infinity;
  const lowest =
    minimum ?? (exclusiveMinimum !== undefined ? exclusiveMinimum + 1 : 1);
  return Math.min(lowest + ordinal, maximum);
}

/**
 * Builds the smallest instance a client could produce from the advertised
 * JSON Schema: required properties only (plus the top-level optional ones when
 * `withOptional` is set), preferring declared examples, defaults, constants
 * and the first enum value or union member.
 */
function sampleFromJsonSchema(
  schema: JsonSchema,
  { withOptional = false, ordinal = 0 } = {},
): unknown {
  const examples = schema.examples as unknown[] | undefined;
  if (examples?.length) return examples[0];
  if ('const' in schema) return schema.const;
  if ('default' in schema) return schema.default;
  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues?.length) return enumValues[0];
  const union = (schema.oneOf ?? schema.anyOf) as JsonSchema[] | undefined;
  if (union?.length) {
    const member =
      union.find((option) => option.type !== 'null') ?? union[0]!;
    return sampleFromJsonSchema(member);
  }

  switch (schema.type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<
        string,
        JsonSchema
      >;
      // `{ not: {} }` is a field the contract forbids (z.never()).
      const keys = withOptional
        ? Object.keys(properties).filter((key) => !properties[key]?.not)
        : requiredProperties(schema);
      return Object.fromEntries(
        keys.map((key, index) => [
          key,
          sampleFromJsonSchema(properties[key] ?? {}, { ordinal: index }),
        ]),
      );
    }
    case 'array': {
      const count = (schema.minItems as number | undefined) ?? 0;
      return Array.from({ length: count }, (_, index) => {
        const item = sampleFromJsonSchema((schema.items ?? {}) as JsonSchema);
        // Distinct items keep uniqueness refinements satisfied.
        return typeof item === 'string' && count > 1 ? `${item}${index}` : item;
      });
    }
    case 'string':
      return sampleString(schema);
    case 'integer':
    case 'number':
      return sampleNumber(schema, ordinal);
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      throw new Error(`No sample for schema ${JSON.stringify(schema)}`);
  }
}

async function parsesSample(tool: McpToolDefinition, withOptional: boolean) {
  return tool.inputSchema.safeParseAsync(
    JSON.parse(
      JSON.stringify(sampleFromJsonSchema(tool.inputJsonSchema, { withOptional })),
    ),
  );
}

/**
 * Minimal instances with exactly one optional field added, for inputs that
 * need exactly one of several fields (for example an invitation by email or
 * by phone number).
 */
async function parsesWithOneOptional(tool: McpToolDefinition) {
  const schema = tool.inputJsonSchema;
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set(requiredProperties(schema));
  const minimal = sampleFromJsonSchema(schema) as Record<string, unknown>;
  for (const [index, key] of Object.keys(properties).entries()) {
    if (required.has(key) || properties[key]?.not) continue;
    const sample = { ...minimal, [key]: sampleFromJsonSchema(properties[key]!, { ordinal: index }) };
    const result = await tool.inputSchema.safeParseAsync(JSON.parse(JSON.stringify(sample)));
    if (result.success) return result;
  }
  return null;
}

/**
 * A contract the JSON side can express but Zod rejects would make a tool
 * uncallable. Each advertised schema's minimal instance must parse. Inputs
 * with cross-field rules JSON Schema cannot state (for example "provide at
 * least one field to update") are retried with their optional fields filled,
 * then with one optional field at a time ("exactly one of").
 */
describe('schema-sample round trip', () => {
  it('parses a minimal JSON-Schema instance with every MCP tool input', async () => {
    const failures: string[] = [];
    for (const tool of exposedTools()) {
      let result = await parsesSample(tool, false);
      if (!result.success) result = await parsesSample(tool, true);
      if (!result.success) result = (await parsesWithOneOptional(tool)) ?? result;
      if (!result.success) {
        failures.push(
          `${tool.name}: ${result.error.issues
            .map((issue) => `${issue.path.join('.')} ${issue.message}`)
            .join('; ')}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('assistant service view', () => {
  it('lists every tool the assistant policy allows, tagged, without meta tools', async () => {
    const client = await connect('assistant');
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    const allowed = exposedTools().filter((tool) => assistantToolDecision(tool.mcp).allowed);

    expect(names.sort()).toEqual(allowed.map((tool) => tool.name).sort());
    expect(names).not.toContain(META_TOOL_NAMES.list);
    expect(names.some((name) => name.startsWith('systemAdmin.'))).toBe(false);
    // Money tools are in scope; platform, account and unreviewed modules are not.
    expect(names).toContain('school.listPayments');
    expect(names).toContain('school.recordPayment');
    expect(names).toContain('school.createManualBill');
    expect(names).toContain('school.getDashboard');
    expect(
      allowed.filter((tool) =>
        ['platform', 'system', 'account', 'notices', 'notifications'].includes(tool.mcp.module),
      ),
    ).toEqual([]);
    const definitions = new Map(exposedTools().map((tool) => [tool.name, tool]));
    for (const tool of tools) {
      expect(tool._meta?.[ASSISTANT_TOOL_META.exposure]).toMatch(/^(core|advanced)$/);
      expect(typeof tool._meta?.[ASSISTANT_TOOL_META.module]).toBe('string');
      // Every school sees the same listing; the worker drops the tools of features its school lacks.
      expect(tool._meta?.[ASSISTANT_TOOL_META.features], tool.name).toEqual([...definitions.get(tool.name)!.features]);
      // And the kinds of school it serves, so a personal space is offered only the tools that serve it.
      expect(tool._meta?.[ASSISTANT_TOOL_META.schoolKinds], tool.name).toEqual([...definitions.get(tool.name)!.schoolKinds]);
    }
    // A school's quick papers and a personal space's papers share the standalone paper tools.
    expect(tools.find(({ name }) => name === 'school.listStandalonePapers')?._meta?.[ASSISTANT_TOOL_META.schoolKinds]).toEqual(['school', 'personal']);
    expect(tools.find(({ name }) => name === 'school.listStudents')?._meta?.[ASSISTANT_TOOL_META.schoolKinds]).toEqual(['school']);
    // Account-level tools name no school, so every kind of school is offered them.
    expect(tools.find(({ name }) => name === 'school.listMySchools')?._meta?.[ASSISTANT_TOOL_META.schoolKinds]).toEqual(['school', 'personal']);
    expect(tools.find(({ name }) => name === 'school.listAdmissions')?._meta?.[ASSISTANT_TOOL_META.features]).toEqual(['studentManagement']);
    expect(allowed.some((tool) => tool.mcp.exposure === 'advanced')).toBe(true);
  });

  it('tells the assistant how much of a result it may read only for the tools that declare it', async () => {
    const client = await connect('assistant');
    const { tools } = await client.listTools();
    const declared = Object.fromEntries(
      tools
        .filter((tool) => tool._meta?.[ASSISTANT_TOOL_META.outputChars] !== undefined)
        .map((tool) => [tool.name, tool._meta![ASSISTANT_TOOL_META.outputChars]]),
    );
    expect(declared).toEqual({
      'school.getQuestionPaper': 200_000,
      'school.getQuestionPaperDraft': 200_000,
      'school.validateQuestionPaperDraft': 40_000,
      'school.learn_question_paper_generation': 40_000,
      'school.getStandalonePaper': 200_000,
      'school.getStandalonePaperDraft': 200_000,
      'school.validateStandalonePaperDraft': 40_000,
      'school.learn_standalone_question_paper': 40_000,
    });
    // Procedures the assistant may not use are not listed at all.
    expect(tools.map((tool) => tool.name)).not.toContain('school.startQuestionPaperGeneration');
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['school.saveQuestionPaperVersion', 'school.listQuestionPapers']));
  });

  it('gives the in-app assistant the template editing reads, keeps template saves behind approval and withholds the PDF preview', () => {
    const byName = new Map(exposedTools().map((tool) => [tool.name, tool]));
    for (const name of ['school.learn_document_template_editing', 'school.validateDocumentTemplateDraft']) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.mcp.module).toBe('documents');
      expect(assistantToolDecision(tool!.mcp), name).toEqual({ allowed: true, requiresApproval: false });
    }
    // A save from the template editor's chat is the person's own (the editor's Save); any other save still asks.
    expect(assistantToolDecision(byName.get('school.saveDocumentTemplate')!.mcp)).toEqual({ allowed: true, requiresApproval: true });
    // One Gotenberg conversion per call: a person's preview only.
    expect(byName.has('school.previewDocumentTemplatePdf')).toBe(false);
    expect(byName.has('school.previewMarketplaceTemplatePdf')).toBe(false);
    expect(byName.has('school.previewDocumentTemplateRevisionPdf')).toBe(false);
    expect(byName.has('school.getDocumentTemplatePreviewContext')).toBe(false);
  });

  /** The question paper tools by name: what each is for, and how the in-app assistant and external clients reach it. */
  const QUESTION_PAPER_TOOLS = {
    reads: ['school.listQuestionPapers', 'school.getQuestionPaper', 'school.listQuestionPaperVersions', 'school.getQuestionPaperDraft', 'school.learn_question_paper_generation', 'school.validateQuestionPaperDraft'],
    writes: ['school.saveQuestionPaperVersion', 'school.editQuestionPaper'],
    // The UI's own procedures: a person does these, never the assistant.
    humanOnly: [
      'school.startQuestionPaperGeneration',
      'school.getQuestionPaperDetail',
      'school.rotateQuestionPaperPage',
      'school.getQuestionPaperPreview',
      'school.previewQuestionPaperDraft',
      'school.getQuestionPaperDownload',
      'school.listQuestionPaperCopySources',
      'school.copyQuestionPaperVersion',
    ],
  };

  it('gives the in-app assistant the question paper tools, the save without an approval card and the human-only ones withheld', async () => {
    const byName = new Map(exposedTools().map((tool) => [tool.name, tool]));
    for (const name of [...QUESTION_PAPER_TOOLS.reads, ...QUESTION_PAPER_TOOLS.writes]) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.mcp.module).toBe('exams');
      expect(assistantToolDecision(tool!.mcp), name).toMatchObject({ allowed: true });
    }
    // Saving only adds a version (the previous one stays), so the assistant saves without asking.
    for (const name of QUESTION_PAPER_TOOLS.writes) expect(assistantToolDecision(byName.get(name)!.mcp)).toEqual({ allowed: true, requiresApproval: false });
    for (const name of QUESTION_PAPER_TOOLS.reads) expect(assistantToolDecision(byName.get(name)!.mcp)).toEqual({ allowed: true, requiresApproval: false });
    for (const name of QUESTION_PAPER_TOOLS.humanOnly) expect(byName.has(name), name).toBe(false);

    const client = await connect('assistant');
    const { tools } = await client.listTools();
    const listed = new Map(tools.map((tool) => [tool.name, tool]));
    // The in-app assistant has no meta tools: the learn tool is simply one of its (deferred) tools.
    const learn = listed.get('school.learn_question_paper_generation');
    expect(learn?._meta?.[ASSISTANT_TOOL_META.exposure]).toBe('advanced');
    for (const name of [...QUESTION_PAPER_TOOLS.reads, ...QUESTION_PAPER_TOOLS.writes]) expect(listed.has(name), name).toBe(true);
    for (const name of QUESTION_PAPER_TOOLS.humanOnly) expect(listed.has(name), name).toBe(false);
    expect(tools.filter((tool) => tool._meta?.[ASSISTANT_TOOL_META.skipsApproval] !== undefined).map((tool) => [tool.name, tool._meta![ASSISTANT_TOOL_META.skipsApproval]]).sort()).toEqual([
      ['school.saveQuestionPaperVersion', true],
      ['school.editQuestionPaper', true],
      ['school.saveStandalonePaperVersion', true],
      ['school.editStandalonePaper', true],
    ].sort());
  });

  it('gives external clients the learn tool through the advanced tools', async () => {
    expect(catalog.advanced.map(({ name }) => name)).toEqual(expect.arrayContaining([...QUESTION_PAPER_TOOLS.reads, ...QUESTION_PAPER_TOOLS.writes]));
    expect(catalog.core.map(({ name }) => name)).not.toContain('school.learn_question_paper_generation');
    const client = await connect();
    const listed = textJson(await client.callTool({ name: META_TOOL_NAMES.list, arguments: {} })) as Array<{ name: string }>;
    expect(listed.map(({ name }) => name)).toContain('school.learn_question_paper_generation');
    const described = textJson(
      await client.callTool({ name: META_TOOL_NAMES.describe, arguments: { names: ['school.learn_question_paper_generation'] } }),
    ) as Array<{ name: string; inputSchema: JsonSchema }>;
    expect(described.map(({ name }) => name)).toEqual(['school.learn_question_paper_generation']);
    expect(described[0]!.inputSchema.type).toBe('object');
  });

  it('refuses an invalid outputChars declaration while the catalog is built', async () => {
    const { os } = await import('@orpc/server');
    const broken = os
      .meta({ mcp: { exposure: 'advanced', access: 'read', destructive: false, module: 'exams', outputChars: 0 } })
      .route({ summary: 'x', description: 'y' })
      .handler(() => 'ok');
    await expect(buildMcpCatalog({ broken })).rejects.toThrow(/invalid outputChars/);
  });

  it('refuses skipsApproval on a read or a destructive write while the catalog is built', async () => {
    for (const mcp of [
      { exposure: 'advanced', access: 'read', destructive: false, module: 'exams', skipsApproval: true },
      { exposure: 'advanced', access: 'write', destructive: true, module: 'exams', skipsApproval: true },
    ] as const) {
      const { os } = await import('@orpc/server');
      const broken = os.meta({ mcp }).route({ summary: 'x', description: 'y' }).handler(() => 'ok');
      await expect(buildMcpCatalog({ broken })).rejects.toThrow(/may only skip approval/);
    }
  });
});
