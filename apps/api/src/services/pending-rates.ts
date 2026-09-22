import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { normalizeRuc } from '../utils/ruc';
import { officialRate } from './exchange-rates';

/** At most this many pending invoices are looked up per call. */
const BATCH = 20;

/** How long a screen waits for them before it answers as things are. */
const WAIT_MS = 2_500;

type PendingCursor = { fechaEmision: Date; id: string };
// Rotate past unavailable closes; they must not starve every later invoice.
// This is only a scheduling hint, so eviction/restarts safely begin again.
const cursors = new Map<string, PendingCursor>();
const MAX_CURSORS = 1_000;

function advanceCursor(userId: string, invoice: PendingCursor): void {
  cursors.delete(userId);
  cursors.set(userId, { fechaEmision: invoice.fechaEmision, id: invoice.id });
  if (cursors.size > MAX_CURSORS) cursors.delete(cursors.keys().next().value!);
}

/**
 * fillPendingRates, waited for no longer than a screen should wait: a DNIT
 * site that hangs rather than fails would hold the list for every read's
 * timeout. What is still running finishes in the background, and the next
 * look shows it.
 */
export async function fillPendingRatesBriefly(userId: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    fillPendingRates(userId),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}

/**
 * Completes the rates of foreign invoices stored while the DNIT's close could
 * not be had ("pendiente").
 *
 * An invoice whose figures were read is stored, out of the guaraní totals,
 * rather than refused for a site that is down — on 2026-09-22 the DNIT's rates
 * page went 404 and a dollar receipt read right was turned away twice. It
 * takes its rate here, the next time its owner opens the list, the invoice or
 * the month, once the DNIT answers: the selling close for a purchase, the
 * buying one for a sale. A rate set by hand in the meantime is left alone.
 * Never throws: a lookup that fails leaves the invoice pending, and the
 * screen that asked shows it as it is.
 */
export async function fillPendingRates(userId: string): Promise<number> {
  try {
    const readBatch = (after?: PendingCursor) =>
      prisma.invoice.findMany({
        where: {
          userId,
          tipoCambioFuente: 'pendiente',
          tipoCambio: null,
          ...(after
            ? {
                OR: [
                  { fechaEmision: { gt: after.fechaEmision } },
                  { fechaEmision: after.fechaEmision, id: { gt: after.id } },
                ],
              }
            : {}),
        },
        select: { id: true, moneda: true, fechaEmision: true, emisorRuc: true, esVenta: true },
        orderBy: [{ fechaEmision: 'asc' }, { id: 'asc' }],
        take: BATCH,
      });
    const cursor = cursors.get(userId);
    let pending = await readBatch(cursor);
    if (!pending.length && cursor) pending = await readBatch();
    if (!pending.length) {
      cursors.delete(userId);
      return 0;
    }
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { ruc: true } });
    const own = owner?.ruc ? normalizeRuc(owner.ruc) : null;
    let filled = 0;
    for (const inv of pending) {
      advanceCursor(userId, inv);
      const venta = inv.esVenta ?? (own != null && normalizeRuc(inv.emisorRuc) === own);
      const found = await officialRate(inv.moneda, inv.fechaEmision, venta ? 'compra' : 'venta');
      if (typeof found === 'string') {
        if (found === 'sin-conexion') break;
        continue;
      }
      const res = await prisma.invoice.updateMany({
        where: {
          id: inv.id,
          tipoCambioFuente: 'pendiente',
          tipoCambio: null,
          esVenta: inv.esVenta,
        },
        data: { tipoCambio: found.rate, tipoCambioOtroLado: found.other, tipoCambioFuente: 'dnit' },
      });
      filled += res.count;
    }
    if (filled) logger.info({ filled }, 'pending exchange rates completed');
    return filled;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'pending exchange rates not completed');
    return 0;
  }
}
