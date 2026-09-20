import { z } from 'zod';

export const profileImageOutputSchema = z.object({
  profileImageS3Key: z.string(),
});

export type ProfileImageOutput = z.infer<typeof profileImageOutputSchema>;
