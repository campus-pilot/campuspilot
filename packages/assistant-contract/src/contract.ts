import { eventIterator, oc } from '@orpc/contract';

import {
  assistantConversationInputSchema,
  assistantRunSchema,
  assistantSnapshotSchema,
  assistantStatusInputSchema,
  assistantStatusOutputSchema,
  assistantStreamEventSchema,
  listAssistantConversationsInputSchema,
  listAssistantConversationsOutputSchema,
  respondToAssistantApprovalInputSchema,
  sendAssistantMessageInputSchema,
  sendAssistantMessageOutputSchema,
  stopAssistantRunInputSchema,
} from './dto';

/**
 * The assistant service's public API, contract-first: apps/assistant
 * implements it and the management app calls it, and neither imports the
 * other. Every procedure is for the signed-in user in one school; the service
 * authenticates the user's session through the CampusPilot API.
 */
export const assistantContract = {
  getStatus: oc.input(assistantStatusInputSchema).output(assistantStatusOutputSchema),
  listConversations: oc
    .input(listAssistantConversationsInputSchema)
    .output(listAssistantConversationsOutputSchema),
  getConversation: oc.input(assistantConversationInputSchema).output(assistantSnapshotSchema),
  /**
   * A snapshot, then sequenced upserts and ephemeral text frames until the
   * client disconnects.
   */
  subscribeConversation: oc
    .input(assistantConversationInputSchema)
    .output(eventIterator(assistantStreamEventSchema)),
  sendMessage: oc
    .input(sendAssistantMessageInputSchema)
    .output(sendAssistantMessageOutputSchema),
  respondToApproval: oc
    .input(respondToAssistantApprovalInputSchema)
    .output(assistantRunSchema),
  stopRun: oc.input(stopAssistantRunInputSchema).output(assistantRunSchema),
};

export type AssistantContract = typeof assistantContract;
