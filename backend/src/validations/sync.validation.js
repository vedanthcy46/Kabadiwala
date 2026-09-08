import { z } from 'zod';

export const VALID_MATERIAL_CATEGORIES = [
  'PCB', 'Battery', 'Cable',
  'Motor', 'Motor/Magnet Assembly', 'Motors',
  'LCD', 'LCD Panel', 'LCD Panels',
  'CRT', 'CRTs',
  'Plastic', 'Mixed Plastic', 'Plastics', 'Mixed Plastics',
];

const materialCategory = z.enum(VALID_MATERIAL_CATEGORIES);

const lotRecord = z.object({
  client_id: z.string().min(1, 'Client-generated ID required for dedup'),
  type: z.literal('lot'),
  collector_id: z.coerce.number().int().positive(),
  category: materialCategory,
  sub_category: z.string().optional(),
  description: z.string().optional(),
  image_ref: z.string().optional(),
  approx_weight_kg: z.coerce.number().positive(),
  condition: z.string().optional(),
  source_type: z.string().optional(),
  location: z.string().min(1),
  created_offline_at: z.string().optional(),
});

const handoverRecord = z.object({
  client_id: z.string().min(1, 'Client-generated ID required for dedup'),
  type: z.literal('handover'),
  lot_id: z.string().min(1),
  collector_id: z.coerce.number().int().positive(),
  recycler_id: z.coerce.number().int().positive(),
  photo_refs: z.array(z.string()).optional().default([]),
  weight_kg: z.coerce.number().positive(),
  gps_lat: z.coerce.number().min(-90).max(90),
  gps_lng: z.coerce.number().min(-180).max(180),
  handover_location: z.string().optional(),
  created_offline_at: z.string().optional(),
});

export const syncBatchSchema = {
  body: z.object({
    records: z.array(z.union([lotRecord, handoverRecord])).min(1).max(50, 'Max 50 records per batch'),
  }),
};
