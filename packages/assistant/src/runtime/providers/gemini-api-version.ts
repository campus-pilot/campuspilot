/**
 * The Gemini API version every client of this package uses. `@google/genai` 3
 * defaults to `v1`, but the Live API (voice), context caching and the
 * Decisions API are served only on `v1beta`, and the models are configured by
 * name from the environment, so one version for every client keeps a model
 * that one client can reach reachable from the others.
 */
export const GEMINI_API_VERSION = 'v1beta';
