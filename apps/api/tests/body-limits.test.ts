import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

/**
 * The photo route has its own 12mb parser, but the global 100kb parser used to
 * run first and 413 any real photo before the route was reached. These run
 * without a database: the checks that matter happen before any handler.
 */
const app = createApp();

describe('request body limits', () => {
  it('lets a 300kb photo body past the global parser (no 413)', async () => {
    const res = await request(app)
      .post('/api/v1/invoices/import-photo')
      .set('content-type', 'application/json')
      .send({ imageBase64: 'A'.repeat(300 * 1024) });
    // No token → 401 from requireAuth. The point is that it is NOT 413.
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(401);
  });

  it('still caps the rest of the API, above the old 100kb', async () => {
    const res = await request(app)
      .post('/api/v1/invoices/import-xml')
      .set('content-type', 'application/json')
      .send({ xml: 'A'.repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a 500kb DTE on import-xml (a big invoice is not a photo)', async () => {
    const res = await request(app)
      .post('/api/v1/invoices/import-xml')
      .set('content-type', 'application/json')
      .send({ xml: 'A'.repeat(500 * 1024) });
    expect(res.status).toBe(401);
  });
});
