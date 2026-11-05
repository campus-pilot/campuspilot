/**
 * Facts shared by the CampusPilot API and the assistant service about how
 * they talk to each other.
 */

/** Header the assistant service sends its service secret in. */
export const ASSISTANT_SERVICE_SECRET_HEADER = 'x-campuspilot-assistant-secret';

/** `_meta` keys the API's assistant MCP view adds to each tool. */
export const ASSISTANT_TOOL_META = {
  exposure: 'campuspilot/exposure',
  module: 'campuspilot/module',
} as const;
