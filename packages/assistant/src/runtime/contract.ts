/**
 * The Restate virtual object that runs assistant turns, in `apps/worker`: one
 * object per conversation, keyed by conversation id. Restate runs its
 * exclusive handler one invocation at a time, so a message sent while a run
 * is active queues behind it, and an awakeable lets a run wait for approval
 * without holding a process. The object is private to Restate ingress: only
 * the signed `AssistantControl` service (control.ts) starts a turn.
 */
export const ASSISTANT_CONVERSATION_OBJECT = 'assistantConversation';

export type ProcessRunInput = {
  runId: string;
  /** The requesting user, for the prompt (read from the user's account when the run is handed over). */
  user: { name: string; email: string };
};

/** How a paused tool call resumes: the user's decision, or a stop. */
export type ApprovalResolution = { decision: 'approve' | 'decline' | 'cancel' };

export type AssistantConversationHandlers = {
  processRun: (ctx: unknown, input: ProcessRunInput) => Promise<void>;
};
