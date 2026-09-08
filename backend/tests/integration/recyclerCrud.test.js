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

describe('Recycler CRUD API', () => {
  it('POST /v1/recyclers creates a new recycler', async () => {
    const res = await request(server)
      .post('/v1/recyclers')
      .send({
        name: 'Test Recycler API',
        facility_location: 'Test Location',
        materials_accepted: ['PCB', 'Battery'],
        authorization_status: 'pending',
        service_area: 'Bengaluru',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Test Recycler API');
    expect(res.body.data.authorization_status).toBe('pending');
    expect(res.body.data.id).toBeDefined();
  });

  it('GET /v1/recyclers lists recyclers with pagination', async () => {
    const res = await request(server)
      .get('/v1/recyclers')
      .query({ page: '1', limit: '5' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.recyclers.length).toBeLessThanOrEqual(5);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(10);
    expect(res.body.pagination.pages).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/recyclers filters by authorization_status', async () => {
    const res = await request(server)
      .get('/v1/recyclers')
      .query({ authorization_status: 'authorized' })
      .expect(200);

    for (const recycler of res.body.recyclers) {
      expect(recycler.authorization_status).toBe('authorized');
    }
    expect(res.body.recyclers.length).toBe(7);
  });

  it('GET /v1/recyclers filters by material', async () => {
    const res = await request(server)
      .get('/v1/recyclers')
      .query({ material: 'PCB' })
      .expect(200);

    expect(res.body.recyclers.length).toBeGreaterThan(0);
    for (const recycler of res.body.recyclers) {
      expect(recycler.materials_accepted).toContain('PCB');
    }
  });

  it('GET /v1/recyclers filters by name', async () => {
    const res = await request(server)
      .get('/v1/recyclers')
      .query({ name: 'trishyirya' })
      .expect(200);

    expect(res.body.recyclers.length).toBeGreaterThan(0);
    for (const recycler of res.body.recyclers) {
      expect(recycler.name.toLowerCase()).toContain('trishyirya');
    }
  });

  it('GET /v1/recyclers combines name + location filters', async () => {
    const res = await request(server)
      .get('/v1/recyclers')
      .query({ name: 'parisaraa', location: 'karnataka' })
      .expect(200);

    expect(res.body.recyclers.length).toBeGreaterThan(0);
    for (const recycler of res.body.recyclers) {
      expect(recycler.name.toLowerCase()).toContain('parisaraa');
    }
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  it('GET /v1/recyclers/:id returns a recycler', async () => {
    const res = await request(server)
      .get('/v1/recyclers/1')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Trishyirya Recycling India Pvt. Ltd.');
  });

  it('GET /v1/recyclers/:id returns 404 for missing id', async () => {
    const res = await request(server)
      .get('/v1/recyclers/9999');

    expect(res.status).toBe(404);
  });

  it('PUT /v1/recyclers/:id updates a recycler', async () => {
    const res = await request(server)
      .put('/v1/recyclers/1')
      .send({ service_area: 'Bengaluru Rural + Metro' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.service_area).toBe('Bengaluru Rural + Metro');
    expect(res.body.data.name).toBe('Trishyirya Recycling India Pvt. Ltd.');
  });

  it('PUT /v1/recyclers/:id returns 404 for missing id', async () => {
    const res = await request(server)
      .put('/v1/recyclers/9999')
      .send({ name: 'Nonexistent' });

    expect(res.status).toBe(404);
  });

  it('DELETE /v1/recyclers/:id deletes a recycler', async () => {
    // Create a temporary recycler
    const createRes = await request(server)
      .post('/v1/recyclers')
      .send({ name: 'Temp Recycler', materials_accepted: ['PCB'] });

    const id = createRes.body.data.id;

    const res = await request(server)
      .delete(`/v1/recyclers/${id}`)
      .expect(204);

    expect(res.body).toEqual({});

    // Verify it's gone
    const getRes = await request(server).get(`/v1/recyclers/${id}`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE /v1/recyclers/:id returns 404 for missing id', async () => {
    const res = await request(server).delete('/v1/recyclers/9999');
    expect(res.status).toBe(404);
  });

  it('POST /v1/recyclers rejects invalid data', async () => {
    const res = await request(server)
      .post('/v1/recyclers')
      .send({ materials_accepted: [] });

    expect(res.status).toBe(400);
  });
});

describe('Recycler login API', () => {
  it('POST /v1/recyclers/login signs in an authorized recycler', async () => {
    const res = await request(server)
      .post('/v1/recyclers/login')
      .send({ recycler_id: 5 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.recycler.id).toBe(5);
    expect(res.body.data.recycler.name).toBe('E-Parisaraa Pvt. Ltd.');
    expect(res.body.data.recycler.authorization_status).toBe('authorized');
    expect(res.body.data.token).toMatch(/^mock-recycler-login-5-/);
  });

  it('POST /v1/recyclers/login blocks a pending recycler', async () => {
    const res = await request(server)
      .post('/v1/recyclers/login')
      .send({ recycler_id: 7 });

    expect(res.status).toBe(403);
  });

  it('POST /v1/recyclers/login blocks an unauthorized recycler', async () => {
    const res = await request(server)
      .post('/v1/recyclers/login')
      .send({ recycler_id: 9 });

    expect(res.status).toBe(403);
  });

  it('POST /v1/recyclers/login returns 404 for a missing recycler', async () => {
    const res = await request(server)
      .post('/v1/recyclers/login')
      .send({ recycler_id: 9999 });

    expect(res.status).toBe(404);
  });

  it('POST /v1/recyclers/login validates the payload', async () => {
    const res = await request(server)
      .post('/v1/recyclers/login')
      .send({});

    expect(res.status).toBe(400);
  });
});
