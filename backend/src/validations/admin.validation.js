import { z } from 'zod';

export const adminLoginSchema = {
  body: z.object({
    code: z.string().min(1, 'Admin code is required'),
  }),
};

export const verifyRecyclerSchema = {
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    decision: z.enum(['authorized', 'unauthorized']),
    verification_source: z.string().optional(),
    rejection_reason: z.string().optional(),
  }),
};