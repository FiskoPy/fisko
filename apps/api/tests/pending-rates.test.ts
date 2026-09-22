import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { setTipo, setTipoCambio } from '../src/modules/invoices/invoices.service';
import * as rates from '../src/services/exchange-rates';
import { fillPendingRates } from '../src/services/pending-rates';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

let userId: string;
const users: string[] = [];
const originalFindOwner = prisma.user.findUnique;
beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `pending-${randomUUID()}@example.com`,
      name: 'Pending rates',
      ruc: '80175384',
    },
  });
  userId = user.id;
  users.push(user.id);
  // Only the external quotation service is replaced. All invoice reads/writes
  // run against PostgreSQL, including the competing updates.
  vi.spyOn(rates, 'officialRate').mockImplementation(async (_currency, _date, side) => ({
    rate: side === 'compra' ? 5900 : 6000,
    other: side === 'compra' ? 6000 : 5900,
    date: '2026-09-20',
    side,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  // Prisma delegates are proxies: restoring a spy can delete their property.
  prisma.user.findUnique = originalFindOwner;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

function pending(day = 21) {
  return prisma.invoice.create({
    data: {
      userId,
      cdc: randomUUID(),
      tipoDoc: 1,
      emisorRuc: '80054993',
      emisorNombre: 'Issuer',
      fechaEmision: new Date(Date.UTC(2026, 8, day)),
      moneda: 'USD',
      tipoCambioFuente: 'pendiente',
      totalOpe: 110,
      totalIva: 10,
      iva5: 0,
      iva10: 10,
      baseGrav5: 0,
      baseGrav10: 100,
    },
  });
}

describe('pending exchange rates with concurrent edits', () => {
  it('does not apply the old purchase close after the user changes to a sale', async () => {
    const invoice = await pending();
    const entered = gate();
    const resume = gate();
    vi.mocked(rates.officialRate).mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return { rate: 6000, other: 5900, date: '2026-09-20', side: 'venta' };
    });
    const filling = fillPendingRates(userId);
    await entered.promise;
    try {
      await setTipo(userId, invoice.id, 'venta');
    } finally {
      resume.release();
    }
    await filling;
    await fillPendingRates(userId);
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(saved.esVenta).toBe(true);
    expect(Number(saved.tipoCambio)).toBe(5900);
    expect(Number(saved.tipoCambioOtroLado)).toBe(6000);
  });

  it('recalculates the sale close if backfill completes after setTipo reads pending', async () => {
    const invoice = await pending();
    const entered = gate();
    const resume = gate();
    const findOwner = prisma.user.findUnique.bind(prisma.user);
    // Pause after setTipo has read the invoice, while preserving real DB reads.
    vi.spyOn(prisma.user, 'findUnique').mockImplementationOnce((async (
      args: Parameters<typeof findOwner>[0],
    ) => {
      const owner = await findOwner(args);
      entered.release();
      await resume.promise;
      return owner;
    }) as unknown as typeof prisma.user.findUnique);
    const editing = setTipo(userId, invoice.id, 'venta');
    await entered.promise;
    try {
      await fillPendingRates(userId);
    } finally {
      resume.release();
    }
    await editing;
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(saved.esVenta).toBe(true);
    expect(Number(saved.tipoCambio)).toBe(5900);
    expect(Number(saved.tipoCambioOtroLado)).toBe(6000);
  });

  it('preserves a manual close entered while the official lookup is running', async () => {
    const invoice = await pending();
    const entered = gate();
    const resume = gate();
    vi.mocked(rates.officialRate).mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return { rate: 6000, other: 5900, date: '2026-09-20', side: 'venta' };
    });
    const filling = fillPendingRates(userId);
    await entered.promise;
    try {
      await setTipoCambio(userId, invoice.id, 6123);
    } finally {
      resume.release();
    }
    await filling;
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(saved.tipoCambioFuente).toBe('manual');
    expect(Number(saved.tipoCambio)).toBe(6123);
    expect(saved.tipoCambioOtroLado).toBeNull();
  });

  it('reaches later invoices after a full batch of unavailable closes', async () => {
    for (let day = 1; day <= 20; day++) await pending(day);
    const available = await pending(21);
    vi.mocked(rates.officialRate).mockImplementation(async (_currency, date, side) =>
      date.getUTCDate() <= 20 ? 'ilegible' : { rate: 6000, other: 5900, date: '2026-09-20', side },
    );
    await fillPendingRates(userId);
    await fillPendingRates(userId);
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: available.id } });
    expect(saved.tipoCambioFuente).toBe('dnit');
    expect(Number(saved.tipoCambio)).toBe(6000);
  });
});
