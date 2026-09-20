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
  /** When the newest invoice entered Fisko (createdAt), or null when none. */
  lastInvoiceAt: Date | null;
  /** The taxpayer's RUC, without its check digit: it sets the due date. */
  ruc?: string | null;
  /** Invoices imported in the last 10 days that carry an operation. */
  recentCount: number;
  /** Everything imported in those days, notas de remisión included. */
  recentDocs?: number;
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
 * DNIT's perpetual calendar (RG 01/2007, kept by RG 38/2020): the day the
 * monthly IVA falls due, by the last digit of the RUC — the taxpayer's own
 * number, never its check digit.
 *
 * Saying "alrededor del 12" was no use to anyone: the client has to know the
 * day he files. A due date landing on a Saturday or a Sunday moves to the next
 * working day; a national holiday moves it too, which we cannot know here, so
 * the copy says so rather than pretending.
 */
const DUE_DAY_BY_LAST_DIGIT = [7, 9, 11, 13, 15, 17, 19, 21, 23, 25];

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre',
];

/** The day this RUC files on, or null when we do not know the RUC. */
export function ivaDueDay(ruc: string | null | undefined): number | null {
  const digits = (ruc ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return DUE_DAY_BY_LAST_DIGIT[Number(digits[digits.length - 1])] ?? null;
}

/**
 * When the IVA of the month that [now] falls in has to be filed: the calendar
 * day of the following month, moved off a weekend.
 */
export function ivaDueDate(ruc: string | null | undefined, now: Date): Date | null {
  const day = ivaDueDay(ruc);
  if (day == null) return null;
  let due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day));
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6) {
    due = new Date(due.getTime() + 86_400_000);
  }
  return due;
}

const fmtDate = (d: Date): string =>
  `${d.getUTCDate()} de ${MONTHS_ES[d.getUTCMonth()]}`;

/** Threshold above which an accumulated IVA balance is worth flagging. */
const IVA_ALERT_THRESHOLD = 500_000;

/** Days without importing anything before we nudge. */
const STALE_CAPTURE_DAYS = 10;

export function buildInsights(input: InsightInput): Insight[] {
  const { summary: s, lastInvoiceAt, recentCount, recentTotal, now, ruc } = input;
  const recentDocs = input.recentDocs ?? recentCount;
  const out: Insight[] = [];

  // 1. What came in lately. This counts invoices by the day they were LOADED,
  // not by the day they were issued, and the two are often different months —
  // the client loaded August invoices in September and read "gastaste … en los
  // últimos 10 días" as his September spending. The card says what it means
  // now, and points at the month a comprobante actually counts in.
  if (recentCount > 0) {
    out.push({
      kind: 'gasto_periodo',
      level: 'info',
      title: `Cargaste ${recentCount} comprobante(s) en los últimos 10 días`,
      body:
        `Suman ${fmtGs(recentTotal)}. Cada uno cuenta en el mes que tiene impreso, ` +
        `no en el día que lo cargaste. En total llevás ${fmtGs(s.compras)} en compras.`,
      action: { label: 'Ver reportes', route: '/relatorios' },
    });
  }

  // 2. Accumulated IVA and when it falls due. Débito over crédito is what is
  // paid; crédito over débito is not a payment at all — it carries to the next
  // period, and calling it anything else worries a client who owes nothing.
  const saldo = s.ivaDebito - s.ivaCredito;
  if (s.totalIva >= IVA_ALERT_THRESHOLD) {
    const due = ivaDueDate(ruc, now);
    const dias = due ? daysBetween(due, now) : 0;
    const cuando = due
      ? `El IVA de ${MONTHS_ES[now.getUTCMonth()]} se presenta el ${fmtDate(due)}` +
        (dias > 0 ? ` (en ${dias} días)` : '') +
        ', por el último dígito de tu RUC; si cae feriado, pasa al siguiente día hábil.'
      : 'Cargá tu RUC en el perfil y te decimos el día exacto en que se presenta.';
    out.push({
      kind: 'iva_acumulado',
      level: saldo > 0 ? 'warning' : 'info',
      title:
        saldo > 0
          ? `Tenés ${fmtGs(saldo)} de IVA a pagar`
          : `Tenés ${fmtGs(Math.abs(saldo))} de IVA a favor`,
      body:
        `IVA débito ${fmtGs(s.ivaDebito)} · IVA crédito ${fmtGs(s.ivaCredito)}. ` +
        (saldo > 0
          ? `A pagar ${fmtGs(saldo)}. `
          : `No hay IVA a pagar: ${fmtGs(Math.abs(saldo))} quedan a favor para el período siguiente. `) +
        cuando,
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
      action: { label: 'Conectar correo', route: '/perfil/email' },
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
        action: { label: 'Sincronizar', route: '/perfil/email' },
      });
    }
  }

  // 4. Documents are in — which is not the same as a declaration being filed,
  // and "Vas al día" read as if it were.
  if (recentDocs >= 5) {
    const noComputables = recentDocs - recentCount;
    out.push({
      kind: 'aliento',
      level: 'success',
      title: 'Documentación importada',
      body:
        `${recentDocs} documento(s) en 10 días` +
        (noComputables > 0
          ? `: ${recentCount} computables y ${noComputables} sin IVA (notas de remisión). `
          : '. ') +
        'Con esto cargado, el cierre del mes no te agarra corriendo. ' +
        'Importar no es declarar: la presentación la hacés en Marangatu.',
    });
  }

  return out;
}
