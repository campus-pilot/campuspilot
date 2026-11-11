/**
 * Facts shared by the CampusPilot API's MCP endpoint and the assistant's
 * turn loop about how they talk to each other.
 */

/** `_meta` keys the API's assistant MCP view adds to each tool. */
export const ASSISTANT_TOOL_META = {
  exposure: 'campuspilot/exposure',
  module: 'campuspilot/module',
} as const;
