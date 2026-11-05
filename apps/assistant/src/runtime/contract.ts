import { env } from '@campuspilot/env/assistant';
import {
  connectRestateIngress,
  rpc,
  type Ingress,
  type VirtualObjectDefinition,
} from '@campuspilot/restate/connect';

/**
 * The Restate virtual object that runs assistant turns: one object per
 * conversation, keyed by conversation id. Restate runs its exclusive handler
 * one invocation at a time, so a message sent while a run is active queues
 * behind it, and an awakeable lets a run wait for approval without holding
 * a process.
 */
export const ASSISTANT_CONVERSATION_OBJECT = 'assistantConversation';

export type ProcessRunInput = {
  runId: string;
  /** The requesting user as their session showed them, for the prompt. */
  user: { name: string; email: string };
};

/** How a paused tool call resumes: the user's decision, or a stop. */
export type ApprovalResolution = { decision: 'approve' | 'decline' | 'cancel' };

export type AssistantConversationHandlers = {
  processRun: (ctx: unknown, input: ProcessRunInput) => Promise<void>;
};

const definition: VirtualObjectDefinition<
  typeof ASSISTANT_CONVERSATION_OBJECT,
  AssistantConversationHandlers
> = { name: ASSISTANT_CONVERSATION_OBJECT };

let ingress: Ingress | undefined;
const getIngress = () => (ingress ??= connectRestateIngress(env.RESTATE_INGRESS_URL));

export type RunDispatcher = {
  /** Starts a queued run; idempotent per run id. */
  startRun: (input: { conversationId: string } & ProcessRunInput) => Promise<void>;
  resolveApproval: (input: { awakeableId: string; resolution: ApprovalResolution }) => Promise<void>;
};

export const restateDispatcher: RunDispatcher = {
  async startRun({ conversationId, ...input }) {
    await getIngress()
      .objectSendClient(definition, conversationId)
      .processRun(input, rpc.sendOpts({ idempotencyKey: input.runId }));
  },
  async resolveApproval({ awakeableId, resolution }) {
    await getIngress().resolveAwakeable(awakeableId, resolution);
  },
};
