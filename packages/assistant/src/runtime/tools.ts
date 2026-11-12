import { ASSISTANT_TOOL_META } from '@campuspilot/assistant-contract/protocol';
import {
  SHOW_VIEW_TOOL_DESCRIPTION,
  SHOW_VIEW_TOOL_NAME,
  showViewInputSchema,
} from '@campuspilot/assistant-contract/views';
import { z } from 'zod';
import { env } from '@campuspilot/env/assistant';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

/**
 * CampusPilot tools, reached only through the API's MCP endpoint with the
 * run's delegated token. The API decides which tools the assistant sees
 * (its assistant view) and enforces every rule again on each call; this
 * module only adapts them for the model and adds the assistant's own
 * behaviour: which calls wait for the user's approval.
 */

/**
 * Model-facing tool names. The Claude API allows only `[a-zA-Z0-9_-]` and MCP
 * names use dots, so dots become underscores; Gemini accepts the same names.
 */
export const toModelToolName = (mcpName: string) => mcpName.replaceAll('.', '_');

/** Characters of a tool result the model reads; longer results are cut. */
const MODEL_OUTPUT_LIMIT = 24_000;
/** Characters of a tool result stored on the visible item. */
const STORED_OUTPUT_LIMIT = 4_000;

export type AssistantTool = {
  /**
   * `mcp`: a CampusPilot procedure, run through the API's MCP endpoint.
   * `local`: handled by the assistant itself (showing a view); it changes
   * nothing and reaches nothing.
   */
  source: 'mcp' | 'local';
  modelName: string;
  mcpName: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** From the MCP `readOnlyHint` annotation. */
  readOnly: boolean;
  /** From the MCP `destructiveHint` annotation. */
  destructive: boolean;
  /** `core` tools are loaded up front, the rest through tool search. */
  exposure: string;
  module: string;
  /**
   * How many characters of this tool's result the model reads, when the
   * procedure declares it (`outputChars`); the default limit applies
   * otherwise.
   */
  outputChars?: number;
};

export type AssistantToolCatalog = {
  tools: ReadonlyMap<string, AssistantTool>;
  /** Every tool in the API's stable listing order, for model requests. */
  ordered: readonly AssistantTool[];
};

/**
 * Approval policy: every write waits for the user's explicit decision; reads
 * run immediately. One function so a finer policy changes exactly here.
 */
export function requiresApproval(tool: AssistantTool): boolean {
  return tool.source === 'mcp' && !tool.readOnly;
}

/** The display tool: always loaded, so the model can show views from the start. */
const SHOW_VIEW_TOOL: AssistantTool = {
  source: 'local',
  modelName: SHOW_VIEW_TOOL_NAME,
  mcpName: SHOW_VIEW_TOOL_NAME,
  title: 'Show a view',
  description: SHOW_VIEW_TOOL_DESCRIPTION,
  inputSchema: (() => {
    const { $schema: _dialect, ...schema } = z.toJSONSchema(showViewInputSchema, { io: 'input' });
    return schema as Record<string, unknown>;
  })(),
  readOnly: true,
  destructive: false,
  exposure: 'core',
  module: 'assistant',
};

/**
 * The API's MCP endpoint as the worker reaches it. The worker refuses to
 * start without it while a provider is configured (`apps/worker`), so a
 * missing value here is a deployment error, reported as such.
 */
function mcpUrl(): URL {
  if (!env.CAMPUSPILOT_MCP_URL) throw new Error('CAMPUSPILOT_MCP_URL is not set, so the assistant cannot reach CampusPilot.');
  return new URL(env.CAMPUSPILOT_MCP_URL);
}

async function withMcpClient<T>(token: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'campuspilot-assistant', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(mcpUrl(), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

/** The description every provider shows the model for a tool. */
export function modelToolDescription(tool: AssistantTool): string {
  const approval = requiresApproval(tool)
    ? '\n\nThis changes school data. When you call it, the user is asked to approve it before it runs.'
    : '';
  return `${tool.title}. ${tool.description}${approval}`;
}

/**
 * The assistant view is the same for every assistant token (the API filters
 * it by policy, not by user; OPA decides per call), so one listing serves
 * every run for a while. A stable catalog also keeps prompt caches warm.
 * How tools reach the model (deferred, searched, all at once) is each
 * provider adapter's choice.
 */
const CATALOG_TTL_MS = 5 * 60_000;
let cached: { catalog: AssistantToolCatalog; until: number } | null = null;

export async function loadToolCatalog(token: string): Promise<AssistantToolCatalog> {
  if (cached && cached.until > Date.now()) return cached.catalog;

  const listed = await withMcpClient(token, async (client) => {
    const all: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      all.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return all;
  });

  const tools = new Map<string, AssistantTool>([[SHOW_VIEW_TOOL.modelName, SHOW_VIEW_TOOL]]);
  const ordered: AssistantTool[] = [SHOW_VIEW_TOOL];
  for (const listedTool of listed) {
    const meta = (listedTool._meta ?? {}) as Record<string, unknown>;
    const tool: AssistantTool = {
      source: 'mcp',
      modelName: toModelToolName(listedTool.name),
      mcpName: listedTool.name,
      title: listedTool.title ?? listedTool.name,
      description: listedTool.description ?? '',
      inputSchema: listedTool.inputSchema as Record<string, unknown>,
      // Fails closed: a tool that does not say it is read-only is a write.
      readOnly: listedTool.annotations?.readOnlyHint === true,
      destructive: listedTool.annotations?.destructiveHint === true,
      exposure: String(meta[ASSISTANT_TOOL_META.exposure] ?? 'advanced'),
      module: String(meta[ASSISTANT_TOOL_META.module] ?? 'unknown'),
      ...(typeof meta[ASSISTANT_TOOL_META.outputChars] === 'number'
        ? { outputChars: meta[ASSISTANT_TOOL_META.outputChars] as number }
        : {}),
    };
    if (tools.has(tool.modelName)) {
      throw new Error(`Assistant tool name collision: ${tool.modelName}.`);
    }
    tools.set(tool.modelName, tool);
    ordered.push(tool);
  }

  const catalog = { tools, ordered };
  cached = { catalog, until: Date.now() + CATALOG_TTL_MS };
  return catalog;
}

export type ToolError = { code: string; message: string };

export type ToolOutcome =
  | {
      ok: true;
      /** The whole result. Only for code that parses it; never stored or journaled. */
      text: string;
      /** The result as the model reads it, cut at the tool's `outputChars` (`MODEL_OUTPUT_LIMIT` by default). */
      modelContent: string;
      /** The result as shown on the item, cut at `STORED_OUTPUT_LIMIT`. */
      storedOutput: string;
      outputTruncated: boolean;
    }
  | { ok: false; error: ToolError };

function truncate(text: string, limit: number) {
  return text.length > limit
    ? { text: `${text.slice(0, limit)}…`, truncated: true }
    : { text, truncated: false };
}

function parseError(text: string): ToolError {
  try {
    const parsed = JSON.parse(text) as Partial<ToolError>;
    if (typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      return { code: parsed.code, message: parsed.message };
    }
  } catch {
    // Not a CampusPilot error payload.
  }
  return { code: 'TOOL_ERROR', message: text.slice(0, 500) };
}

/**
 * Calls one tool as the run's user. Failures come back as outcomes, never as
 * throws, except when the API cannot be reached at all, which the caller's
 * durable step may retry.
 */
export async function callTool(
  token: string,
  tool: AssistantTool,
  input: unknown,
): Promise<ToolOutcome> {
  const result = await withMcpClient(token, (client) =>
    client.callTool({
      name: tool.mcpName,
      arguments: (input ?? {}) as Record<string, unknown>,
    }),
  );
  const text = (result.content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('\n');
  if (result.isError) return { ok: false, error: parseError(text) };

  const forModel = truncate(text, tool.outputChars ?? MODEL_OUTPUT_LIMIT);
  const stored = truncate(text, STORED_OUTPUT_LIMIT);
  return {
    ok: true,
    text,
    modelContent: forModel.truncated
      ? `${forModel.text}\n[Result truncated; request a narrower page or filter.]`
      : forModel.text,
    storedOutput: stored.text,
    outputTruncated: stored.truncated,
  };
}
