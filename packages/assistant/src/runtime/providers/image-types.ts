import type { ModelProviderId } from './types';

/**
 * Image media types each provider can read as input. Kept apart from the
 * adapters so the API process can check a message's attachments (decision
 * D46: a type the conversation's provider cannot read is refused before any
 * cost) without loading a provider SDK.
 *
 * The Claude API reads neither HEIC nor HEIF. Gemini reads both.
 */
export const ANTHROPIC_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const GEMINI_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;

export function imageMimeTypesOf(provider: ModelProviderId): readonly string[] {
  return provider === 'anthropic' ? ANTHROPIC_IMAGE_MIME_TYPES : GEMINI_IMAGE_MIME_TYPES;
}
