import { prisma } from '../lib/prisma';

/**
 * Subscription plans — Marco 2 phase 2F.
 *
 * Prices set by the client (2026-08-29), monthly, in guaraníes. Tiers are by
 * invoice volume, per ESCOPO.md.
 *
 * "Empresarial" carries no price here on purpose: the client quoted it as
 * "desde Gs 299.900", i.e. negotiated per customer. A plan without a fixed
 * price cannot go through automatic checkout, so it routes to sales instead.
 */

export type PlanId = 'gratis' | 'basico' | 'pro' | 'empresarial';

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in guaraníes; null when the price is negotiated. */
  priceGs: number | null;
  /** Invoices per month; null means unlimited. */
  invoiceLimit: number | null;
  /** Photo OCR calls per day. Scales with the plan: it is our variable cost. */
  ocrPerDay: number;
  features: string[];
  /** Automatic checkout, or "talk to sales". */
  checkout: 'pagopar' | 'contacto';
}

export const PLANS: Plan[] = [
  {
    id: 'gratis',
    name: 'Gratis',
    priceGs: null,
    invoiceLimit: 5,
    ocrPerDay: 3,
    features: ['Hasta 5 facturas por mes', 'Captura por correo', 'Dashboard de IVA'],
    checkout: 'contacto',
  },
  {
    id: 'basico',
    name: 'Básico',
    priceGs: 59_900,
    invoiceLimit: 50,
    ocrPerDay: 10,
    features: [
      'Hasta 50 facturas por mes',
      'Captura por correo',
      'Foto de facturas de papel',
      'Reportes PDF y Excel',
    ],
    checkout: 'pagopar',
  },
  {
    id: 'pro',
    name: 'Pro',
    priceGs: 119_900,
    invoiceLimit: 300,
    ocrPerDay: 30,
    features: [
      'Hasta 300 facturas por mes',
      'Todo lo del plan Básico',
      'Alertas de IVA y proyección',
    ],
    checkout: 'pagopar',
  },
  {
    id: 'empresarial',
    name: 'Empresarial',
    priceGs: null, // "desde Gs 299.900" — negotiated
    invoiceLimit: null,
    ocrPerDay: 200,
    features: ['Facturas ilimitadas', 'Todo lo del plan Pro', 'Soporte prioritario'],
    checkout: 'contacto',
  },
];

export const FREE_PLAN: PlanId = 'gratis';

export function getPlan(id: string): Plan | null {
  return PLANS.find((p) => p.id === id) ?? null;
}

/**
 * Whether a user on this plan may still export reports.
 *
 * Deliberately asymmetric with capture: going over the limit never blocks
 * filing an invoice — that is a fiscal record, and losing one because of a
 * billing tier would be the app's fault with the DNIT. What the limit gates is
 * the *output*: the PDF/Excel export. It converts just as well and holds
 * nobody's tax data hostage.
 */
export function canExportReports(plan: Plan, invoicesThisMonth: number): boolean {
  if (plan.invoiceLimit === null) return true;
  return invoicesThisMonth <= plan.invoiceLimit;
}

/**
 * The plan a user is actually on right now.
 *
 * Shared by /subscriptions/me and the OCR limiter on purpose: if the two
 * resolved "active" differently, we would show one plan and enforce another.
 * An expired period falls back to free, so a lapsed subscription stops costing
 * us Vision calls the moment it lapses.
 */
export interface SubscriptionRow {
  planId: string;
  status: string;
  currentPeriodEnd: Date | null;
}

/** Decides, from a subscription row, what the user is entitled to today. */
export function resolveActive(sub: SubscriptionRow | null): {
  plan: Plan;
  active: boolean;
} {
  const active =
    sub?.status === 'active' &&
    sub.currentPeriodEnd != null &&
    sub.currentPeriodEnd > new Date();
  const free = getPlan(FREE_PLAN)!;
  return { plan: active ? (getPlan(sub.planId) ?? free) : free, active };
}

export async function activePlanFor(userId: string): Promise<Plan> {
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    return resolveActive(sub).plan;
  } catch {
    // A database hiccup must not hand out the most expensive tier.
    return getPlan(FREE_PLAN)!;
  }
}
