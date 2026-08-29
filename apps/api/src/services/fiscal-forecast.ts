import { env } from '../config/env';
import { logger } from '../lib/logger';
import type { MonthBucket } from '../modules/reports/reports.service';

/**
 * Projects the IVA to the end of the current month.
 *
 * This is the one place in phase 2E where a model is worth calling: turning an
 * uneven history of months into a plain-Spanish read of where the period is
 * heading. Everything else in the feature is deterministic rules.
 *
 * The arithmetic projection is computed FIRST and always returned. The model
 * only writes the sentence around it, and any failure — no key, rate limit,
 * timeout, bad JSON — falls back to a sentence we wrote. A tax app must never
 * show nothing because a third party was down, and must never show a number
 * the model invented.
 */

export interface IvaForecast {
  /** Guaraníes of IVA expected by the end of the month. */
  projected: number;
  /** IVA accumulated so far this month. */
  soFar: number;
  /** One or two sentences in es-PY. */
  comment: string;
  /** True when the sentence came from the model rather than the fallback. */
  fromModel: boolean;
}

const MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 8_000;

const fmtGs = (v: number): string =>
  'Gs ' + Math.round(v).toLocaleString('es-PY').replace(/,/g, '.');

/**
 * Straight-line projection: what this month's IVA becomes if the rest of the
 * month behaves like the days elapsed so far. Deliberately simple — it is the
 * number of record, and a reader must be able to redo it by hand.
 */
export function projectIva(byMonth: MonthBucket[], now: Date): { projected: number; soFar: number } {
  const key = now.toISOString().slice(0, 7);
  const soFar = byMonth.find((m) => m.month === key)?.iva ?? 0;

  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  if (dayOfMonth <= 0) return { projected: soFar, soFar };

  return { projected: (soFar / dayOfMonth) * daysInMonth, soFar };
}

function fallbackComment(soFar: number, projected: number, now: Date): string {
  if (soFar <= 0) {
    return 'Todavía no hay IVA registrado este mes. Importá tus facturas para ver la proyección.';
  }
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const restantes = daysInMonth - now.getUTCDate();
  return (
    `Llevás ${fmtGs(soFar)} de IVA este mes. Si el ritmo se mantiene, ` +
    `terminás cerca de ${fmtGs(projected)} en ${restantes} día(s).`
  );
}

export async function forecastIva(byMonth: MonthBucket[], now: Date): Promise<IvaForecast> {
  const { projected, soFar } = projectIva(byMonth, now);
  const fallback: IvaForecast = {
    projected,
    soFar,
    comment: fallbackComment(soFar, projected, now),
    fromModel: false,
  };

  if (!env.OPENAI_API_KEY || soFar <= 0) return fallback;

  const history = byMonth
    .slice(-6)
    .map((m) => `${m.month}: IVA ${Math.round(m.iva)} Gs en ${m.count} comprobantes`)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              'Sos un asistente fiscal paraguayo. Escribís en español rioplatense (voseo), ' +
              'claro y breve: máximo 2 oraciones, sin saludos ni emojis. ' +
              'NO inventes cifras: usá únicamente los números que te doy. ' +
              'No des asesoría legal ni afirmes obligaciones específicas.',
          },
          {
            role: 'user',
            content:
              `Historial de IVA por mes:\n${history}\n\n` +
              `Este mes lleva ${Math.round(soFar)} Gs de IVA y la proyección lineal ` +
              `a fin de mes es ${Math.round(projected)} Gs.\n` +
              `Comentá en 2 oraciones cómo viene el mes comparado con los anteriores.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'IVA forecast: OpenAI rejected the request');
      return fallback;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const comment = data.choices?.[0]?.message?.content?.trim();
    if (!comment) return fallback;

    return { projected, soFar, comment, fromModel: true };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'IVA forecast: falling back to arithmetic');
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
