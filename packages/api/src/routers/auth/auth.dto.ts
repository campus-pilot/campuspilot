import { z } from 'zod';

export const setPasswordInputSchema = z.object({
  newPassword: z.string().min(8, 'Password must contain at least 8 characters.'),
});

export const setPasswordOutputSchema = z.object({
  success: z.literal(true),
});
