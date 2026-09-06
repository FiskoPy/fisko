import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { getOrderStatus } from '../../services/pagopar';

/**
 * Crediting a paid order, in one place.
 *
 * Two callers reach this: Pagopar's webhook, and our own query of the order
 * status. They must agree, or a payment confirmed by one path would be
 * credited differently by the other — or twice.
 */
export async function creditPaidOrder(
  sub: { id: string; userId: string; planId: string; pendingPlanId: string | null; paidHashPedido: string | null },
  hashPedido: string,
): Promise<'credited' | 'already'> {
  // Pagopar re-notifies every 10 minutes until it sees a 200, and the user can
  // reload the return page as often as they like. Key the guard on the order
  // itself so neither path can stack a second month.
  if (sub.paidHashPedido === hashPedido) return 'already';

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  const planId = sub.pendingPlanId ?? sub.planId;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      planId,
      pendingPlanId: null,
      status: 'active',
      lastPaymentAt: now,
      currentPeriodEnd: periodEnd,
      paidHashPedido: hashPedido,
    },
  });

  logger.info({ userId: sub.userId, planId, hashPedido }, 'subscription activated');
  return 'credited';
}

/**
 * Asks Pagopar what actually happened to an order, and credits it if paid.
 *
 * The webhook is the primary path, but it can be late or lost: the free tier
 * hibernates, and Pagopar gives up eventually. Without this, a user who really
 * paid sits on "esperando confirmación" with no way forward. It is also step 3
 * of the circuit Pagopar requires before releasing production credentials —
 * "el sitio web del comercio consulta el estado de un pedido".
 */
export async function reconcileOrder(hashPedido: string): Promise<{
  found: boolean;
  paid: boolean;
  cancelled: boolean;
  credited: boolean;
}> {
  const sub = await prisma.subscription.findFirst({ where: { hashPedido } });
  if (!sub) return { found: false, paid: false, cancelled: false, credited: false };

  const status = await getOrderStatus(hashPedido);
  if (!status) {
    // Pagopar unreachable: report what we already know rather than guessing.
    const paid = sub.status === 'active';
    return { found: true, paid, cancelled: false, credited: false };
  }

  if (!status.pagado) {
    return { found: true, paid: false, cancelled: status.cancelado, credited: false };
  }

  const outcome = await creditPaidOrder(sub, hashPedido);
  return { found: true, paid: true, cancelled: false, credited: outcome === 'credited' };
}
