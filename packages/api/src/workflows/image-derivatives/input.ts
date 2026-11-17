import { z } from 'zod';

import { IMAGE_DERIVATIVE_TARGETS } from './constants';

/** The input of `ImageDerivativeControl.makeDerivatives`: which row's image to process, nothing else. */
export const imageDerivativeInputSchema = z.object({
  target: z.enum(IMAGE_DERIVATIVE_TARGETS),
  id: z.string().regex(/^(qpg|asat)_[a-z0-9]{21}$/),
});
export type ImageDerivativeInput = z.infer<typeof imageDerivativeInputSchema>;
