import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { pool } from '../../src/db.js';
import { resetAndSeed } from '../helpers/db.js';

let server;

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

describe('Payment Status API', () => {
  it('GET /v1/payments/earnings/:collectorId returns summary', async () => {
    const res = await request(server)
      .get('/v1/payments/earnings/1')
      .expect(200);

    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.total_earned).toBeDefined();
    expect(data.total_paid).toBeDefined();
    expect(data.total_pending).toBeDefined();
    expect(data.total_transactions).toBeGreaterThan(0);
  });

  it('GET /v1/payments/earnings balance consistency', async () => {
    const res = await request(server)
      .get('/v1/payments/earnings/1')
      .expect(200);

    const { total_earned, total_paid, total_pending } = res.body.data;
    // total_earned should equal paid + pending (for seed data all finalized)
    expect(Math.abs(total_earned - (total_paid + total_pending))).toBeLessThan(0.01);
  });

  it('GET /v1/payments/history/:collectorId returns transactions', async () => {
    const res = await request(server)
      .get('/v1/payments/history/1')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('PATCH /v1/payments/:lotId updates payment status', async () => {
    // Payment is allowed only after the recycler confirms handover.
    // LOT-2026-0002 is 'matched' & 'pending' with a pending_confirmation
    // traceability record (HOV-2026-K1L2M3, recycler 3) — confirm it first.
    await request(server)
      .post('/v1/handover/confirm/HOV-2026-K1L2M3')
      .send({ recycler_id: 3 })
      .expect(200);

    const res = await request(server)
      .patch('/v1/payments/LOT-2026-0002')
      .send({ payment_status: 'paid', final_price: 220, payment_method: 'cash' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.payment_status).toBe('paid');
    expect(Number(res.body.data.final_price)).toBe(220);
    expect(res.body.data.payment_method).toBe('cash');
  });

  it('PATCH /v1/payments/:lotId rejects payment before handover confirmation', async () => {
    // LOT-2026-0001 is still 'quoted' — payment must be blocked.
    const res = await request(server)
      .patch('/v1/payments/LOT-2026-0001')
      .send({ payment_status: 'paid', final_price: 100, payment_method: 'cash' });

    expect(res.status).toBe(409);
  });

  it('PATCH /v1/payments/:lotId records UPI/bank method', async () => {
    const res = await request(server)
      .patch('/v1/payments/LOT-2026-0003')
      .send({ payment_status: 'paid', payment_method: 'upi' })
      .expect(200);

    expect(res.body.data.payment_method).toBe('upi');
  });

  it('PATCH /v1/payments/:lotId rejects invalid payment method', async () => {
    const res = await request(server)
      .patch('/v1/payments/LOT-2026-0001')
      .send({ payment_status: 'paid', payment_method: 'gold_coins' });

    expect(res.status).toBe(400);
  });

  it('PATCH /v1/payments/:lotId returns 404 for unknown lot', async () => {
    const res = await request(server)
      .patch('/v1/payments/UNKNOWN-LOT')
      .send({ payment_status: 'paid' });

    expect(res.status).toBe(404);
  });

  it('PATCH /v1/payments/:lotId rejects invalid payment status', async () => {
    const res = await request(server)
      .patch('/v1/payments/LOT-2026-0001')
      .send({ payment_status: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('PATCH /v1/payments/:lotId rejects negative final_price', async () => {
    const res = await request(server)
      .patch('/v1/payments/LOT-2026-0001')
      .send({ payment_status: 'paid', final_price: -100 });

    expect(res.status).toBe(400);
  });
});
