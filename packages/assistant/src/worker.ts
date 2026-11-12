import { resolveAssistantAccess } from '@campuspilot/api/assistant/access';
import { env } from '@campuspilot/env/assistant';

import { loadAttachmentFile } from './attachments';
import { assistantControlService } from './control';
import { db } from './db';
import { log } from './log';
import { createAssistantConversationObject, type RunAccessCheck } from './runtime/conversation';
import { configuredProviderSettings } from './runtime/providers/config';
import { providerRegistry } from './runtime/providers/registry';

/**
 * The assistant's Restate services, for `apps/worker` to serve: the signed
 * `AssistantControl` service (the only one reachable through ingress) and the
 * `assistantConversation` object that runs turns.
 *
 * Refuses to start when a provider is configured but the worker cannot reach
 * the API's MCP endpoint (`CAMPUSPILOT_MCP_URL`): every turn would fail. With
 * no provider configured the services are still served, so turns that are
 * already queued end with a clear "not configured" failure instead of
 * waiting in Restate.
 */
export function createAssistantWorkerServices() {
  const configured = [...configuredProviderSettings().keys()];
  if (configured.length > 0 && !env.CAMPUSPILOT_MCP_URL) {
    throw new Error(
      `CAMPUSPILOT_MCP_URL is required while an assistant provider is configured (${configured.join(', ')}): the assistant reaches school data only through the API's MCP endpoint.`,
    );
  }
  const providers = providerRegistry();
  if (providers.current) {
    log.info({ provider: providers.current.id, model: providers.current.model }, 'assistant.provider');
  } else {
    log.warn({ reason: providers.unavailableReason }, 'assistant.not-configured');
  }
  if (env.ASSISTANT_DIAGNOSTICS && env.NODE_ENV === 'production') {
    // Every user of this deployment sees token counts, cost and raw errors.
    log.warn('assistant.diagnostics.on-in-production');
  }
  const checkAccess: RunAccessCheck = async (input) => {
    const decision = await resolveAssistantAccess(db, input);
    return decision.refusal ? { allowed: false, ...decision.refusal } : { allowed: true };
  };
  return [assistantControlService, createAssistantConversationObject({ providers, log, checkAccess, loadAttachment: loadAttachmentFile })] as const;
}
