import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { logger } from '../lib/logger';

/**
 * Google Cloud Vision — text from a photographed paper invoice.
 *
 * Called over REST with an API key rather than a service-account JSON: the
 * client's organisation enforces iam.disableServiceAccountKeyCreation, so no
 * JSON key can be issued. The upside is that this needs no auth library at
 * all, keeping the Docker image small.
 *
 * The key is a bearer secret. Restrict it to the Vision API in the Cloud
 * console, and cap the daily quota — a leak then costs a bounded amount rather
 * than the whole billing account.
 */

const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const TIMEOUT_MS = 25_000;

/** ~8 MB of base64 ≈ 6 MB of image; Vision rejects more than 20 MB outright. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function isOcrConfigured(): boolean {
  return Boolean(env.GOOGLE_VISION_API_KEY);
}

export async function extractText(imageBase64: string): Promise<string> {
  if (!env.GOOGLE_VISION_API_KEY) {
    throw AppError.serviceUnavailable(
      'La lectura de fotos no está habilitada en este servidor.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?key=${env.GOOGLE_VISION_API_KEY}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            // DOCUMENT_TEXT_DETECTION is the dense-text model: it handles the
            // printed form and the handwriting on it far better than the
            // generic TEXT_DETECTION.
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['es'] },
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 300) }, 'Vision request rejected');
      if (res.status === 403) {
        throw AppError.serviceUnavailable(
          'El servicio de lectura de imágenes rechazó la credencial. Avisá al soporte.',
        );
      }
      throw AppError.serviceUnavailable('No se pudo leer la imagen. Probá de nuevo.');
    }

    const data = (await res.json()) as {
      responses?: {
        fullTextAnnotation?: { text?: string };
        error?: { message?: string };
      }[];
    };

    const first = data.responses?.[0];
    if (first?.error?.message) {
      logger.warn({ err: first.error.message }, 'Vision returned a per-image error');
      throw AppError.badRequest('No se pudo procesar esa imagen. Probá con otra foto.');
    }

    const text = first?.fullTextAnnotation?.text?.trim();
    if (!text) {
      throw AppError.badRequest(
        'No encontramos texto en la foto. Sacá la foto más de cerca, con buena luz y la factura plana.',
      );
    }
    return text;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const aborted = (err as Error).name === 'AbortError';
    logger.warn({ err: (err as Error).message }, 'Vision call failed');
    throw AppError.serviceUnavailable(
      aborted
        ? 'La lectura tardó demasiado. Probá de nuevo con una foto más liviana.'
        : 'No se pudo conectar con el servicio de lectura. Probá de nuevo.',
    );
  } finally {
    clearTimeout(timer);
  }
}
