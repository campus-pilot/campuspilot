import { eventIterator, oc } from '@orpc/contract';

import {
  assistantConversationInputSchema,
  assistantRunSchema,
  assistantSnapshotSchema,
  assistantStatusInputSchema,
  assistantStatusOutputSchema,
  assistantStreamEventSchema,
  deleteAssistantConversationOutputSchema,
  listAssistantConversationsInputSchema,
  listAssistantConversationsOutputSchema,
  listPaperConversationsInputSchema,
  listPaperConversationsOutputSchema,
  respondToAssistantApprovalInputSchema,
  sendAssistantMessageInputSchema,
  sendAssistantMessageOutputSchema,
  stopAssistantRunInputSchema,
  subscribeAssistantConversationInputSchema,
} from './dto';

/**
 * The assistant's browser API, contract-first: `packages/assistant`
 * implements it (served by the API server at `/model/rpc`) and the
 * management app calls it, and neither imports the other. Every procedure is
 * for the signed-in user in one school, authenticated by their CampusPilot
 * session.
 */
export const assistantContract = {
  getStatus: oc.input(assistantStatusInputSchema).output(assistantStatusOutputSchema),
  listConversations: oc
    .input(listAssistantConversationsInputSchema)
    .output(listAssistantConversationsOutputSchema),
  /**
   * The conversations shared with one question paper, newest first, whoever
   * started them: the paper's chat history. For people who may manage the
   * class's question papers.
   */
  listPaperConversations: oc
    .input(listPaperConversationsInputSchema)
    .output(listPaperConversationsOutputSchema),
  getConversation: oc.input(assistantConversationInputSchema).output(assistantSnapshotSchema),
  /**
   * A snapshot, then sequenced upserts and ephemeral text frames until the
   * client disconnects.
   */
  subscribeConversation: oc
    .input(subscribeAssistantConversationInputSchema)
    .output(eventIterator(assistantStreamEventSchema)),
  sendMessage: oc
    .input(sendAssistantMessageInputSchema)
    .output(sendAssistantMessageOutputSchema),
  respondToApproval: oc
    .input(respondToAssistantApprovalInputSchema)
    .output(assistantRunSchema),
  stopRun: oc.input(stopAssistantRunInputSchema).output(assistantRunSchema),
  /**
   * Deletes one of the user's conversations for good, with its messages,
   * runs, approvals and transcript. Refused while the conversation has a
   * run that has not finished: the assistant must be stopped first.
   */
  deleteConversation: oc
    .input(assistantConversationInputSchema)
    .output(deleteAssistantConversationOutputSchema),
};

export type AssistantContract = typeof assistantContract;
