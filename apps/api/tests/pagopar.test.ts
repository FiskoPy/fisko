import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The webhook digest is the whole security of the payment flow: the callback
 * URL is public, so anyone can POST "pagado: true" at it. Only Pagopar can
 * produce sha1(privateToken + hashPedido), because only Pagopar has the token.
 */

const PRIVATE = 'test-private-token-0123456789';
const PUBLIC = 'test-public-token-0123456789';

let transactionToken: (id: string, monto: number) => string;
let verifyWebhookToken: (hash: string, received: string) => boolean;
let canExportReports: (plan: { invoiceLimit: number | null }, n: number) => boolean;
let PLANS: { id: string; priceGs: number | null; checkout: string; invoiceLimit: number | null }[];

beforeAll(async () => {
  process.env.PAGOPAR_PRIVATE_TOKEN = PRIVATE;
  process.env.PAGOPAR_PUBLIC_TOKEN = PUBLIC;
  const pagopar = await import('../src/services/pagopar');
  const plans = await import('../src/services/plans');
  transactionToken = pagopar.transactionToken;
  verifyWebhookToken = pagopar.verifyWebhookToken;
  canExportReports = plans.canExportReports as typeof canExportReports;
  PLANS = plans.PLANS as typeof PLANS;
});

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');

describe('transactionToken', () => {
  it('matches Pagopar reference: sha1(private + idPedido + monto)', () => {
    expect(transactionToken('pedido-1', 59900)).toBe(sha1(`${PRIVATE}pedido-159900`));
  });

  it('normalises the amount the way the PHP reference does', () => {
    // strval(floatval(59900.00)) === "59900"
    expect(transactionToken('p', 59900.0)).toBe(transactionToken('p', 59900));
  });
});

describe('verifyWebhookToken', () => {
  const hashPedido = 'abc123def456';

  it('accepts the digest Pagopar would send', () => {
    expect(verifyWebhookToken(hashPedido, sha1(`${PRIVATE}${hashPedido}`))).toBe(true);
  });

  it('rejects a forged token', () => {
    expect(verifyWebhookToken(hashPedido, sha1(`wrong-secret${hashPedido}`))).toBe(false);
  });

  it('rejects a token for a different order', () => {
    expect(verifyWebhookToken(hashPedido, sha1(`${PRIVATE}otro-pedido`))).toBe(false);
  });

  it('rejects empty, short and non-string input without throwing', () => {
    expect(verifyWebhookToken(hashPedido, '')).toBe(false);
    expect(verifyWebhookToken(hashPedido, 'deadbeef')).toBe(false);
    expect(verifyWebhookToken(hashPedido, undefined as unknown as string)).toBe(false);
  });

  it('is not fooled by a correct prefix', () => {
    const good = sha1(`${PRIVATE}${hashPedido}`);
    expect(verifyWebhookToken(hashPedido, good.slice(0, 39) + '0')).toBe(false);
  });
});

describe('plan catalogue', () => {
  it('prices the paid tiers as the client set them', () => {
    const byId = Object.fromEntries(PLANS.map((p) => [p.id, p]));
    expect(byId.basico?.priceGs).toBe(59_900);
    expect(byId.pro?.priceGs).toBe(119_900);
  });

  it('keeps Empresarial off automatic checkout: its price is negotiated', () => {
    const emp = PLANS.find((p) => p.id === 'empresarial')!;
    expect(emp.priceGs).toBeNull();
    expect(emp.checkout).toBe('contacto');
  });

  it('never puts a plan on pagopar checkout without a price', () => {
    for (const p of PLANS) {
      if (p.checkout === 'pagopar') expect(p.priceGs).toBeGreaterThan(0);
    }
  });
});

describe('canExportReports — the limit gates output, never capture', () => {
  const basico = { invoiceLimit: 50 };

  it('allows export while inside the plan', () => {
    expect(canExportReports(basico, 50)).toBe(true);
  });

  it('blocks export past the limit', () => {
    expect(canExportReports(basico, 51)).toBe(false);
  });

  it('never limits an unlimited plan', () => {
    expect(canExportReports({ invoiceLimit: null }, 10_000)).toBe(true);
  });
});
