import { z } from 'zod';

export const getSchoolLogoInputSchema = z.object({
  schoolId: z.string().min(1),
});

export const getSchoolLogoOutputSchema = z.object({
  url: z.url(),
});
