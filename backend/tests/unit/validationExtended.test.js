import { describe, it, expect } from 'vitest';
import {
  createRecyclerSchema,
  updateRecyclerSchema,
  listRecyclersSchema,
} from '../../src/validations/recyclerCrud.validation.js';
import { syncBatchSchema } from '../../src/validations/sync.validation.js';
import { checkTransactionSchema } from '../../src/validations/anomaly.validation.js';
import { updatePaymentSchema } from '../../src/validations/payment.validation.js';
import { bulkUpsertPricesSchema } from '../../src/validations/priceIngest.validation.js';

describe('Recycler CRUD Validation', () => {
  describe('createRecyclerSchema', () => {
    const schema = createRecyclerSchema.body;

    it('accepts valid recycler data with standard and frontend material IDs', () => {
      const result = schema.safeParse({
        name: 'Test Recycler',
        materials_accepted: ['PCB', 'Battery', 'Cable', 'Motor', 'LCD', 'CRT', 'Plastic'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid recycler data with legacy long material names', () => {
      const result = schema.safeParse({
        name: 'Test Recycler',
        materials_accepted: ['Motor/Magnet Assembly', 'LCD Panel', 'Mixed Plastic'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts all fields', () => {
      const result = schema.safeParse({
        name: 'Test Recycler',
        facility_location: 'Bengaluru',
        latitude: 12.97,
        longitude: 77.59,
        materials_accepted: ['PCB', 'Battery'],
        authorization_status: 'authorized',
        authorization_details: 'CPCB Authorized',
        contact_details: '+91-80-1234567',
        pickup_availability: 'daily',
        service_area: 'Bengaluru Metro',
      });
      expect(result.success).toBe(true);
    });

    it('defaults authorization_status to pending', () => {
      const result = schema.safeParse({
        name: 'Test',
        materials_accepted: ['PCB'],
      });
      expect(result.success).toBe(true);
      expect(result.data.authorization_status).toBe('pending');
    });

    it('rejects empty name', () => {
      const result = schema.safeParse({
        name: '',
        materials_accepted: ['PCB'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty materials_accepted', () => {
      const result = schema.safeParse({
        name: 'Test',
        materials_accepted: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid material category', () => {
      const result = schema.safeParse({
        name: 'Test',
        materials_accepted: ['InvalidMaterial'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid authorization_status', () => {
      const result = schema.safeParse({
        name: 'Test',
        materials_accepted: ['PCB'],
        authorization_status: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateRecyclerSchema', () => {
    const schema = updateRecyclerSchema.body;

    it('accepts partial updates', () => {
      const result = schema.safeParse({ name: 'Updated Name' });
      expect(result.success).toBe(true);
    });

    it('accepts materials_accepted update', () => {
      const result = schema.safeParse({ materials_accepted: ['PCB', 'Cable'] });
      expect(result.success).toBe(true);
    });
  });

  describe('listRecyclersSchema', () => {
    const schema = listRecyclersSchema.query;

    it('accepts empty query', () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    });

    it('accepts filters', () => {
      const result = schema.safeParse({
        authorization_status: 'authorized',
        material: 'PCB',
        page: '2',
        limit: '10',
      });
      expect(result.success).toBe(true);
      expect(result.data.page).toBe(2);
    });

    it('rejects limit > 1000', () => {
      const result = schema.safeParse({ limit: '1001' });
      expect(result.success).toBe(false);
    });
  });
});

describe('Sync Batch Validation', () => {
  const schema = syncBatchSchema.body;

  it('accepts valid lot record batch', () => {
    const result = schema.safeParse({
      records: [{
        client_id: 'cli-001',
        type: 'lot',
        collector_id: 1,
        category: 'PCB',
        approx_weight_kg: 5,
        location: 'Bengaluru',
      }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid handover record batch', () => {
    const result = schema.safeParse({
      records: [{
        client_id: 'cli-002',
        type: 'handover',
        lot_id: 'LOT-001',
        collector_id: 1,
        recycler_id: 1,
        weight_kg: 5,
        gps_lat: 12.97,
        gps_lng: 77.59,
      }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts mixed batch', () => {
    const result = schema.safeParse({
      records: [
        { client_id: 'a', type: 'lot', collector_id: 1, category: 'PCB', approx_weight_kg: 5, location: 'Bengaluru' },
        { client_id: 'b', type: 'handover', lot_id: 'X', collector_id: 1, recycler_id: 1, weight_kg: 5, gps_lat: 12, gps_lng: 77 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty records array', () => {
    const result = schema.safeParse({ records: [] });
    expect(result.success).toBe(false);
  });

  it('rejects batch > 50 records', () => {
    const records = Array.from({ length: 51 }, (_, i) => ({
      client_id: `c${i}`,
      type: 'lot',
      collector_id: 1,
      category: 'PCB',
      approx_weight_kg: 1,
      location: 'Bengaluru',
    }));
    const result = schema.safeParse({ records });
    expect(result.success).toBe(false);
  });

  it('rejects record without client_id', () => {
    const result = schema.safeParse({
      records: [{
        type: 'lot',
        collector_id: 1,
        category: 'PCB',
        approx_weight_kg: 5,
        location: 'Bengaluru',
      }],
    });
    expect(result.success).toBe(false);
  });
});

describe('Anomaly Detection Validation', () => {
  const schema = checkTransactionSchema.body;

  it('accepts valid anomaly check data', () => {
    const result = schema.safeParse({
      lot_id: 'LOT-001',
      material_category: 'PCB',
      quoted_price: 1000,
      weight_kg: 5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional final_price and recycler_id', () => {
    const result = schema.safeParse({
      lot_id: 'LOT-001',
      material_category: 'PCB',
      quoted_price: 1000,
      final_price: 950,
      weight_kg: 5,
      recycler_id: 1,
      location: 'Bengaluru',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative quoted_price', () => {
    const result = schema.safeParse({
      lot_id: 'LOT-001',
      material_category: 'PCB',
      quoted_price: -100,
      weight_kg: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe('Payment Validation', () => {
  describe('updatePaymentSchema', () => {
    const schema = updatePaymentSchema.body;

    it('accepts valid payment update', () => {
      const result = schema.safeParse({ payment_status: 'paid', final_price: 500 });
      expect(result.success).toBe(true);
    });

    it('accepts pending status', () => {
      const result = schema.safeParse({ payment_status: 'pending' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid payment_status', () => {
      const result = schema.safeParse({ payment_status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects negative final_price', () => {
      const result = schema.safeParse({ payment_status: 'paid', final_price: -100 });
      expect(result.success).toBe(false);
    });
  });
});

describe('Bulk Price Ingestion Validation', () => {
  const schema = bulkUpsertPricesSchema.body;

  it('accepts valid bulk price data', () => {
    const result = schema.safeParse({
      location: 'Bengaluru',
      prices: [{ material_category: 'PCB', buying_price: 250 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts recycler_id', () => {
    const result = schema.safeParse({
      recycler_id: 1,
      location: 'Bengaluru',
      prices: [{ material_category: 'PCB', buying_price: 250 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty prices array', () => {
    const result = schema.safeParse({
      location: 'Bengaluru',
      prices: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects > 100 prices', () => {
    const prices = Array.from({ length: 101 }, () => ({
      material_category: 'PCB',
      buying_price: 100,
    }));
    const result = schema.safeParse({ location: 'Bengaluru', prices });
    expect(result.success).toBe(false);
  });

  it('rejects negative buying_price', () => {
    const result = schema.safeParse({
      location: 'Bengaluru',
      prices: [{ material_category: 'PCB', buying_price: -100 }],
    });
    expect(result.success).toBe(false);
  });
});
