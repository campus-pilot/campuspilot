/**
 * Object keys of a chat attachment. Everything lives under
 * `schools/{schoolId}/`, the prefix the demo purge sweeps. Defined here, not in
 * `@campuspilot/assistant`, because the worker's derivative job
 * (`process.ts`) writes the thumbnail and model copy and this package cannot
 * import the assistant's.
 */
export const assistantAttachmentKeys = {
  original: (schoolId: string, id: string, extension: string) =>
    `schools/${schoolId}/assistant/attachments/${id}/original.${extension}`,
  thumb: (schoolId: string, id: string) => `schools/${schoolId}/assistant/attachments/${id}/thumb.jpg`,
  model: (schoolId: string, id: string) => `schools/${schoolId}/assistant/attachments/${id}/model.jpg`,
} as const;
