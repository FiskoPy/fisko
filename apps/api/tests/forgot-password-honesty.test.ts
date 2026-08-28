import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

/**
 * Regression for a silent failure: with no mail transport configured the
 * endpoint answered {ok:true} while every reset email died on the datacenter
 * SMTP block. The client spent an evening refreshing an inbox that was never
 * going to receive anything, then abandoned the account and created another.
 *
 * "The server cannot send email" is not information about whether the address
 * exists, so refusing loudly does not weaken the enumeration protection that
 * the 200-always contract exists for.
 */
describe('POST /auth/forgot-password without a mail transport', () => {
  it('answers 503 with an actionable message instead of a fake ok', async () => {
    // vitest.config injects no BREVO_API_KEY / SMTP_*, so this is the real
    // "unconfigured" state — same as the homologation server today.
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'alguien@example.com' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error.message).toMatch(/correos no está habilitado/i);
    expect(res.body.error.message).toMatch(/código de recuperación/i);
    expect(res.body.ok).toBeUndefined();
  });

  it('does not touch the database before refusing (no token is minted)', async () => {
    const prismaMod = await import('../src/lib/prisma');
    const spy = vi.spyOn(prismaMod.prisma.user, 'findUnique');
    const app = createApp();
    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'x@example.com' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
