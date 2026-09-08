import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { pool } from '../../src/db.js';
import { resetAndSeed } from '../helpers/db.js';

let server;
let createdSampleId = null;

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

const PCB_FEATURES = {
  meanLum: 0.31, meanSat: 0.28, satVar: 0.22, edge: 0.31,
  darkFrac: 0.27, brightFrac: 0.05, q75: 0.45,
  green: 0.34, blue: 0.11, copper: 0.14, red: 0.12,
  purple: 0.02, neutral: 0.18,
};

describe('AI dataset governance + inference API', () => {
  describe('POST /v1/ai/classify', () => {
    it('scores a feature vector with the heuristic model (consistent with on-device classifier)', async () => {
      const res = await request(server)
        .post('/v1/ai/classify')
        .send({ features: PCB_FEATURES })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.category).toBe('PCB');
      expect(res.body.data.provider).toBe('heuristic-server');
      expect(Number(res.body.data.confidence)).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(res.body.data.verdict);
      expect(res.body.data.candidates.length).toBeGreaterThan(0);
    });

    it('rejects a request without features when no cloud endpoint is configured', async () => {
      const res = await request(server)
        .post('/v1/ai/classify')
        .send({ imageUrl: 'https://example.com/pcb.jpg' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/ai/dataset/summary', () => {
    it('returns totals + per-category breakdown + trend', async () => {
      const post = await request(server)
        .post('/v1/ai/feedback')
        .send({
          collector_id: 1,
          ai_predicted_category: 'PCB',
          ai_confidence: 0.94,
          ai_verdict: 'high',
          ai_candidates: [{ category: 'PCB', confidence: 0.94 }],
          ai_features: PCB_FEATURES,
          outcome: 'pending',
        })
        .expect(201);
      createdSampleId = post.body.data.id;

      const res = await request(server).get('/v1/ai/dataset/summary').expect(200);

      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.totals.samples).toBe('number');
      expect(Array.isArray(res.body.data.categories)).toBe(true);
      expect(Array.isArray(res.body.data.trend)).toBe(true);
      expect(res.body.data.categories).toContainEqual(
        expect.objectContaining({ category: 'PCB' })
      );
    });
  });

  describe('GET /v1/ai/dataset/samples', () => {
    it('returns the labelled rows (ordered newest first) with pagination', async () => {
      const res = await request(server)
        .get('/v1/ai/dataset/samples?category=PCB&limit=10')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.samples)).toBe(true);
      expect(res.body.data.pagination.limit).toBe(10);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(1);
      for (const s of res.body.data.samples) {
        expect(s.ai_predicted_category).toBe('PCB');
        expect(s.effective_category).toBeTruthy();
      }
    });

    it('filters by outcome', async () => {
      await request(server)
        .patch(`/v1/ai/feedback/${createdSampleId}`)
        .send({ human_category: 'Cable', outcome: 'corrected' })
        .expect(200);

      const accepted = await request(server)
        .get('/v1/ai/dataset/samples?outcome=accepted');
      const corrected = await request(server)
        .get('/v1/ai/dataset/samples?outcome=corrected');

      for (const s of [...accepted.body.data.samples, ...corrected.body.data.samples]) {
        expect(['accepted', 'corrected']).toContain(s.outcome);
      }
      expect(corrected.body.data.samples.some((s) => s.id === createdSampleId)).toBe(true);
    });
  });

  describe('GET /v1/ai/dataset/export', () => {
    it('returns validated samples as a CSV document', async () => {
      const res = await request(server)
        .get('/v1/ai/dataset/export')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('effective_category');
      expect(res.text).toContain('Cable'); // corrected sample is included
    });
  });
});