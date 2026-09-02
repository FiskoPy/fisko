import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { PLANS, getPlan, resolveActive } from '../../services/plans';
import { createCheckout, verifyWebhookToken } from '../../services/pagopar';

export const subscriptionsRouter = Router();

/** The plan catalogue is public: the app shows prices before anyone logs in. */
subscriptionsRouter.get('/plans', (_req, res) => {
  res.status(200).json({ plans: PLANS });
});

/**
 * Pagopar's payment notification.
 *
 * Deliberately mounted BEFORE requireAuth: Pagopar's servers call this, not a
 * logged-in user. Its only credential is the echoed token, which is why
 * verifying that digest is the whole security of this endpoint.
 */
const webhookSchema = z.object({
  hash_pedido: z.string().min(4),
  token: z.string().min(8),
  pagado: z.union([z.boolean(), z.string()]).optional(),
  monto: z.union([z.number(), z.string()]).optional(),
});

subscriptionsRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    // Pagopar posts either the object itself or wrapped in `resultado`.
    const raw = Array.isArray((req.body as { resultado?: unknown[] })?.resultado)
      ? ((req.body as { resultado: unknown[] }).resultado[0] as unknown)
      : req.body;

    const parsed = webhookSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ body: JSON.stringify(req.body).slice(0, 300) }, 'pagopar webhook: bad shape');
      // 200 on purpose: a retry loop would not fix a malformed payload.
      res.status(200).json({ ok: false });
      return;
    }

    const { hash_pedido: hashPedido, token, pagado } = parsed.data;

    if (!verifyWebhookToken(hashPedido, token)) {
      logger.warn({ hashPedido, ip: req.ip }, 'pagopar webhook: TOKEN MISMATCH — rejected');
      throw AppError.unauthorized('Token inválido');
    }

    const isPaid = pagado === true || pagado === 'true' || pagado === '1';
    const sub = await prisma.subscription.findFirst({ where: { hashPedido } });
    if (!sub) {
      logger.warn({ hashPedido }, 'pagopar webhook: no subscription for this order');
      res.status(200).json(req.body);
      return;
    }

    if (!isPaid) {
      logger.info({ hashPedido, userId: sub.userId }, 'pagopar webhook: not paid yet');
      res.status(200).json(req.body);
      return;
    }

    // Pagopar re-notifies every 10 minutes until it sees a 200, so the same
    // order can arrive more than once. Key the guard on the order itself —
    // keying on status ignored a paid upgrade as if it were a repeat.
    if (sub.paidHashPedido === hashPedido) {
      logger.info({ hashPedido }, 'pagopar webhook: already credited, ignoring repeat');
      res.status(200).json(req.body);
      return;
    }

    // One paid month from now, on the plan this order was for.
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
    // Pagopar asks merchants to answer with the payload it sent.
    res.status(200).json(req.body);
  }),
);

// ---------------------------------------------------------------------------
// Everything below needs a logged-in user.
subscriptionsRouter.use(requireAuth);

/** What the user currently has. Absent row means the free plan. */
subscriptionsRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) throw AppError.unauthorized();

    const sub = await prisma.subscription.findUnique({ where: { userId: user.sub } });
    // Same resolver the OCR limiter uses, so what we show is what we enforce.
    const { plan, active } = resolveActive(sub);

    res.status(200).json({
      plan,
      status: active ? 'active' : (sub?.status ?? 'none'),
      currentPeriodEnd: active ? (sub?.currentPeriodEnd ?? null) : null,
    });
  }),
);

const checkoutSchema = z.object({ planId: z.string().min(2) });

subscriptionsRouter.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) throw AppError.unauthorized();

    const { planId } = checkoutSchema.parse(req.body);
    const plan = getPlan(planId);
    if (!plan) throw AppError.badRequest('Plan inexistente');

    if (plan.checkout !== 'pagopar' || plan.priceGs == null) {
      throw AppError.badRequest(
        `El plan ${plan.name} se contrata hablando con nosotros. Escribinos y lo activamos.`,
      );
    }

    const dbUser = await prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser) throw AppError.unauthorized();

    // Unique per attempt so a retried payment never collides with an old order.
    const idPedido = `fisko-${plan.id}-${dbUser.id.slice(0, 8)}-${Date.now()}`;
    const maxPaymentDate = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const checkout = await createCheckout({
      idPedido,
      montoGs: plan.priceGs,
      buyer: {
        nombre: dbUser.name,
        email: dbUser.email,
        ruc: dbUser.ruc ? `${dbUser.ruc}-${dbUser.rucDv ?? ''}` : null,
        telefono: null,
      },
      item: {
        nombre: `Fisko ${plan.name}`,
        precioGs: plan.priceGs,
        idProducto: plan.id,
        descripcion: `Suscripción mensual al plan ${plan.name} de Fisko`,
      },
      maxPaymentDate,
    });

    // A paying user who starts an upgrade — or opens a checkout and closes
    // it — keeps what they paid for until the new payment is confirmed. Only
    // a user with nothing active is moved to 'pending'.
    const existing = await prisma.subscription.findUnique({ where: { userId: dbUser.id } });
    const keepActive = resolveActive(existing).active;
    const order = {
      pendingPlanId: plan.id,
      pedidoId: idPedido,
      hashPedido: checkout.hashPedido,
      priceGs: plan.priceGs,
    };
    await prisma.subscription.upsert({
      where: { userId: dbUser.id },
      create: { userId: dbUser.id, planId: plan.id, status: 'pending', ...order },
      update: keepActive ? order : { planId: plan.id, status: 'pending', ...order },
    });

    res.status(201).json({ redirectUrl: checkout.redirectUrl, planId: plan.id });
  }),
);
