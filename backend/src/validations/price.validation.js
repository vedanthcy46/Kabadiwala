import { z } from 'zod';

export const getPriceTrendSchema = {
  query: z.object({
    category: z.string({ required_error: 'Material category is required' }),
    location: z.string({ required_error: 'Location is required' }),
    days: z.coerce.number().int().positive().optional().default(30),
  }),
};
