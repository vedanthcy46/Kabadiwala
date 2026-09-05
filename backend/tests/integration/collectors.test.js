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

describe('Collector Auth API', () => {
  it('GET /v1/collectors is removed (no public account listing)', async () => {
    const res = await request(server).get('/v1/collectors').expect(404);
    expect(res.body.code).toBe(404);
  });

  it('POST /v1/collectors/login returns collector + token for a valid phone', async () => {
    const res = await request(server)
      .post('/v1/collectors/login')
      .send({ phone: '9876543210' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.collector.name).toBe('Ramesh Kumar');
    expect(res.body.data.collector.phone).toBe('9876543210');
    expect(res.body.data.token).toMatch(/^mock-login-1-/);
  });

  it('POST /v1/collectors/login rejects an unknown phone', async () => {
    const res = await request(server)
      .post('/v1/collectors/login')
      .send({ phone: '9000000000' })
      .expect(404);

    expect(res.body.code).toBe(404);
    expect(res.body.message).toMatch(/collector/i);
  });

  it('POST /v1/collectors/login rejects a malformed phone', async () => {
    const res = await request(server)
      .post('/v1/collectors/login')
      .send({ phone: '123' })
      .expect(400);

    expect(res.body.code).toBe(400);
  });

  it('POST /v1/collectors/register creates a collector and returns a session token', async () => {
    const res = await request(server)
      .post('/v1/collectors/register')
      .send({
        name: 'Test Collector',
        phone: '9012345678',
        operating_location: 'Mysuru',
        preferred_language: 'mr',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.collector.name).toBe('Test Collector');
    expect(res.body.data.collector.phone).toBe('9012345678');
    expect(res.body.data.collector.preferred_language).toBe('mr');
    expect(res.body.data.token).toMatch(/^mock-login-/);
  });

  it('POST /v1/collectors/register rejects an existing phone', async () => {
    const res = await request(server)
      .post('/v1/collectors/register')
      .send({ name: 'Duplicate', phone: '9012345678' })
      .expect(409);

    expect(res.body.code).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('POST /v1/collectors/register rejects a malformed phone', async () => {
    const res = await request(server)
      .post('/v1/collectors/register')
      .send({ name: 'Bad Phone', phone: '12' })
      .expect(400);

    expect(res.body.code).toBe(400);
  });

  it('the newly registered collector can log in', async () => {
    const res = await request(server)
      .post('/v1/collectors/login')
      .send({ phone: '9012345678' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.collector.name).toBe('Test Collector');
  });
});