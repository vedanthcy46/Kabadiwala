import { z } from 'zod';

export const VALID_MATERIAL_CATEGORIES = [
  'PCB', 'Battery', 'Cable',
  'Motor', 'Motor/Magnet Assembly', 'Motors',
  'LCD', 'LCD Panel', 'LCD Panels',
  'CRT', 'CRTs',
  'Plastic', 'Mixed Plastic', 'Plastics', 'Mixed Plastics',
];

const materialCategory = z.enum(VALID_MATERIAL_CATEGORIES);

export const createLotSchema = {
  body: z.object({
    collector_id: z.coerce.number().int().positive(),
    category: materialCategory,
    sub_category: z.string().optional(),
    description: z.string().optional(),
    image_ref: z.string().optional(),
    image_refs: z.array(z.string()).min(1).max(3).optional(),
    approx_weight_kg: z.coerce.number().positive('Weight must be positive'),
    condition: z.string().optional(),
    source_type: z.string().optional(),
    location: z.string().min(1, 'Location is required for valuation'),
    collection_lat: z.coerce.number().min(-90).max(90).optional(),
    collection_lng: z.coerce.number().min(-180).max(180).optional(),
    ai_feedback_id: z.coerce.number().int().positive().optional(),
  }),
};

export const initiateHandoverSchema = {
  body: z.object({
    lot_id: z.string().min(1, 'Lot ID is required'),
    collector_id: z.coerce.number().int().positive(),
    recycler_id: z.coerce.number().int().positive(),
    photo_refs: z.array(z.string()).optional().default([]),
    weight_kg: z.coerce.number().positive(),
    gps_lat: z.coerce.number().min(-90).max(90).optional(),
    gps_lng: z.coerce.number().min(-180).max(180).optional(),
    handover_location: z.string().optional(),
  }),
};

export const confirmHandoverSchema = {
  params: z.object({
    reference: z.string().min(1, 'Handover reference number is required'),
  }),
  body: z.object({
    recycler_id: z.coerce.number().int().positive(),
    final_weight_kg: z.coerce.number().positive('Final weight must be positive').optional(),
    gps_lat: z.coerce.number().min(-90).max(90).optional(),
    gps_lng: z.coerce.number().min(-180).max(180).optional(),
    verification_photo: z.string().optional(),
    scan_verified: z.boolean().optional(),
  }),
};

export const getHandoverSchema = {
  params: z.object({
    reference: z.string().min(1),
  }),
};

export const getHandoversByLotSchema = {
  params: z.object({
    lotId: z.string().min(1),
  }),
};

export const getLotsByRecyclerSchema = {
  params: z.object({
    recyclerId: z.coerce.number().int().positive(),
  }),
};

export const cancelLotSchema = {
  params: z.object({
    lotId: z.string().min(1, 'Lot ID is required'),
  }),
  body: z.object({
    collector_id: z.coerce.number().int().positive().optional(),
    reason: z.string().max(500, 'Reason must not exceed 500 characters').optional(),
  }).optional(),
};

