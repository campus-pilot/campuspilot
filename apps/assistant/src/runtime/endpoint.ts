import Anthropic from '@anthropic-ai/sdk';
import { env } from '@campuspilot/env/assistant';
import * as restate from '@restatedev/restate-sdk';

import { log } from '../log';
import { createAssistantConversationObject } from './conversation';

/**
 * Registers this service's Restate endpoint. `force` replaces the previous
 * registration at the same URL, which is what redeploying that address
 * means; in-flight runs continue on the new code.
 */
async function registerDeployment(serviceUrl: string) {
  const response = await fetch(new URL('/deployments', env.RESTATE_ADMIN_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: serviceUrl, force: true }),
  });
  if (!response.ok) {
    throw new Error(
      `Restate deployment registration failed (${response.status}): ${await response.text()}`,
    );
  }
  log.info({ serviceUrl }, 'assistant.restate.registered');
}

/** Serves the conversation object to Restate; returns the bound port. */
export async function startRestateEndpoint(): Promise<number> {
  const conversationObject = createAssistantConversationObject({
    client: env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null,
    model: env.ASSISTANT_MODEL,
    log,
  });
  const port = await restate.serve({
    services: [conversationObject],
    port: env.RESTATE_SERVICE_PORT,
  });
  if (env.RESTATE_SERVICE_URL) await registerDeployment(env.RESTATE_SERVICE_URL);
  if (!env.ANTHROPIC_API_KEY) log.warn('assistant.not-configured');
  return port;
}
