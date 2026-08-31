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
export async function createCheckout(input: {
  idPedido: string;
  montoGs: number;
  buyer: CheckoutBuyer;
  item: CheckoutItem;
  maxPaymentDate: Date;
}): Promise<CheckoutResult> {
  if (!env.PAGOPAR_PUBLIC_TOKEN) {
    throw AppError.serviceUnavailable('Los pagos no están habilitados en este servidor.');
  }

  const d = input.maxPaymentDate;
  const pad = (n: number) => String(n).padStart(2, '0');
  const fechaMaxima =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

  const body = {
    token: transactionToken(input.idPedido, input.montoGs),
    public_key: env.PAGOPAR_PUBLIC_TOKEN,
    monto_total: input.montoGs,
    tipo_pedido: 'VENTA-COMERCIO',
    id_pedido_comercio: input.idPedido,
    fecha_maxima_pago: fechaMaxima,
    descripcion_resumen: input.item.descripcion,
    comprador: {
      ruc: input.buyer.ruc ?? '',
      email: input.buyer.email,
      nombre: input.buyer.nombre,
      telefono: input.buyer.telefono ?? '',
      documento: input.buyer.ruc ?? '',
      tipo_documento: input.buyer.ruc ? 'RUC' : 'CI',
      ciudad: '1',
      direccion: '',
      coordenadas: '',
      railway_send: false,
    },
    compras_items: [
      {
        nombre: input.item.nombre,
        cantidad: 1,
        categoria: '909', // "Servicios" in Pagopar's catalogue
        precio_total: input.montoGs,
        id_producto: input.item.idProducto,
        descripcion: input.item.descripcion,
      },
    ],
  };

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
      resultado?: { data?: string; pedido?: string }[] | { data?: string };
      mensaje?: string;
    } | null;

    if (!res.ok || !data || data.respuesta === false) {
      logger.warn(
        { status: res.status, mensaje: data?.mensaje, idPedido: input.idPedido },
        'Pagopar rejected the transaction',
      );
      throw AppError.badRequest(
        'No se pudo iniciar el pago. Probá de nuevo en unos minutos.',
      );
    }

    const first = Array.isArray(data.resultado) ? data.resultado[0] : data.resultado;
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
