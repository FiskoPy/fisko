/**
 * Extracts the fiscal fields from the OCR text of a Paraguayan paper invoice
 * (factura de talonario).
 *
 * These are pre-printed forms filled in by hand, so nothing is guaranteed:
 * every field is optional and the caller decides what to do with what is
 * missing. The parser never guesses a number it did not read — a wrong total on
 * a tax record is worse than an empty one the user is asked to complete.
 */

export interface ParsedReceipt {
  emisorRuc: string | null;
  emisorDv: number | null;
  emisorNombre: string | null;
  receptorRuc: string | null;
  receptorNombre: string | null;
  timbrado: string | null;
  /** e.g. "001-001 0000071" */
  numeroDoc: string | null;
  fechaEmision: Date | null;
  total: number | null;
  iva5: number | null;
  iva10: number | null;
  /** Fields the OCR could not read; the app asks the user to fill these in. */
  missing: string[];
  /** Rough 0..1 signal of how much of the document we understood. */
  confidence: number;
}

const MONTHS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
};

/** Paraguayan amounts use "." for thousands and "," for decimals. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const norm = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** RUC as printed: 8 digits (or 6-7 for personal) plus a check digit. */
function findRuc(text: string, after?: RegExp): { ruc: string; dv: number } | null {
  const scope = after ? text.slice(text.search(after)) : text;
  const m = scope.match(/(\d{5,8})\s*[-–]\s*(\d)/);
  if (!m) return null;
  return { ruc: m[1] as string, dv: Number(m[2]) };
}

export function parseReceipt(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flat = lines.join('\n');
  const low = norm(flat);

  // --- Timbrado -----------------------------------------------------------
  const timbrado = flat.match(/timbrado\s*n?[°º:.\s]*(\d{6,10})/i)?.[1] ?? null;

  // --- Document number: "001-001 0000071" or "001-001-0000071" ------------
  const numeroDoc =
    flat.match(/(\d{3}\s*[-–]\s*\d{3}\s*[-–\s]\s*\d{6,7})/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;

  // --- Issuer RUC: the one printed in the header, before "Fecha" ----------
  const headerEnd = low.search(/fecha\s*de\s*emisi/);
  const header = headerEnd > 0 ? flat.slice(0, headerEnd) : flat;
  const emisor = findRuc(header);

  // --- Receiver RUC: printed next to the customer's name ------------------
  let receptorRuc: string | null = null;
  const recLine = lines.find((l) => /ruc/i.test(l) && !header.includes(l));
  if (recLine) receptorRuc = findRuc(recLine)?.ruc ?? null;

  // --- Issuer name: first substantial line that is not boilerplate --------
  const noise = /timbrado|factura|ruc|fecha|vigencia|contado|credito|crédito/i;
  const emisorNombre =
    lines.find((l) => l.length >= 4 && !noise.test(l) && /[a-zA-ZÁÉÍÓÚÑ]/.test(l)) ?? null;

  // --- Receiver name ------------------------------------------------------
  const receptorNombre =
    flat.match(/(?:nombre|raz[oó]n\s*social)\s*[:.]?\s*([^\n]{3,60})/i)?.[1]?.trim() ?? null;

  // --- Date: "19 de Agosto de 2026" or 19/08/2026 -------------------------
  let fechaEmision: Date | null = null;
  const written = low.match(/(\d{1,2})\s*de\s*([a-z]+)\s*de\s*(?:20)?(\d{2,4})/);
  if (written) {
    const month = MONTHS[written[2] as string];
    if (month !== undefined) {
      const y = Number(written[3]);
      fechaEmision = new Date(Date.UTC(y < 100 ? 2000 + y : y, month, Number(written[1])));
    }
  }
  if (!fechaEmision) {
    const numeric = flat.match(/(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{4})/);
    if (numeric) {
      fechaEmision = new Date(
        Date.UTC(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1])),
      );
    }
  }
  if (fechaEmision && Number.isNaN(fechaEmision.getTime())) fechaEmision = null;

  // --- IVA: the "LIQUIDACIÓN DEL IVA" footer ------------------------------
  const iva10 =
    flat.match(/\(?\s*10\s*%\s*\)?\s*[:.]?\s*([\d.,]{3,})/i)?.[1] ?? null;
  const iva5 = flat.match(/\(?\s*5\s*%\s*\)?\s*[:.]?\s*([\d.,]{3,})/i)?.[1] ?? null;

  // --- Total: prefer the line that says so, else the largest amount -------
  let total: number | null = null;
  const totalLine = flat.match(/total\s*(?:a\s*pagar)?\s*[:.]?\s*(?:gs\.?\s*)?([\d.,]{4,})/i)?.[1];
  if (totalLine) total = parseAmount(totalLine);
  if (total == null) {
    const amounts = [...flat.matchAll(/\b(\d{1,3}(?:\.\d{3})+(?:,\d+)?)\b/g)]
      .map((m) => parseAmount(m[1] as string))
      .filter((n): n is number => n != null);
    total = amounts.length ? Math.max(...amounts) : null;
  }

  const parsed: ParsedReceipt = {
    emisorRuc: emisor?.ruc ?? null,
    emisorDv: emisor?.dv ?? null,
    emisorNombre,
    receptorRuc,
    receptorNombre,
    timbrado,
    numeroDoc,
    fechaEmision,
    total,
    iva5: iva5 ? parseAmount(iva5) : null,
    iva10: iva10 ? parseAmount(iva10) : null,
    missing: [],
    confidence: 0,
  };

  // What the app must ask the user to complete.
  const required: [keyof ParsedReceipt, string][] = [
    ['emisorRuc', 'RUC del emisor'],
    ['emisorNombre', 'Nombre del emisor'],
    ['fechaEmision', 'Fecha'],
    ['total', 'Total'],
  ];
  parsed.missing = required.filter(([k]) => parsed[k] == null).map(([, label]) => label);

  const signals = [
    parsed.emisorRuc,
    parsed.emisorNombre,
    parsed.fechaEmision,
    parsed.total,
    parsed.timbrado,
    parsed.numeroDoc,
  ];
  parsed.confidence = signals.filter(Boolean).length / signals.length;

  return parsed;
}

/**
 * Stable identifier for a paper invoice, used where an electronic one has its
 * CDC. Built from issuer + document number so photographing the same invoice
 * twice deduplicates instead of creating a second record.
 */
export function receiptKey(p: ParsedReceipt): string {
  const parts = [
    p.emisorRuc ?? 'sinruc',
    p.numeroDoc?.replace(/\s+/g, '') ?? p.timbrado ?? 'sinnro',
    p.fechaEmision ? p.fechaEmision.toISOString().slice(0, 10) : 'sinfecha',
    p.total != null ? String(Math.round(p.total)) : 'sintotal',
  ];
  return `OCR:${parts.join(':')}`;
}
