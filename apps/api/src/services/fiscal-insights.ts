import type { FiscalSummary } from '../modules/reports/reports.service';

/**
 * Marco 2 phase 2E — "IA Fiscal v1".
 *
 * Deliberately rule-based. The scope calls for "regras y thresholds": a spend
 * report every 10 days, an accumulated-IVA warning, a nudge to capture, and
 * encouragement. None of that needs a model, and a rule the accountant can
 * read beats a sentence a model improvised about someone's taxes. The single
 * place a model earns its keep — projecting the IVA to the end of the period —
 * lives in fiscal-forecast.ts and degrades to arithmetic when it is absent.
 */

export type InsightKind =
  | 'gasto_periodo'
  | 'iva_acumulado'
  | 'sin_capturas'
  | 'vencimiento_iva'
  | 'aliento';

export type InsightLevel = 'info' | 'warning' | 'success';

export interface Insight {
  kind: InsightKind;
  level: InsightLevel;
  title: string;
  body: string;
  /** Where the app should send the user when tapped. */
  action?: { label: string; route: string };
}

export interface InsightInput {
  summary: FiscalSummary;
  /** Newest invoice date the user has, or null when they have none. */
  lastInvoiceAt: Date | null;
  /** Invoices imported in the last 10 days. */
  recentCount: number;
  /** Total operations in the last 10 days, in guaraníes. */
  recentTotal: number;
  /** "Now", passed in so the rules stay pure and testable. */
  now: Date;
}

const fmtGs = (v: number): string =>
  'Gs ' + Math.round(v).toLocaleString('es-PY').replace(/,/g, '.');

const daysBetween = (a: Date, b: Date): number =>
  Math.floor((a.getTime() - b.getTime()) / 86_400_000);

/**
 * DNIT files IVA monthly; the due date depends on the last digit of the RUC,
 * spread across the second week of the following month. Without the taxpayer's
 * calendar we use day 12 as a conservative middle, and say so in the copy.
 */
const IVA_DUE_DAY = 12;

function nextDueDate(now: Date): Date {
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, IVA_DUE_DAY));
  return due;
}

/** Threshold above which an accumulated IVA balance is worth flagging. */
const IVA_ALERT_THRESHOLD = 500_000;

/** Days without importing anything before we nudge. */
const STALE_CAPTURE_DAYS = 10;

export function buildInsights(input: InsightInput): Insight[] {
  const { summary: s, lastInvoiceAt, recentCount, recentTotal, now } = input;
  const out: Insight[] = [];

  // 1. Spend report every 10 days.
  if (recentCount > 0) {
    out.push({
      kind: 'gasto_periodo',
      level: 'info',
      title: `Gastaste ${fmtGs(recentTotal)} en los últimos 10 días`,
      body:
        `${recentCount} comprobante(s) nuevos. ` +
        `En el período llevás ${fmtGs(s.compras)} en compras.`,
      action: { label: 'Ver reportes', route: '/relatorios' },
    });
  }

  // 2. Accumulated IVA and when it falls due.
  const saldo = s.ivaDebito - s.ivaCredito;
  if (s.totalIva >= IVA_ALERT_THRESHOLD) {
    const due = nextDueDate(now);
    const dias = daysBetween(due, now);
    out.push({
      kind: 'iva_acumulado',
      level: saldo > 0 ? 'warning' : 'info',
      title:
        saldo > 0
          ? `Tenés ${fmtGs(saldo)} de IVA a pagar`
          : `Tenés ${fmtGs(Math.abs(saldo))} de IVA a favor`,
      body:
        `IVA débito ${fmtGs(s.ivaDebito)} · IVA crédito ${fmtGs(s.ivaCredito)}. ` +
        `El vencimiento cae alrededor del ${IVA_DUE_DAY} del mes que viene` +
        (dias > 0 ? ` (en ~${dias} días)` : '') +
        `; la fecha exacta depende del último dígito de tu RUC.`,
      action: { label: 'Ver reportes', route: '/relatorios' },
    });
  }

  // 3. Nudge when nothing has been captured for a while.
  if (!lastInvoiceAt) {
    out.push({
      kind: 'sin_capturas',
      level: 'info',
      title: 'Todavía no importaste ninguna factura',
      body:
        'Conectá tu correo y Fisko importa solo las facturas electrónicas que ' +
        'recibís como adjunto.',
      action: { label: 'Conectar correo', route: '/perfil/conectar-email' },
    });
  } else {
    const dias = daysBetween(now, lastInvoiceAt);
    if (dias >= STALE_CAPTURE_DAYS) {
      out.push({
        kind: 'sin_capturas',
        level: 'warning',
        title: `Hace ${dias} días que no entra una factura`,
        body:
          'Si seguís recibiendo comprobantes, puede que falte sincronizar tu ' +
          'casilla. Las facturas que no entran no cuentan para tu IVA crédito.',
        action: { label: 'Sincronizar', route: '/perfil/conectar-email' },
      });
    }
  }

  // 4. Encouragement — only when there is something real to celebrate.
  if (recentCount >= 5) {
    out.push({
      kind: 'aliento',
      level: 'success',
      title: 'Vas al día 👌',
      body: `Importaste ${recentCount} comprobantes en 10 días. Así el cierre del mes no te agarra corriendo.`,
    });
  }

  return out;
}
