import { describe, expect, it, vi } from 'vitest';

/**
 * The worker refuses to start when a provider is configured but it cannot
 * reach the API's MCP endpoint: every turn would fail.
 */
const assistantEnv = vi.hoisted(() => ({ env: { CAMPUSPILOT_MCP_URL: undefined as string | undefined, ASSISTANT_DIAGNOSTICS: false, NODE_ENV: 'test' } }));
vi.mock('@campuspilot/env/assistant', () => assistantEnv);
vi.mock('./runtime/providers/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime/providers/config')>()),
  configuredProviderSettings: () => new Map([['gemini', { id: 'gemini' }]]),
}));
vi.mock('./runtime/providers/registry', () => ({
  providerRegistry: () => ({ current: null, unavailableReason: 'test', get: () => null, prices: () => null }),
}));

const { createAssistantWorkerServices } = await import('./worker');

describe('createAssistantWorkerServices', () => {
  it('refuses to start without CAMPUSPILOT_MCP_URL while a provider is configured', () => {
    assistantEnv.env.CAMPUSPILOT_MCP_URL = undefined;
    expect(() => createAssistantWorkerServices()).toThrow(/CAMPUSPILOT_MCP_URL is required/);
  });

  it('serves the control service and the conversation object once it can reach the API', () => {
    assistantEnv.env.CAMPUSPILOT_MCP_URL = 'http://api.invalid/mcp';
    const services = createAssistantWorkerServices();
    expect(services.map((service) => service.name)).toEqual(['AssistantControl', 'assistantConversation']);
  });
});
