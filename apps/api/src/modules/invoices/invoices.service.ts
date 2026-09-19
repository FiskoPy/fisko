import type { Invoice, InvoiceItem, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../errors/app-error';
import { parseDte, isValidCdcCheckDigit } from '../../services/sifen';
import { extractText, MAX_IMAGE_BYTES } from '../../services/ocr';
import {
  docDigits,
  layoutSkeleton,
  parseBest,
  receiptKey,
  type ParsedReceipt,
  type Reading,
} from '../../services/receipt-parser';
import { normalizeRuc } from '../../utils/ruc';

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

const n = (d: Prisma.Decimal | number): number => (typeof d === 'number' ? d : Number(d));

export interface PublicInvoiceItem {
  id: string;
  codigo: string | null;
  descripcion: string;
  cantidad: number;
  precioUnit: number;
  total: number;
  ivaRate: number;
  ivaBase: number;
  ivaMonto: number;
}

export interface PublicInvoice {
  id: string;
  cdc: string;
  tipoDoc: number;
  tipoDocDesc: string | null;
  emisorRuc: string;
  emisorDv: number | null;
  emisorNombre: string;
  receptorRuc: string | null;
  receptorNombre: string | null;
  fechaEmision: Date;
  moneda: string;
  totalOpe: number;
  totalIva: number;
  iva5: number;
  iva10: number;
  baseGrav5: number;
  baseGrav10: number;
  originalCdc: string | null;
  source: string;
  createdAt: Date;
  items?: PublicInvoiceItem[];
}

function toPublicItem(i: InvoiceItem): PublicInvoiceItem {
  return {
    id: i.id,
    codigo: i.codigo,
    descripcion: i.descripcion,
    cantidad: n(i.cantidad),
    precioUnit: n(i.precioUnit),
    total: n(i.total),
    ivaRate: i.ivaRate,
    ivaBase: n(i.ivaBase),
    ivaMonto: n(i.ivaMonto),
  };
}

export function toPublicInvoice(inv: Invoice & { items?: InvoiceItem[] }): PublicInvoice {
  return {
    id: inv.id,
    cdc: inv.cdc,
    tipoDoc: inv.tipoDoc,
    tipoDocDesc: inv.tipoDocDesc,
    emisorRuc: inv.emisorRuc,
    emisorDv: inv.emisorDv,
    emisorNombre: inv.emisorNombre,
    receptorRuc: inv.receptorRuc,
    receptorNombre: inv.receptorNombre,
    fechaEmision: inv.fechaEmision,
    moneda: inv.moneda,
    totalOpe: n(inv.totalOpe),
    totalIva: n(inv.totalIva),
    iva5: n(inv.iva5),
    iva10: n(inv.iva10),
    baseGrav5: n(inv.baseGrav5),
    baseGrav10: n(inv.baseGrav10),
    originalCdc: inv.originalCdc,
    source: inv.source,
    createdAt: inv.createdAt,
    ...(inv.items ? { items: inv.items.map(toPublicItem) } : {}),
  };
}

/** Parses a DTE XML, validates it, dedups by (user, CDC) and stores it. */
/** A DTE belongs to a taxpayer when they are its emisor or its receptor. */
export function dteBelongsTo(
  dte: { emisorRuc: string; receptorRuc: string | null },
  ruc: string,
): boolean {
  // Compare RUC bases: the DTE carries the base and the check digit in
  // separate fields, and a caller may hand us "base-dv".
  const base = (r: string) => normalizeRuc(r.split('-')[0] ?? '');
  const mine = base(ruc);
  if (!mine) return true;
  if (base(dte.emisorRuc) === mine) return true;
  return dte.receptorRuc != null && base(dte.receptorRuc) === mine;
}

export interface ImportOptions {
  /**
   * When set, the DTE must name this RUC as emisor or receptor. Used by the
   * mailbox sync: anyone who knows the user's address can e-mail them a valid
   * DTE, and without this check it would land in their tax records.
   */
  expectRuc?: string | null;
}

/**
 * The document number a CDC encodes — digits 12 to 24 — when it is an invoice
 * (type 01). Other document types are numbered apart, so they never match.
 */
function cdcDocDigits(cdc: string): string | null {
  return /^01\d{42}$/.test(cdc) ? cdc.slice(11, 24) : null;
}

/** Two stored dates on the same calendar day (both are kept as UTC days). */
const sameDay = (a: Date, b: Date): boolean => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/**
 * Photos stored for this XML's invoice: under its CDC (a KuDE whose CDC was
 * read), or as the same issuer's same document number (one whose CDC was not).
 *
 * These are deleted, and a deletion is not undone: the same number under a
 * new timbrado is another invoice. So a number match also needs the photo to
 * carry the XML's date or its total.
 */
async function photosOf(
  userId: string,
  dte: { cdc: string; emisorRuc: string; fechaEmision: Date; totalOpe: number },
): Promise<string[]> {
  const doc = cdcDocDigits(dte.cdc);
  const stored = await prisma.invoice.findMany({
    where: { userId, source: 'ocr', OR: [{ cdc: dte.cdc }, { emisorRuc: dte.emisorRuc }] },
    select: { id: true, cdc: true, emisorRuc: true, numeroDoc: true, fechaEmision: true, totalOpe: true },
  });
  return stored
    .filter(
      (i) =>
        i.cdc === dte.cdc ||
        (doc != null &&
          i.emisorRuc === dte.emisorRuc &&
          i.numeroDoc != null &&
          docDigits(i.numeroDoc) === doc &&
          (sameDay(i.fechaEmision, dte.fechaEmision) || Math.round(n(i.totalOpe)) === Math.round(dte.totalOpe))),
    )
    .map((i) => i.id);
}

/**
 * An invoice already stored that this photo shows again: under one of these
 * keys, or — whatever its source — as the issuer's same document number. A
 * retake that reads the total differently is still the same invoice, and so
 * is a KuDE whose XML came by mail.
 */
async function findSameInvoice(userId: string, parsed: ParsedReceipt, keys: string[]) {
  const byKey = await prisma.invoice.findFirst({
    where: { userId, cdc: { in: keys } },
    select: { id: true },
  });
  if (byKey) return byKey;

  const doc = parsed.numeroDoc ? docDigits(parsed.numeroDoc) : null;
  if (!parsed.emisorRuc || !doc) return null;
  const sameIssuer = await prisma.invoice.findMany({
    where: { userId, emisorRuc: parsed.emisorRuc },
    select: { id: true, cdc: true, numeroDoc: true, timbrado: true, fechaEmision: true, totalOpe: true },
  });
  return (
    sameIssuer.find((i) => {
      if ((i.numeroDoc ? docDigits(i.numeroDoc) : cdcDocDigits(i.cdc)) !== doc) return false;
      // The same number under a new timbrado is another invoice. But any one
      // field can be misread on a retake, and a duplicate counts the IVA
      // twice: it takes two fields that both differ to call it another one.
      const differ = [
        i.timbrado != null && parsed.timbrado != null && i.timbrado !== parsed.timbrado,
        parsed.fechaEmision != null && !sameDay(i.fechaEmision, parsed.fechaEmision),
        parsed.total != null && Math.round(n(i.totalOpe)) !== Math.round(parsed.total),
      ].filter(Boolean).length;
      return differ < 2;
    }) ?? null
  );
}

export async function importXml(
  userId: string,
  xml: string,
  source = 'manual',
  opts: ImportOptions = {},
): Promise<PublicInvoice> {
  const dte = parseDte(xml);

  if (opts.expectRuc && !dteBelongsTo(dte, opts.expectRuc)) {
    throw AppError.badRequest(
      'La factura no está a tu nombre: ni el emisor ni el receptor coinciden con tu RUC.',
      { emisorRuc: dte.emisorRuc, receptorRuc: dte.receptorRuc },
    );
  }

  if (!isValidCdcCheckDigit(dte.cdc)) {
    throw AppError.badRequest('CDC inválido (dígito verificador no coincide)');
  }

  const existing = await prisma.invoice.findUnique({
    where: { userId_cdc: { userId, cdc: dte.cdc } },
    select: { id: true, source: true },
  });
  if (existing && existing.source !== 'ocr') {
    throw AppError.conflict('Esta factura ya fue importada', { cdc: dte.cdc });
  }
  // A photo of this same invoice is replaced, not kept beside it: the XML is
  // the invoice itself — SIFEN's own amounts, with its items — and keeping
  // both would count its IVA twice.
  const photos = await photosOf(userId, dte);

  const create = prisma.invoice.create({
    data: {
      userId,
      cdc: dte.cdc,
      tipoDoc: dte.tipoDoc,
      tipoDocDesc: dte.tipoDocDesc,
      emisorRuc: dte.emisorRuc,
      emisorDv: dte.emisorDv,
      emisorNombre: dte.emisorNombre,
      receptorRuc: dte.receptorRuc,
      receptorDv: dte.receptorDv,
      receptorNombre: dte.receptorNombre,
      fechaEmision: dte.fechaEmision,
      moneda: dte.moneda,
      tipoCambio: dte.tipoCambio,
      totalOpe: dte.totalOpe,
      totalIva: dte.totalIva,
      iva5: dte.iva5,
      iva10: dte.iva10,
      baseGrav5: dte.baseGrav5,
      baseGrav10: dte.baseGrav10,
      originalCdc: dte.originalCdc,
      source,
      xmlRaw: xml.length <= 200_000 ? xml : null,
      items: {
        create: dte.items.map((it) => ({
          codigo: it.codigo,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          precioUnit: it.precioUnit,
          total: it.total,
          ivaRate: it.ivaRate,
          ivaBase: it.ivaBase,
          ivaMonto: it.ivaMonto,
        })),
      },
    },
    include: { items: true },
  });
  const created = photos.length
    ? (await prisma.$transaction([prisma.invoice.deleteMany({ where: { id: { in: photos } } }), create]))[1]
    : await create;

  return toPublicInvoice(created);
}

export interface ListInvoicesQuery {
  from?: Date;
  to?: Date;
  tipoDoc?: number;
  page: number;
  pageSize: number;
}

export async function listInvoices(userId: string, q: ListInvoicesQuery) {
  const where: Prisma.InvoiceWhereInput = {
    userId,
    ...(q.tipoDoc ? { tipoDoc: q.tipoDoc } : {}),
    ...(q.from || q.to
      ? { fechaEmision: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { fechaEmision: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    items: rows.map((r) => toPublicInvoice(r)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getInvoice(userId: string, id: string): Promise<PublicInvoice> {
  const inv = (await prisma.invoice.findFirst({
    where: { id, userId },
    include: { items: true },
  })) as InvoiceWithItems | null;
  if (!inv) throw AppError.notFound('Factura no encontrada');
  return toPublicInvoice(inv);
}

export async function deleteInvoice(userId: string, id: string): Promise<void> {
  const res = await prisma.invoice.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw AppError.notFound('Factura no encontrada');
}


export interface ImportPhotoResult {
  invoice: Awaited<ReturnType<typeof importXml>>;
  /** Fields the OCR could not read — the app asks the user to complete them. */
  missing: string[];
  confidence: number;
}

/**
 * Marco 2 phase 2D — import a photographed paper invoice (talonario).
 *
 * A paper invoice has no CDC, so `cdc` holds a synthetic key derived from
 * issuer + document number + date + total: photographing the same invoice
 * twice deduplicates instead of creating a second record. A KuDE — the
 * printed copy of an electronic invoice — is the exception: it carries its
 * CDC, and is stored under it, so its XML is recognised as the same invoice. What the form
 * actually prints goes into timbrado/numeroDoc.
 *
 * Anything the OCR could not read is reported in `missing` rather than
 * guessed. A wrong figure on a tax record is worse than an absent one.
 */
export async function importPhoto(userId: string, imageBase64: string) {
  const bytes = Math.floor((imageBase64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw AppError.badRequest(
      'La foto es demasiado grande. Sacala de nuevo o reducí la calidad.',
    );
  }

  // Several readings of the same words — the printed rows rebuilt from where
  // each word sits, and Vision's own block order — and keep the one whose
  // numbers add up: a wrong layout pairs labels with the wrong amounts (see
  // layoutsOf and parseBest). Vision's text is never empty here.
  const ocr = await extractText(imageBase64);
  const { parsed, text, layout } = (parseBest(ocr.layouts) ??
    parseBest([{ layout: 'blocks', text: ocr.text }])) as Reading;

  if (parsed.nota) {
    throw AppError.badRequest(
      `Las notas de ${parsed.nota === 'credito' ? 'crédito' : 'débito'} todavía no se cargan por foto. ` +
        'Importá su XML.',
    );
  }

  if (parsed.foreignCurrency) {
    // A dollar invoice adds up in dollars, so the checks below would pass it,
    // and it was stored as guaraníes (2026-09-19). Its XML carries the
    // currency and the exchange rate; a photo cannot.
    throw AppError.badRequest(
      `Esta factura está en ${parsed.foreignCurrency === 'USD' ? 'dólares' : 'moneda extranjera'}, ` +
        'y la foto sólo lee guaraníes. Cargala con su XML, o dejá que llegue por correo: ' +
        'así se registra con su tipo de cambio.',
    );
  }

  if (parsed.total == null) {
    // Three real photos failed here on 2026-09-13 and the only record was
    // "400", so the layout that defeated the parser was unrecoverable. Log the
    // layout, then — but ONLY the layout: a receipt's text carries the buyer's
    // name and CI/RUC, and Render keeps these logs outside our control. The
    // skeleton keeps fiscal labels and number shapes and masks everything
    // else, and no user id rides on the same line.
    logger.warn(
      {
        lines: text.split(/\r?\n/).length,
        reading: layout,
        missing: parsed.missing,
        layout: layoutSkeleton(text),
      },
      'import-photo: no total found in OCR text',
    );
    throw AppError.badRequest(
      'No pudimos leer el total de la factura. Sacá una foto por factura, de ' +
        'cerca, con buena luz y la factura plana sobre una superficie oscura.',
    );
  }

  if (parsed.totalsAgree === false) {
    // The amounts contradict each other — the total against gravadas plus
    // exentas, or an IVA against its own gravada — so one of them is misread
    // and nothing says which. Storing it put a Gs 223.150 ticket on record as
    // Gs 29 (2026-09-15). Same logging rule as above.
    logger.warn(
      {
        lines: text.split(/\r?\n/).length,
        reading: layout,
        missing: parsed.missing,
        layout: layoutSkeleton(text),
      },
      'import-photo: amounts contradict each other',
    );
    throw AppError.badRequest(
      'Los montos de la factura no cuadran entre sí, así que no la guardamos. ' +
        'Sacá la foto de nuevo: una sola factura por foto, bien derecha, con ' +
        'buena luz y el papel plano.',
    );
  }

  if (parsed.missing.includes('IVA')) {
    // No IVA read at all — and the IVA is what this record is for. Stored
    // anyway, a photo showed "Gs 0" on every tax line (a diesel ticket,
    // 2026-09-14) and read as a purchase without IVA. An exempt-only invoice
    // is not refused: the parser does not report its IVA as missing.
    logger.warn(
      {
        lines: text.split(/\r?\n/).length,
        reading: layout,
        missing: parsed.missing,
        layout: layoutSkeleton(text),
      },
      'import-photo: no IVA found in OCR text',
    );
    throw AppError.badRequest(
      'No pudimos leer el IVA de la factura. Sacá la foto de nuevo, que se vea ' +
        'bien el pie con la liquidación del IVA.',
    );
  }

  if (parsed.fechaEmision == null) {
    // Stored anyway, it took the day of the upload and landed in the wrong
    // month's IVA. Same logging rule as above.
    logger.warn(
      {
        lines: text.split(/\r?\n/).length,
        reading: layout,
        missing: parsed.missing,
        layout: layoutSkeleton(text),
      },
      'import-photo: no date found in OCR text',
    );
    throw AppError.badRequest(
      'No pudimos leer la fecha de la factura. Sacá la foto de nuevo, que se vea ' +
        'bien la fecha de emisión.',
    );
  }

  if (parsed.missing.length) {
    // An import that goes through with fields missing was silent on the
    // server. On 2026-09-14 a fuel ticket came back with its total but no IVA
    // and no RUC, and nothing here said which layout defeated the parser.
    // Same rule as above: the layout only, never the text or the user.
    logger.warn(
      {
        lines: text.split(/\r?\n/).length,
        reading: layout,
        missing: parsed.missing,
        layout: layoutSkeleton(text),
      },
      'import-photo: imported with fields missing',
    );
  }

  // A KuDE keys by its printed CDC — what the XML of the same invoice carries;
  // anything else by issuer, number, date and total.
  const key = parsed.cdc ?? receiptKey(parsed);
  const existing = await findSameInvoice(userId, parsed, [key, receiptKey(parsed)]);
  if (existing) {
    throw AppError.conflict(
      'Esta factura ya fue importada. Si quedó mal, borrala y sacá la foto de nuevo.',
    );
  }

  const iva10 = parsed.iva10 ?? 0;
  const iva5 = parsed.iva5 ?? 0;

  const invoice = await prisma.invoice.create({
    data: {
      userId,
      cdc: key,
      tipoDoc: 1, // Factura
      tipoDocDesc: parsed.cdc ? 'Factura electrónica (foto)' : 'Factura (papel)',
      emisorRuc: parsed.emisorRuc ?? '',
      emisorDv: parsed.emisorDv,
      emisorNombre: parsed.emisorNombre ?? 'Sin identificar',
      receptorRuc: parsed.receptorRuc,
      receptorNombre: parsed.receptorNombre,
      fechaEmision: parsed.fechaEmision,
      moneda: 'PYG',
      timbrado: parsed.timbrado,
      numeroDoc: parsed.numeroDoc,
      totalOpe: parsed.total,
      totalIva: iva10 + iva5,
      iva5,
      iva10,
      // baseGrav is the NET taxable base — the same thing SIFEN calls
      // dBaseGrav, so the XML and photo paths can be summed together.
      //
      // The ticket prints the GROSS amount ("TOTAL GRAVADAS 10%: 545.600"),
      // which is base + IVA. Subtract when we read it; fall back to deriving
      // from the tax only when we did not. iva*10 and iva*20 are the correct
      // multipliers for the NET base (49.600*10 = 496.000 = 545.600 - 49.600).
      baseGrav5:
        parsed.gravada5 != null ? Math.max(0, Math.round(parsed.gravada5 - iva5)) : iva5 * 20,
      baseGrav10:
        parsed.gravada10 != null ? Math.max(0, Math.round(parsed.gravada10 - iva10)) : iva10 * 10,
      source: 'ocr',
    },
    include: { items: true },
  });

  // The raw Prisma row serialises Decimal columns as strings, which the app's
  // parser rejects — after the invoice was already stored. Same shape as
  // import-xml, so the client has one Invoice to understand.
  return { invoice: toPublicInvoice(invoice), missing: parsed.missing, confidence: parsed.confidence };
}
