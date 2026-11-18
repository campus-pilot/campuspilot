/**
 * Facts shared by the CampusPilot API's MCP endpoint and the assistant's
 * turn loop about how they talk to each other.
 */

/** `_meta` keys the API's assistant MCP view adds to each tool. */
export const ASSISTANT_TOOL_META = {
  exposure: 'campuspilot/exposure',
  module: 'campuspilot/module',
  /** Present only on tools that declare `outputChars` in their MCP metadata. */
  outputChars: 'campuspilot/output-chars',
  /** `true` only on writes that declare `skipsApproval`: the assistant runs them without the approval card. */
  skipsApproval: 'campuspilot/skips-approval',
  /**
   * The school features the tool's procedure is gated on (a list of feature
   * keys, possibly empty). The assistant offers a tool only while its
   * conversation's school has all of them.
   */
  features: 'campuspilot/features',
} as const;

/**
 * Tool calls the chat renders as a card instead of folding them under the
 * work bar (design G5). The key is the tool's MCP name, which is what a
 * `tool_call` item stores as `toolName`.
 */
export const ASSISTANT_CARD_TOOLS = {
  'school.validateQuestionPaperDraft': 'question_paper_draft',
} as const;
export type AssistantCardKind = (typeof ASSISTANT_CARD_TOOLS)[keyof typeof ASSISTANT_CARD_TOOLS];

/** The card a tool call renders as, or null for an ordinary tool call. */
export function assistantCardOf(toolName: string): AssistantCardKind | null {
  return (ASSISTANT_CARD_TOOLS as Record<string, AssistantCardKind>)[toolName] ?? null;
}
