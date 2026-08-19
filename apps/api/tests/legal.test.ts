import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

/**
 * The store listings point at these two URLs, so a regression here blocks a
 * release rather than degrading one. They touch no database, so this runs
 * without Postgres.
 */
const app = createApp();

describe('GET /privacidad', () => {
  it('serves an HTML page', async () => {
    const res = await request(app).get('/privacidad');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('identifies the data controller and the Paraguayan data-protection law', async () => {
    const { text } = await request(app).get('/privacidad');
    expect(text).toContain('TecBio');
    expect(text).toContain('80175384-8');
    expect(text).toContain('6.534/2020');
  });

  it('discloses what the stores ask about: mailbox access and where data lives', async () => {
    const { text } = await request(app).get('/privacidad');
    expect(text).toContain('AES-256-GCM'); // mailbox password at rest
    expect(text).toContain('Render'); // processor / international transfer
    expect(text).toContain('Brevo');
    expect(text).toMatch(/no los vendemos/i);
  });

  it('declares a language and a mobile viewport', async () => {
    const { text } = await request(app).get('/privacidad');
    expect(text).toContain('<html lang="es">');
    expect(text).toContain('width=device-width');
  });
});

describe('GET /eliminar-cuenta', () => {
  it('serves the account-deletion page Google Play requires', async () => {
    const res = await request(app).get('/eliminar-cuenta');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Eliminar tu cuenta/);
    expect(res.text).toMatch(/30\b/); // stated turnaround
  });

  it('lists what gets deleted', async () => {
    const { text } = await request(app).get('/eliminar-cuenta');
    expect(text).toMatch(/facturas/i);
    expect(text).toMatch(/casillas de correo/i);
  });
});

describe('legal pages and the rest of the app', () => {
  it('does not let helmet block the inline stylesheet', async () => {
    // The pages carry their CSS inline; if style-src ever loses 'unsafe-inline'
    // they render unstyled in the reviewer's browser.
    const res = await request(app).get('/privacidad');
    const csp = res.headers['content-security-policy'];
    if (csp) {
      const styleSrc = csp.split(';').find((d) => d.trim().startsWith('style-src'));
      expect(styleSrc, 'style-src directive').toBeDefined();
      expect(styleSrc).toContain("'unsafe-inline'");
    }
  });

  it('still 404s unknown paths as JSON (mounting at / must not swallow them)', async () => {
    const res = await request(app).get('/ruta-que-no-existe');
    expect(res.status).toBe(404);
    expect(res.body?.error?.code).toBe('NOT_FOUND');
  });

  it('keeps the API health endpoint working', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
