import type { ModelProviderId } from './types';

/**
 * Input media types each provider can read, per attachment kind. Kept apart
 * from the adapters so the API process can check a message's attachments
 * (decision D46: a type the conversation's provider cannot read is refused
 * before any cost) without loading a provider SDK. Each list is explicit per
 * provider; nothing is derived from another provider's list.
 *
 * Images: the Claude API reads neither HEIC nor HEIF. Gemini reads both.
 *
 * Documents: both read a PDF natively, as the PDF itself.
 * - Claude: a `document` content block with a base64 `application/pdf` source
 *   (`BetaRequestDocumentBlock` / `BetaBase64PDFSource` in @anthropic-ai/sdk
 *   1.7.0; https://platform.claude.com/docs/en/build-with-claude/pdf-support).
 * - Gemini: a part with `inlineData` of type `application/pdf` (`Part.inlineData`
 *   in @google/genai 2.32.0; https://ai.google.dev/gemini-api/docs/document-processing).
 */
export const ANTHROPIC_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const GEMINI_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export const ANTHROPIC_DOCUMENT_MIME_TYPES = ['application/pdf'] as const;
export const GEMINI_DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

/** What a provider reads, per attachment kind. */
export type ReadableMimeTypes = { image: readonly string[]; document: readonly string[] };

export function imageMimeTypesOf(provider: ModelProviderId): readonly string[] {
  return provider === 'anthropic' ? ANTHROPIC_IMAGE_MIME_TYPES : GEMINI_IMAGE_MIME_TYPES;
}

export function documentMimeTypesOf(provider: ModelProviderId): readonly string[] {
  return provider === 'anthropic' ? ANTHROPIC_DOCUMENT_MIME_TYPES : GEMINI_DOCUMENT_MIME_TYPES;
}

/** Both lists of a provider, as the send check and the attachment loader take them. */
export const readableMimeTypesOf = (provider: ModelProviderId): ReadableMimeTypes => ({
  image: imageMimeTypesOf(provider),
  document: documentMimeTypesOf(provider),
});
