import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * The admin router must be invisible without ADMIN_TOKEN, and must reject a
 * wrong token without touching the DB. The success path needs Postgres and is
 * covered by the live check against homologation.
 */
describe('admin router gating', () => {
  it('is not mounted at all when ADMIN_TOKEN is unset', async () => {
    vi.resetModules();
    delete process.env.ADMIN_TOKEN;
    const { createApp } = await import('../src/app');
    const res = await request(createApp())
      .post('/api/v1/admin/password-reset-code')
      .set('x-admin-token', 'anything')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a wrong token with 401 and never reaches the service', async () => {
    vi.resetModules();
    process.env.ADMIN_TOKEN = 'x'.repeat(40);
    const svc = await import('../src/modules/auth/auth.service');
    const spy = vi.spyOn(svc, 'issuePasswordResetCode');
    const { createApp } = await import('../src/app');
    const res = await request(createApp())
      .post('/api/v1/admin/password-reset-code')
      .set('x-admin-token', 'y'.repeat(40))
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    delete process.env.ADMIN_TOKEN;
  });

  it('rejects a missing header the same way', async () => {
    vi.resetModules();
    process.env.ADMIN_TOKEN = 'x'.repeat(40);
    const { createApp } = await import('../src/app');
    const res = await request(createApp())
      .post('/api/v1/admin/password-reset-code')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(401);
    delete process.env.ADMIN_TOKEN;
  });
});
