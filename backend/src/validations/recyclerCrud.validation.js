import { z } from 'zod';

export const VALID_MATERIAL_ITEMS = [
  'PCB', 'Battery', 'Cable',
  'Motor', 'Motor/Magnet Assembly', 'Motors',
  'LCD', 'LCD Panel', 'LCD Panels',
  'CRT', 'CRTs',
  'Plastic', 'Mixed Plastic', 'Plastics', 'Mixed Plastics',
];

const materialsAcceptedItem = z.enum(VALID_MATERIAL_ITEMS);

export const createRecyclerSchema = {
  body: z.object({
    name: z.coerce.string().min(1, 'Recycler name is required'),
    facility_location: z.coerce.string().optional(),
    facility_address: z.coerce.string().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    location_accuracy: z.coerce.number().optional(),
    location_source: z.coerce.string().optional(),
    materials_accepted: z.array(materialsAcceptedItem).min(1, 'At least one material category required'),
    authorization_status: z.enum(['authorized', 'unauthorized', 'pending']).default('pending'),
    authorization_details: z.coerce.string().optional(),
    authorization_number: z.coerce.string().optional(),
    authorization_issue_date: z.coerce.string().optional(),
    authorization_valid_until: z.coerce.string().optional(),
    authorization_document_url: z.coerce.string().optional(),
    verification_source: z.coerce.string().optional(),
    contact_details: z.coerce.string().optional(),
    profile_image: z.coerce.string().optional(),
    image_ref: z.coerce.string().optional(),
    pickup_availability: z.enum(['daily', 'weekly', 'on_request']).optional(),
    service_area: z.coerce.string().optional(),
  }),
};

export const onboardRecyclerSchema = {
  body: z.object({
    name: z.coerce.string().min(1, 'Company name is required'),
    facility_location: z.coerce.string().optional(),
    facility_address: z.coerce.string().optional(),
    latitude: z.coerce.number().min(-90).max(90, 'Valid latitude is required'),
    longitude: z.coerce.number().min(-180).max(180, 'Valid longitude is required'),
    location_accuracy: z.coerce.number().optional(),
    location_source: z.coerce.string().optional(),
    materials_accepted: z.array(materialsAcceptedItem).min(1, 'At least one material category required'),
    authorization_number: z.coerce.string().optional(),
    authorization_issue_date: z.coerce.string().optional(),
    authorization_valid_until: z.coerce.string().optional(),
    authorization_document_url: z.coerce.string().optional(),
    authorization_details: z.coerce.string().optional(),
    contact_details: z.coerce.string().optional(),
    profile_image: z.coerce.string().optional(),
    image_ref: z.coerce.string().optional(),
    pickup_availability: z.enum(['daily', 'weekly', 'on_request']).optional(),
    service_area: z.coerce.string().optional(),
  }),
};

export const loginRecyclerSchema = {
  body: z.object({
    recycler_id: z.coerce.number().int().positive(),
  }),
};

export const updateRecyclerSchema = {
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    name: z.coerce.string().min(1).optional(),
    facility_location: z.coerce.string().optional(),
    facility_address: z.coerce.string().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    location_accuracy: z.coerce.number().optional(),
    location_source: z.coerce.string().optional(),
    materials_accepted: z.array(materialsAcceptedItem).min(1).optional(),
    authorization_status: z.enum(['authorized', 'unauthorized', 'pending']).optional(),
    authorization_details: z.coerce.string().optional(),
    authorization_number: z.coerce.string().optional(),
    verification_source: z.coerce.string().optional(),
    contact_details: z.coerce.string().optional(),
    profile_image: z.coerce.string().optional(),
    image_ref: z.coerce.string().optional(),
    pickup_availability: z.enum(['daily', 'weekly', 'on_request']).optional(),
    service_area: z.coerce.string().optional(),
  }),
};

export const getRecyclerSchema = {
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
};

export const listRecyclersSchema = {
  query: z.object({
    authorization_status: z.enum(['authorized', 'unauthorized', 'pending']).optional(),
    material: z.string().optional(),
    location: z.string().optional(),
    name: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(1000).default(20),
  }),
};
