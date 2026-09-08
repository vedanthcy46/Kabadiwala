import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { pool } from '../../src/db.js';
import { resetAndSeed } from '../helpers/db.js';

let server;
let createdLotId;
let handoverReference;

beforeAll(async () => {
  await resetAndSeed();
  return new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

describe('Handover & Traceability API', () => {
  it('POST /v1/handover/lots creates a lot with instant valuation', async () => {
    const res = await request(server)
      .post('/v1/handover/lots')
      .send({
        collector_id: 1,
        category: 'PCB',
        approx_weight_kg: 4.0,
        location: 'Bengaluru',
        description: 'Test lot',
        image_ref: '/img/collection-evidence.jpg',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.lot.lot_id).toBeDefined();
    expect(res.body.data.estimated_value).toBeGreaterThan(0);
    createdLotId = res.body.data.lot.lot_id;
  });

  it('POST /v1/handover/initiate creates a handover with unique reference', async () => {
    // A physical pickup is now only possible after the collector accepts a
    // recycler's price. This mirrors the production state machine.
    const quote = await request(server)
      .post('/v1/quotes/request')
      .send({ lot_id: createdLotId, recycler_id: 1 })
      .expect(201);
    await request(server)
      .post(`/v1/quotes/${quote.body.data.id}/respond`)
      .send({ offered_price: 240 })
      .expect(200);
    await request(server)
      .post(`/v1/quotes/${quote.body.data.id}/accept`)
      .expect(200);

    const res = await request(server)
      .post('/v1/handover/initiate')
      .send({
        lot_id: createdLotId,
        collector_id: 1,
        recycler_id: 1,
        photo_refs: ['/img/test1.jpg'],
        weight_kg: 4.0,
        gps_lat: 12.97,
        gps_lng: 77.59,
        handover_location: 'Bengaluru',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.handover_reference_number).toMatch(/^HO-/);
    expect(res.body.data.recycler.name).toBe('Trishyirya Recycling India Pvt. Ltd.');
    handoverReference = res.body.data.handover_reference_number;
  });

  it('POST /v1/handover/initiate rejects unauthorized recycler', async () => {
    const res = await request(server)
      .post('/v1/handover/initiate')
      .send({
        lot_id: createdLotId,
        collector_id: 1,
        recycler_id: 9999,
        weight_kg: 4.0,
        gps_lat: 12.97,
        gps_lng: 77.59,
      });

    expect(res.status).toBe(404);
  });

  it('GET /v1/handover/:reference returns handover details', async () => {
    const res = await request(server)
      .get(`/v1/handover/${handoverReference}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.handover_reference_number).toBe(handoverReference);
    expect(res.body.data.status).toBe('pending_confirmation');
    expect(res.body.data.category).toBe('PCB');
  });

  it('POST /v1/handover/confirm/:reference confirms by recycler', async () => {
    const res = await request(server)
      .post(`/v1/handover/confirm/${handoverReference}`)
      .send({
        recycler_id: 1,
        final_weight_kg: 3.9,
        gps_lat: 12.9715,
        gps_lng: 77.5946,
        verification_photo: '/img/verify-1.jpg',
        scan_verified: true,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.recycler_confirmation).toBe(true);
    expect(res.body.data.confirmation_timestamp).toBeDefined();
    expect(Number(res.body.data.weight_kg)).toBe(3.9);
    expect(Number(res.body.data.gps_lat)).toBe(12.9715);
    expect(res.body.data.scan_verified).toBe(true);
  });

  it('POST /v1/handover/confirm/:reference records final weight on the transaction', async () => {
    const res = await request(server)
      .get('/v1/handover/lot/' + createdLotId)
      .expect(200);

    const record = res.body.data.find(h => h.handover_reference === handoverReference);
    expect(record).toBeDefined();
    expect(Number(record.weight_kg)).toBe(3.9);
  });

  it('POST /v1/handover/confirm/:reference rejects re-confirmation', async () => {
    const res = await request(server)
      .post(`/v1/handover/confirm/${handoverReference}`)
      .send({ recycler_id: 1 });

    expect(res.status).toBe(400);
  });

  it('GET /v1/handover/lot/:lotId returns handovers for a lot', async () => {
    const res = await request(server)
      .get(`/v1/handover/lot/${createdLotId}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/handover/lots/collector/:collectorId returns collector lots', async () => {
    const res = await request(server)
      .get('/v1/handover/lots/collector/1')
      .expect(200);

    expect(res.body.success).toBe(true);
    for (const lot of res.body.data) {
      expect(lot.collector_id).toBe(1);
    }
  });

  it('GET /v1/handover/lots/recycler/:recyclerId returns lots assigned to the recycler', async () => {
    const res = await request(server)
      .get('/v1/handover/lots/recycler/3')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Every returned lot must be assigned to recycler 3
    for (const lot of res.body.data) {
      expect(lot.transaction_status).toBe('matched');
    }
  });

  it('GET /v1/handover/lots/recycler/:recyclerId returns pending-confirmation ref', async () => {
    // LOT-2026-0002 (recycler 3) has a pending_confirmation traceability record
    const res = await request(server).get('/v1/handover/lots/recycler/3').expect(200);

    const lot = res.body.data.find(l => l.lot_id === 'LOT-2026-0002');
    expect(lot).toBeDefined();
    expect(lot.handover_reference_number).toBe('HOV-2026-K1L2M3');
    expect(lot.traceability_status).toBe('pending_confirmation');
    expect(lot.confirmation_timestamp).toBeNull();
  });

  it('GET /v1/handover/lots/recycler/:recyclerId rejects invalid id', async () => {
    const res = await request(server).get('/v1/handover/lots/recycler/abc');
    expect(res.status).toBe(400);
  });

  it('GET /v1/handover/:reference returns 404 for unknown reference', async () => {
    const res = await request(server).get('/v1/handover/UNKNOWN-REF');
    expect(res.status).toBe(404);
  });

  it('GET /v1/handover/lot/:lotId returns immutable collection evidence', async () => {
    const res = await request(server)
      .get(`/v1/handover/lot/${createdLotId}`)
      .expect(200);

    const record = res.body.data.find(h => h.handover_reference === handoverReference);
    expect(record).toBeDefined();
    // Collection weight + original photo + timestamp must survive confirmation untouched
    expect(Number(record.approx_weight_kg)).toBe(4);
    expect(record.collection_image).toBeDefined();
    expect(record.lot_created_at).toBeDefined();
    expect(record.transaction_status).toBe('handed_over');
  });

  it('GET /v1/handover/:reference returns collection evidence too', async () => {
    const res = await request(server).get(`/v1/handover/${handoverReference}`).expect(200);

    expect(res.body.data.approx_weight_kg).toBeDefined();
    expect(res.body.data.collection_image).toBeDefined();
    expect(res.body.data.scan_verified).toBe(true);
  });

  it('POST /v1/handover/lots rejects invalid collector id', async () => {
    // A collector id that no longer exists should fail cleanly (404), not
    // leak a raw foreign-key 500 (stale session after a DB reset).
    const res = await request(server)
      .post('/v1/handover/lots')
      .send({
        collector_id: 999,
        category: 'PCB',
        approx_weight_kg: 4,
        location: 'Bengaluru',
      });

    expect(res.status).toBe(404);
  });

  it('POST /v1/handover/lots rejects invalid category', async () => {
    const res = await request(server)
      .post('/v1/handover/lots')
      .send({
        collector_id: 1,
        category: 'Invalid',
        approx_weight_kg: 4,
        location: 'Bengaluru',
      });

    expect(res.status).toBe(400);
  });
});
