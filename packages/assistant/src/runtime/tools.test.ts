import { ASSISTANT_TOOL_META } from '@campuspilot/assistant-contract/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mcp = vi.hoisted(() => ({
  tools: [] as Array<Record<string, unknown>>,
  result: '' as string,
}));
vi.mock('@campuspilot/env/assistant', () => ({ env: { CAMPUSPILOT_MCP_URL: 'http://localhost/mcp' } }));
vi.mock('@modelcontextprotocol/client', () => ({
  StreamableHTTPClientTransport: class {},
  Client: class {
    async connect() {}
    async close() {}
    async listTools() {
      return { tools: mcp.tools };
    }
    async callTool() {
      return { isError: false, content: [{ type: 'text', text: mcp.result }] };
    }
  },
}));

import { catalogOf, mcpTool } from '../testing/turn';
import { callTool, loadToolCatalog, requiresApproval, toolCatalogForSchool } from './tools';

const listed = (name: string, meta: Record<string, unknown> = {}) => ({
  name,
  title: name,
  description: name,
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
  _meta: { [ASSISTANT_TOOL_META.exposure]: 'advanced', [ASSISTANT_TOOL_META.module]: 'exams', ...meta },
});

describe('tool output limits', () => {
  beforeEach(() => {
    mcp.tools = [
      listed('school.listThings', { [ASSISTANT_TOOL_META.features]: ['studentManagement'] }),
      listed('school.getQuestionPaper', { [ASSISTANT_TOOL_META.outputChars]: 80_000 }),
    ];
  });

  it('reads the declared outputChars of a tool from its metadata, and nothing for the others', async () => {
    const { tools } = await loadToolCatalog('token');
    expect(tools.get('school_getQuestionPaper')?.outputChars).toBe(80_000);
    expect(tools.get('school_listThings')?.outputChars).toBeUndefined();
  });

  it('cuts a result at the default 24,000 characters unless the tool declared more', async () => {
    const { tools } = await loadToolCatalog('token');
    mcp.result = 'x'.repeat(50_000);

    const ordinary = await callTool('token', tools.get('school_listThings')!, {});
    expect(ordinary.ok && ordinary.modelContent.startsWith('x'.repeat(24_000) + '…')).toBe(true);
    expect(ordinary.ok && ordinary.modelContent).toContain('[Result truncated');

    const whole = await callTool('token', tools.get('school_getQuestionPaper')!, {});
    expect(whole.ok && whole.modelContent).toBe('x'.repeat(50_000));
    // The stored and displayed result stays short either way.
    expect(whole.ok && whole.storedOutput.length).toBe(4_001);
    expect(whole.ok && whole.outputTruncated).toBe(true);
  });

  it('still cuts a result larger than the tool declared', async () => {
    const { tools } = await loadToolCatalog('token');
    mcp.result = 'y'.repeat(90_000);
    const outcome = await callTool('token', tools.get('school_getQuestionPaper')!, {});
    expect(outcome.ok && outcome.modelContent.startsWith('y'.repeat(80_000) + '…')).toBe(true);
    expect(outcome.ok && outcome.modelContent).toContain('[Result truncated');
  });
});

describe('tools of a school', () => {
  it('reads the features a tool is gated on from its metadata', async () => {
    mcp.tools = [
      listed('school.listThings', { [ASSISTANT_TOOL_META.features]: ['studentManagement'] }),
      listed('school.getQuestionPaper', { [ASSISTANT_TOOL_META.outputChars]: 80_000 }),
    ];
    const { tools } = await loadToolCatalog('token');
    expect(tools.get('school_listThings')?.features).toEqual(['studentManagement']);
    expect(tools.get('school_getQuestionPaper')?.features).toEqual([]);
  });

  it('leaves out the tools of a feature the school does not have, keeping order', () => {
    const students = mcpTool('school.listStudents', 'read', { features: ['studentManagement'] });
    const notices = mcpTool('school.listNotices', 'read', { features: ['notices'] });
    const papers = mcpTool('school.listQuestionPapers', 'read');
    const catalog = catalogOf(students, papers, notices);

    const staffOnly = toolCatalogForSchool(catalog, new Set(['assistant']), 'school');
    expect(staffOnly.ordered.map(({ mcpName }) => mcpName)).toEqual(['school.listQuestionPapers']);
    expect(staffOnly.tools.has('school_listStudents')).toBe(false);
    // The features that took a tool away: what the model is told about.
    expect([...staffOnly.withheldFeatures].sort()).toEqual(['notices', 'studentManagement']);

    const everything = toolCatalogForSchool(catalog, new Set(['studentManagement', 'notices', 'assistant']), 'school');
    expect(everything.ordered.map(({ mcpName }) => mcpName)).toEqual(['school.listStudents', 'school.listQuestionPapers', 'school.listNotices']);
    expect([...everything.withheldFeatures]).toEqual([]);
  });

  it('does not count a missing feature that gates none of the tools', () => {
    // The assistant has no notice tools: a school without notices loses nothing, so nothing is withheld.
    const catalog = catalogOf(mcpTool('school.listStudents', 'read', { features: ['studentManagement'] }), mcpTool('school.listQuestionPapers', 'read'));
    expect([...toolCatalogForSchool(catalog, new Set(['studentManagement']), 'school').withheldFeatures]).toEqual([]);
  });
});

describe('tools of a kind of school', () => {
  it('reads the kinds a tool serves from its metadata, real schools only when it names none', async () => {
    mcp.tools = [
      listed('school.listStandalonePapers', { [ASSISTANT_TOOL_META.schoolKinds]: ['personal'] }),
      listed('school.listStudents', {}),
    ];
    const { tools } = await loadToolCatalog('token');
    expect(tools.get('school_listStandalonePapers')?.schoolKinds).toEqual(['personal']);
    expect(tools.get('school_listStudents')?.schoolKinds).toEqual(['school']);
  });

  it('offers a personal space only its own tools, and a real school never those', () => {
    const students = mcpTool('school.listStudents', 'read');
    const standalone = mcpTool('school.listStandalonePapers', 'read', { schoolKinds: ['personal'] });
    const both = mcpTool('school.getFeatureFlags', 'read', { schoolKinds: ['school', 'personal'] });
    const catalog = catalogOf(students, standalone, both);
    expect(toolCatalogForSchool(catalog, new Set(['assistant']), 'personal').ordered.map(({ mcpName }) => mcpName)).toEqual([
      'school.listStandalonePapers',
      'school.getFeatureFlags',
    ]);
    expect(toolCatalogForSchool(catalog, new Set(['assistant']), 'school').ordered.map(({ mcpName }) => mcpName)).toEqual([
      'school.listStudents',
      'school.getFeatureFlags',
    ]);
  });
});

describe('approval', () => {
  it('asks for every write except one the API lists as skipping approval, and never for a read', async () => {
    mcp.tools = [
      listed('school.getQuestionPaper'),
      { ...listed('school.saveQuestionPaperVersion', { [ASSISTANT_TOOL_META.skipsApproval]: true }), annotations: { readOnlyHint: false } },
      { ...listed('school.updateStudent'), annotations: { readOnlyHint: false } },
    ];
    // Past the listing cache the tests above filled; this block is last so its own listing stays out of theirs.
    vi.useFakeTimers({ now: Date.now() + 10 * 60_000, toFake: ['Date'] });
    const { tools } = await loadToolCatalog('token').finally(() => vi.useRealTimers());
    expect(requiresApproval(tools.get('school_getQuestionPaper')!)).toBe(false);
    expect(requiresApproval(tools.get('school_saveQuestionPaperVersion')!)).toBe(false);
    expect(requiresApproval(tools.get('school_updateStudent')!)).toBe(true);
  });
});
