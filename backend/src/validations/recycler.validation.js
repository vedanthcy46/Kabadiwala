import { z } from 'zod';

export const matchRecyclersSchema = {
  query: z.object({
    category: z.string({ required_error: 'Material category is required' }),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    maxDistanceKm: z.coerce.number().positive().optional().default(50),
    location: z.string().optional(),
  }).superRefine((q, ctx) => {
    const hasCoords = q.lat !== undefined && q.lng !== undefined;
    if (!hasCoords && !q.location) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['location'],
        message: 'Provide either a location (city/state) or both lat and lng for matching',
      });
    }
  }),
};
