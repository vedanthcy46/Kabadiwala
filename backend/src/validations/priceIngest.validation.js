import { z } from 'zod';

export const VALID_MATERIAL_CATEGORIES = [
  'PCB', 'Battery', 'Cable',
  'Motor', 'Motor/Magnet Assembly', 'Motors',
  'LCD', 'LCD Panel', 'LCD Panels',
  'CRT', 'CRTs',
  'Plastic', 'Mixed Plastic', 'Plastics', 'Mixed Plastics',
];

const materialCategory = z.enum(VALID_MATERIAL_CATEGORIES);

export const bulkUpsertPricesSchema = {
  body: z.object({
    recycler_id: z.coerce.number().int().positive().optional(),
    location: z.string().min(1, 'Location is required'),
    prices: z.array(z.object({
      material_category: materialCategory,
      buying_price: z.coerce.number().positive('Buying price must be positive'),
      quoted_price: z.coerce.number().positive().optional(),
      unit: z.string().default('per_kg'),
      market_range_low: z.coerce.number().optional(),
      market_range_high: z.coerce.number().optional(),
    })).min(1, 'At least one price record required').max(100, 'Max 100 records per request'),
  }),
};

export const getRecyclerRatesSchema = {
  params: z.object({
    recyclerId: z.coerce.number().int().positive(),
  }),
};

export const getRecyclerRateBoardSchema = {
  query: z.object({
    category: materialCategory,
    location: z.string().min(1).default('Bengaluru'),
  }),
};
