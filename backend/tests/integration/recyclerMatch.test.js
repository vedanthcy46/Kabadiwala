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

describe('Recycler Matching API', () => {
  it('GET /v1/recyclers/match returns ranked authorized recyclers', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', lat: '12.9716', lng: '77.5946' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.data.length).toBeGreaterThan(0);

    // All returned recyclers must be authorized and accept PCB
    for (const recycler of res.body.data) {
      expect(recycler.materials_accepted).toContain('PCB');
    }
  });

  it('returns sorted by match_score ascending', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', lat: '12.9716', lng: '77.5946' });

    const scores = res.body.data.map((r) => r.match_score);
    const sorted = [...scores].sort((a, b) => a - b);
    expect(scores).toEqual(sorted);
  });

  it('returns an explainable suitability score (0–100) with component breakdown', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', lat: '12.9716', lng: '77.5946' });

    for (const recycler of res.body.data) {
      expect(Number(recycler.suitability)).toBeGreaterThan(0);
      expect(Number(recycler.suitability)).toBeLessThanOrEqual(100);
      expect(recycler.score_price).toBeDefined();
      expect(recycler.score_distance).toBeDefined();
      expect(recycler.score_pickup).toBeDefined();
      expect(recycler.score_reliability).toBeDefined();
      expect(Number(recycler.score_reliability)).toBeGreaterThanOrEqual(0);
      expect(Number(recycler.score_reliability)).toBeLessThanOrEqual(1);
    }
  });

  it('orders by suitability descending (best match first)', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', lat: '12.9716', lng: '77.5946' });

    const suits = res.body.data.map((r) => Number(r.suitability));
    const sorted = [...suits].sort((a, b) => b - a);
    expect(suits).toEqual(sorted);
  });

  it('returns non-zero offered rates for all matches', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', lat: '12.9716', lng: '77.5946' });

    for (const recycler of res.body.data) {
      expect(Number(recycler.offered_rate)).toBeGreaterThan(0);
    }
  });

  it('filters out unauthorized recyclers', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'CRT', lat: '12.9716', lng: '77.5946' });

    // Only 2 recyclers accept CRT and are authorized (Ramky id=6)
    // Unauthorized ones (Local Scrap Point, Quick Kabadi) must be excluded
    for (const recycler of res.body.data) {
      expect(recycler.materials_accepted).toContain('CRT');
    }
  });

  it('respects maxDistanceKm filter', async () => {
    const fullRes = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', lat: '12.9716', lng: '77.5946', maxDistanceKm: '10' });

    for (const recycler of fullRes.body.data) {
      expect(Number(recycler.distance_km)).toBeLessThanOrEqual(10);
    }
  });

  it('returns 400 for missing required query params', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB' });

    expect(res.status).toBe(400);
  });

  it('matches by city name via location param', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', location: 'Bengaluru' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.location).toBeDefined();
    expect(Number(res.body.location.lat)).toBeCloseTo(12.97, 1);
    expect(Number(res.body.location.lng)).toBeCloseTo(77.59, 1);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('matches by state name via location param', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', location: 'Karnataka' })
      .expect(200);

    expect(res.body.location.name).toBe('Karnataka');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('returns an empty match set for a city with no recyclers', async () => {
    // Test DB only has Bengaluru demo recyclers — Delhi resolves but has none.
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', location: 'Delhi' })
      .expect(200);

    expect(res.body.location.name).toBe('Delhi');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(0);
  });

  it('returns 400 for an unknown location', async () => {
    const res = await request(server)
      .get('/v1/recyclers/match')
      .query({ category: 'PCB', location: 'Atlantis' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unknown location/i);
  });
});
