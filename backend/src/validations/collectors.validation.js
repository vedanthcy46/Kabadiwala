import { z } from 'zod';

export const registerCollectorSchema = {
  body: z.object({
    name: z.string({ required_error: 'Name is required' }).trim().min(2, 'Name must be at least 2 characters'),
    phone: z
      .string({ required_error: 'Phone number is required' })
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian phone number'),
    operating_location: z.string().trim().optional(),
    preferred_language: z.enum(['en', 'hi', 'mr', 'kn']).default('hi'),
  }),
};

export const loginCollectorSchema = {
  body: z.object({
    phone: z
      .string({ required_error: 'Phone number is required' })
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian phone number'),
  }),
};