import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { logger } from '../lib/logger';

/**
 * Pagopar — Marco 2 phase 2F.
 *
 * Two hashes matter and they are different:
 *  - starting a transaction: sha1(privateToken + idPedido + monto)
 *  - the webhook echo:       sha1(privateToken + hashPedido)
 *
 * The webhook one is the security boundary. Anyone can POST to a public
 * callback URL claiming an order was paid; only Pagopar can produce that
 * digest, because it needs the private token. Verifying it is what stands
 * between "paid" and "someone typed our URL into curl".
 */

const API = 'https://api.pagopar.com/api/comercios/2.0/iniciar-transaccion';
const TIMEOUT_MS = 20_000;

export function isPagoparConfigured(): boolean {
  return Boolean(env.PAGOPAR_PUBLIC_TOKEN && env.PAGOPAR_PRIVATE_TOKEN);
}

function privateToken(): string {
  const t = env.PAGOPAR_PRIVATE_TOKEN;
  if (!t) {
    throw AppError.serviceUnavailable('Los pagos no están habilitados en este servidor.');
  }
  return t;
}

const sha1 = (s: string): string => createHash('sha1').update(s, 'utf8').digest('hex');

/** Digest Pagopar expects when opening a transaction. */
export function transactionToken(idPedido: string, montoTotal: number): string {
  // Mirrors Pagopar's PHP reference: strval(floatval($monto)).
  const monto = String(Number(montoTotal));
  return sha1(`${privateToken()}${idPedido}${monto}`);
}

/**
 * Verifies a webhook payload really came from Pagopar.
 *
 * Compared in constant time: a plain `===` on a digest leaks, byte by byte,
 * how much of a guess was right.
 */
export function verifyWebhookToken(hashPedido: string, received: string): boolean {
  const expected = sha1(`${privateToken()}${hashPedido}`);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(received ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface CheckoutBuyer {
  nombre: string;
  email: string;
  ruc: string | null;
  telefono: string | null;
}

export interface CheckoutItem {
  nombre: string;
  precioGs: number;
  idProducto: string;
  descripcion: string;
}

export interface CheckoutInput {
  idPedido: string;
  montoGs: number;
  buyer: CheckoutBuyer;
  item: CheckoutItem;
  maxPaymentDate: Date;
}

export interface CheckoutResult {
  /** Order hash Pagopar assigns; the webhook echoes it back. */
  hashPedido: string;
  /** Where to send the user to pay. */
  redirectUrl: string;
}

/**
 * Opens a transaction and returns where to send the user.
 *
 * Note the date format: Pagopar expects "YYYY-MM-DD HH:mm:ss", not ISO — an
 * ISO string is rejected with an unhelpful error.
 */
/**
 * Pagopar's numeric id_producto. The catalogue is ours; Pagopar only needs a
 * stable number per product.
 */
const PRODUCT_IDS: Record<string, number> = { gratis: 1, basico: 2, pro: 3, empresarial: 4 };

/**
 * The request body for iniciar-transaccion, exactly as Pagopar documents it:
 *  - tipo_documento is always "CI"; the RUC goes in its own field as "base-dv".
 *  - documento carries digits only (the RUC base, since we hold no CI).
 *  - every item needs ciudad and the vendor public_key, even without courier.
 *  - forma_pago is omitted so the buyer picks the method on Pagopar's page.
 * Exported so the shape is tested without a network.
 */
export function buildTransactionBody(input: CheckoutInput) {
  const rucBase = ((input.buyer.ruc ?? '').split('-')[0] ?? '').replace(/\D/g, '');
  return {
    token: transactionToken(input.idPedido, input.montoGs),
    public_key: env.PAGOPAR_PUBLIC_TOKEN,
    monto_total: input.montoGs,
    tipo_pedido: 'VENTA-COMERCIO',
    id_pedido_comercio: input.idPedido,
    fecha_maxima_pago: formatPagoparDate(input.maxPaymentDate),
    descripcion_resumen: input.item.descripcion,
    comprador: {
      ruc: input.buyer.ruc ?? '',
      email: input.buyer.email,
      nombre: input.buyer.nombre,
      telefono: input.buyer.telefono ?? '',
      documento: rucBase,
      tipo_documento: 'CI',
      razon_social: '',
      ciudad: '1',
      direccion: '',
      direccion_referencia: '',
      coordenadas: '',
    },
    compras_items: [
      {
        nombre: input.item.nombre,
        descripcion: input.item.descripcion,
        cantidad: 1,
        precio_total: input.montoGs,
        id_producto: PRODUCT_IDS[input.item.idProducto] ?? 0,
        categoria: '909', // "Servicios" in Pagopar's catalogue
        ciudad: '1',
        public_key: env.PAGOPAR_PUBLIC_TOKEN,
        url_imagen: '',
        vendedor_telefono: '',
        vendedor_direccion: '',
        vendedor_direccion_referencia: '',
        vendedor_direccion_coordenadas: '',
      },
    ],
  };
}

/** "YYYY-MM-DD HH:mm:ss" — Pagopar rejects ISO 8601. */
function formatPagoparDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

export async function createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  if (!env.PAGOPAR_PUBLIC_TOKEN) {
    throw AppError.serviceUnavailable('Los pagos no están habilitados en este servidor.');
  }

  const body = buildTransactionBody(input);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => null)) as {
      respuesta?: boolean;
      // On success an array of {data, pedido}; on failure a plain string with
      // the reason ("Token no coincide.", a field rule, ...).
      resultado?: { data?: string; pedido?: string }[] | { data?: string } | string;
      mensaje?: string;
    } | null;

    if (!res.ok || !data || data.respuesta === false) {
      const reason =
        typeof data?.resultado === 'string' ? data.resultado : (data?.mensaje ?? null);
      logger.warn(
        { status: res.status, reason, idPedido: input.idPedido },
        'Pagopar rejected the transaction',
      );
      // The reason travels in `details`, not in `message`: the app shows the
      // message, and an operator reading the response gets the actual cause.
      throw AppError.badRequest(
        'No se pudo iniciar el pago. Probá de nuevo en unos minutos.',
        reason ? { pagopar: reason } : undefined,
      );
    }

    const first = Array.isArray(data.resultado)
      ? data.resultado[0]
      : typeof data.resultado === 'object'
        ? data.resultado
        : undefined;
    const hashPedido = first?.data;
    if (!hashPedido) {
      logger.warn({ data }, 'Pagopar responded without an order hash');
      throw AppError.badRequest('No se pudo iniciar el pago. Probá de nuevo.');
    }

    return {
      hashPedido,
      redirectUrl: `https://www.pagopar.com/pagos/${hashPedido}`,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err: (err as Error).message }, 'Pagopar call failed');
    throw AppError.serviceUnavailable(
      'No se pudo conectar con el medio de pago. Probá de nuevo.',
    );
  } finally {
    clearTimeout(timer);
  }
}
