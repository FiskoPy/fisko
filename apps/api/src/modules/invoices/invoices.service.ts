import type { Invoice, InvoiceItem, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../errors/app-error';
import { parseDte, isValidCdcCheckDigit } from '../../services/sifen';
import { readInvoiceWithAI } from '../../services/ai-reader';
import {
  CATEGORIES,
  categorize,
  categoryLabel,
  type CategoryKey,
} from '../../services/categories';
import { officialRate, type OfficialRate } from '../../services/exchange-rates';
import { fillPendingRatesBriefly } from '../../services/pending-rates';
import { extractText, MAX_IMAGE_BYTES } from '../../services/ocr';
import { decidePhoto, settledCurrency, type PhotoDecision } from '../../services/photo-decision';
import {
  docDigits,
  fromExtraction,
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
  /** Guaraníes per unit of `moneda`, for anything not issued in guaraníes. */
  tipoCambio: number | null;
  /**
   * Where the rate came from when the invoice did not print one: "dnit", the
   * close the law names, or "manual" — or "pendiente", waiting for the DNIT's
   * close (no rate yet). Null: the invoice's own.
   */
  tipoCambioFuente: 'dnit' | 'manual' | 'pendiente' | null;
  /** For a DNIT rate, given or awaited, the day whose close it is (YYYY-MM-DD). */
  tipoCambioFecha: string | null;
  totalOpe: number;
  totalIva: number;
  iva5: number;
  iva10: number;
  baseGrav5: number;
  baseGrav10: number;
  exentas: number;
  /**
   * Which side of the IVA this is: a sale of the taxpayer's own (débito
   * fiscal) or a purchase (crédito fiscal computable). DNIT keeps them apart
   * and so must the screen — they cannot be added into one IVA figure.
   */
  tipo: 'venta' | 'compra';
  tipoManual: boolean;
  /** The category: the one set by hand, or the one the rules derive. */
  categoria: string;
  categoriaLabel: string;
  categoriaManual: boolean;
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

/** What the invoice is filed under, and whether a person chose it. */
function categoryOf(inv: Invoice & { items?: InvoiceItem[] }): {
  categoria: string;
  categoriaLabel: string;
  categoriaManual: boolean;
} {
  const manual = inv.categoria as CategoryKey | null;
  const key =
    manual ??
    categorize(inv.emisorNombre ?? '', (inv.items ?? []).map((i) => i.descripcion));
  return { categoria: key, categoriaLabel: categoryLabel(key), categoriaManual: manual != null };
}

/**
 * Sale or purchase, by the taxpayer's own RUC: issuer is the taxpayer means a
 * sale. A correction stored on the invoice wins — the reader cannot always
 * tell, and the person can.
 */
export function ledgerSideOf(
  inv: { emisorRuc: string; esVenta?: boolean | null },
  ownRuc: string | null,
): { tipo: 'venta' | 'compra'; tipoManual: boolean } {
  if (inv.esVenta != null) return { tipo: inv.esVenta ? 'venta' : 'compra', tipoManual: true };
  const own = ownRuc ? normalizeRuc(ownRuc) : null;
  const venta = own != null && normalizeRuc(inv.emisorRuc) === own;
  return { tipo: venta ? 'venta' : 'compra', tipoManual: false };
}

export function toPublicInvoice(
  inv: Invoice & { items?: InvoiceItem[] },
  ownRuc: string | null = null,
): PublicInvoice {
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
    // The rate the invoice itself carries: without it the app can show USD
    // 3.420 but not what that is in guaraníes, which is the figure the month
    // is closed with.
    tipoCambio: inv.tipoCambio == null ? null : n(inv.tipoCambio),
    tipoCambioFuente:
      inv.tipoCambioFuente === 'dnit' || inv.tipoCambioFuente === 'manual' || inv.tipoCambioFuente === 'pendiente'
        ? inv.tipoCambioFuente
        : null,
    tipoCambioFecha:
      inv.tipoCambioFuente === 'dnit' || inv.tipoCambioFuente === 'pendiente' ? closeDayOf(inv.fechaEmision) : null,
    totalOpe: n(inv.totalOpe),
    totalIva: n(inv.totalIva),
    iva5: n(inv.iva5),
    iva10: n(inv.iva10),
    baseGrav5: n(inv.baseGrav5),
    baseGrav10: n(inv.baseGrav10),
    exentas: n(inv.exentas),
    ...categoryOf(inv),
    ...ledgerSideOf(inv, ownRuc),
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
      exentas: dte.exentas,
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
  /** One side of the ledger — sales or purchases — or both when absent. */
  tipo?: 'venta' | 'compra';
  from?: Date;
  to?: Date;
  tipoDoc?: number;
  page: number;
  pageSize: number;
}

export async function listInvoices(userId: string, q: ListInvoicesQuery) {
  await fillPendingRatesBriefly(userId);
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { ruc: true } });
  const ownRuc = owner?.ruc ? normalizeRuc(owner.ruc) : null;

  // "Ventas" are the invoices this taxpayer issued; everything else is a
  // purchase. A correction on the invoice overrides the RUC either way.
  const side: Prisma.InvoiceWhereInput =
    q.tipo === 'venta'
      ? { OR: [{ esVenta: true }, ...(ownRuc ? [{ esVenta: null, emisorRuc: ownRuc }] : [])] }
      : q.tipo === 'compra'
        ? {
            OR: [
              { esVenta: false },
              { esVenta: null, ...(ownRuc ? { NOT: { emisorRuc: ownRuc } } : {}) },
            ],
          }
        : {};

  const where: Prisma.InvoiceWhereInput = {
    userId,
    ...(q.tipoDoc ? { tipoDoc: q.tipoDoc } : {}),
    ...(q.from || q.to
      ? { fechaEmision: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
    ...side,
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
    items: rows.map((r) => toPublicInvoice(r, ownRuc)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** The user's RUC, which says whether an invoice is a sale or a purchase. */
async function ownRucOf(userId: string): Promise<string | null> {
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { ruc: true } });
  return owner?.ruc?.replace(/\D/g, '') || null;
}

export async function getInvoice(userId: string, id: string): Promise<PublicInvoice> {
  await fillPendingRatesBriefly(userId);
  const inv = (await prisma.invoice.findFirst({
    where: { id, userId },
    include: { items: true },
  })) as InvoiceWithItems | null;
  if (!inv) throw AppError.notFound('Factura no encontrada');
  // Without the RUC every invoice read as a purchase here, and the detail
  // screen called the client's own sales "Compra".
  return toPublicInvoice(inv, await ownRucOf(userId));
}

/** The day whose close converts an invoice issued on [issued]: the day before. */
function closeDayOf(issued: Date): string {
  return new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth(), issued.getUTCDate() - 1))
    .toISOString()
    .slice(0, 10);
}

const CURRENCY_NAMES: Record<string, string> = { USD: 'dólares', BRL: 'reales', EUR: 'euros' };

/**
 * The DNIT's close for an invoice that prints no rate of its own: the selling
 * rate for a purchase — the buyer pays for the currency — and the buying rate
 * for a sale. Refuses, saying why, when there is none to use.
 */
async function dnitRate(moneda: string, issued: Date, tipo: 'venta' | 'compra'): Promise<OfficialRate> {
  const found = await officialRate(moneda, issued, tipo === 'venta' ? 'compra' : 'venta');
  if (typeof found !== 'string') return found;
  const name = CURRENCY_NAMES[moneda] ?? 'moneda extranjera';
  const [y, m, d] = closeDayOf(issued).split('-');
  logger.warn({ moneda, reason: found }, 'no DNIT rate for a foreign invoice');
  switch (found) {
    case 'moneda':
      throw AppError.badRequest(
        `Esta factura está en ${name} y no trae su tipo de cambio, y la DNIT no publica una ` +
          'cotización para esa moneda. Cargala con su XML.',
      );
    case 'pendiente':
      throw AppError.badRequest(
        `Esta factura está en ${name} y no trae su tipo de cambio. Se convierte con la cotización ` +
          `de la DNIT del día anterior (${d}/${m}/${y}), que todavía no está publicada. Probá de nuevo mañana.`,
      );
    case 'ilegible':
      throw AppError.badRequest(
        `Esta factura está en ${name} y no trae su tipo de cambio, y no pudimos leer la cotización ` +
          `de la DNIT del ${d}/${m}/${y}. Cargala con su XML, o avisá al soporte.`,
      );
    default:
      throw AppError.badRequest(
        `Esta factura está en ${name} y no trae su tipo de cambio. Se convierte con la cotización ` +
          'oficial que publica la DNIT, pero ahora no pudimos consultarla. Probá de nuevo en unos minutos.',
      );
  }
}

/**
 * Files an invoice under another category, or back under the rules (null).
 *
 * The rules cannot know everything — an agrochemical invoice read as "Otros"
 * is useless to the client — so he corrects it, and what he corrects stays
 * corrected while everything else follows an improved ruleset.
 */
export async function setCategoria(
  userId: string,
  id: string,
  categoria: string | null,
): Promise<PublicInvoice> {
  if (categoria != null && !CATEGORIES.some((c) => c.key === categoria)) {
    throw AppError.badRequest('Categoría desconocida');
  }
  const invoice = await prisma.invoice.findFirst({ where: { id, userId }, select: { id: true } });
  if (!invoice) throw AppError.notFound('Factura no encontrada');
  const updated = await prisma.invoice.update({
    where: { id },
    data: { categoria },
    include: { items: true },
  });
  return toPublicInvoice(updated, await ownRucOf(userId));
}

/**
 * Files an invoice as a sale or a purchase, or back under the RUC (null).
 *
 * A DNIT rate follows the side: a purchase is converted at the selling rate
 * and a sale at the buying one — the other close was kept with it, so the
 * side is the person's to correct whatever the DNIT's site is doing.
 */
export async function setTipo(
  userId: string,
  id: string,
  tipo: 'venta' | 'compra' | null,
): Promise<PublicInvoice> {
  const invoice = await prisma.invoice.findFirst({ where: { id, userId } });
  if (!invoice) throw AppError.notFound('Factura no encontrada');
  const ownRuc = await ownRucOf(userId);
  const esVenta = tipo == null ? null : tipo === 'venta';
  let rate: { tipoCambio: number | Prisma.Decimal; tipoCambioOtroLado: number | Prisma.Decimal } | Record<string, never> =
    {};
  const before = ledgerSideOf(invoice, ownRuc).tipo;
  const after = ledgerSideOf({ emisorRuc: invoice.emisorRuc, esVenta }, ownRuc).tipo;
  if (invoice.tipoCambioFuente === 'dnit' && before !== after) {
    if (invoice.tipoCambio != null && invoice.tipoCambioOtroLado != null) {
      rate = { tipoCambio: invoice.tipoCambioOtroLado, tipoCambioOtroLado: invoice.tipoCambio };
    } else {
      // Stored before both closes were kept: ask the DNIT. With its page
      // down the rate stays as it was, and the side still changes.
      try {
        const found = await dnitRate(invoice.moneda, invoice.fechaEmision, after);
        rate = { tipoCambio: found.rate, tipoCambioOtroLado: found.other };
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'set-tipo: DNIT rate kept, not recomputed');
      }
    }
  }
  const updated = await prisma.invoice.update({
    where: { id },
    data: { esVenta, ...rate },
    include: { items: true },
  });
  return toPublicInvoice(updated, ownRuc);
}

/**
 * Sets the exchange rate of an invoice that did not print one: by hand, or
 * back to the DNIT's close (null). A rate the invoice itself carries is the
 * one the law takes, and stays.
 */
export async function setTipoCambio(
  userId: string,
  id: string,
  tipoCambio: number | null,
): Promise<PublicInvoice> {
  const invoice = await prisma.invoice.findFirst({ where: { id, userId } });
  if (!invoice) throw AppError.notFound('Factura no encontrada');
  if (invoice.moneda === 'PYG') throw AppError.badRequest('Esta factura está en guaraníes.');
  if (invoice.tipoCambio != null && invoice.tipoCambioFuente == null) {
    throw AppError.badRequest(
      'Esta factura trae su propio tipo de cambio, y es el que vale para el IVA.',
    );
  }
  const ownRuc = await ownRucOf(userId);
  let data: { tipoCambio: number; tipoCambioOtroLado: number | null; tipoCambioFuente: string };
  if (tipoCambio != null) {
    data = { tipoCambio, tipoCambioOtroLado: null, tipoCambioFuente: 'manual' };
  } else {
    const found = await dnitRate(invoice.moneda, invoice.fechaEmision, ledgerSideOf(invoice, ownRuc).tipo);
    data = { tipoCambio: found.rate, tipoCambioOtroLado: found.other, tipoCambioFuente: 'dnit' };
  }
  const updated = await prisma.invoice.update({ where: { id }, data, include: { items: true } });
  return toPublicInvoice(updated, ownRuc);
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

  // Two independent readers on the same photo. The OCR text is read several
  // ways — the printed rows rebuilt from where each word sits, and Vision's
  // own block order — keeping the reading whose numbers add up; a vision
  // model reads the image as a whole. decidePhoto weighs the two, with the
  // OCR text as the witness to what the model says is printed. The model
  // never runs alone: without Vision's text there is nothing to hold it to.
  const [ocr, ai, ownRuc] = await Promise.all([
    extractText(imageBase64),
    readInvoiceWithAI(imageBase64),
    ownRucOf(userId),
  ]);
  const { parsed: ocrParsed, text, layout } = (parseBest(ocr.layouts) ??
    parseBest([{ layout: 'blocks', text: ocr.text }])) as Reading;
  const decision = decidePhoto(
    ocrParsed,
    ai ? fromExtraction(settledCurrency(ai, ocrParsed, ocr.text)) : null,
    ocr.text,
    ownRuc,
    ocr.layouts.map((l) => l.text ?? '').filter(Boolean),
  );
  if (decision.kind === 'refuse') refusePhoto(decision, text, layout);
  const parsed = decision.reading;
  // decidePhoto stores only a reading with its total and date (see refusalOf).
  const { total, fechaEmision } = parsed;
  if (total == null || fechaEmision == null) throw new Error('import-photo: a stored reading lacks total or date');

  // A KuDE keys by its printed CDC — what the XML of the same invoice carries;
  // anything else by issuer, number, date and total.
  const key = parsed.cdc ?? receiptKey(parsed);
  const existing = await findSameInvoice(userId, parsed, [key, receiptKey(parsed)]);
  if (existing) {
    throw AppError.conflict(
      'Esta factura ya fue importada. Si quedó mal, borrala y sacá la foto de nuevo.',
    );
  }

  // Another currency with no rate on the paper: the one the law names, the
  // DNIT's close of the day before. Said out loud — it was not read off the
  // invoice.
  const missing = [...parsed.missing];
  let tipoCambio = parsed.tipoCambio;
  let tipoCambioFuente: string | null = null;
  let tipoCambioOtroLado: number | null = null;
  if (parsed.foreignCurrency && tipoCambio == null) {
    const tipo = ledgerSideOf({ emisorRuc: parsed.emisorRuc ?? '' }, ownRuc).tipo;
    const found = await officialRate(parsed.foreignCurrency, fechaEmision, tipo === 'venta' ? 'compra' : 'venta');
    const [y, m, d] = closeDayOf(fechaEmision).split('-');
    if (typeof found !== 'string') {
      tipoCambio = found.rate;
      tipoCambioOtroLado = found.other;
      tipoCambioFuente = 'dnit';
      missing.push(`Tipo de cambio (cotización DNIT del ${d}/${m}/${y})`);
    } else {
      // Its figures were read: stored, out of the guaraní totals, rather than
      // refused for the DNIT's site — which went 404 on 2026-09-22 and turned
      // a dollar receipt read right away twice. The rate comes in by itself
      // once the DNIT answers (fillPendingRates), or by hand. A currency the
      // DNIT does not quote only by hand.
      logger.warn({ moneda: parsed.foreignCurrency, reason: found }, 'import-photo: stored without a rate');
      tipoCambioFuente = found === 'moneda' ? null : 'pendiente';
      missing.push(
        found === 'moneda'
          ? 'Tipo de cambio: cargalo a mano (la DNIT no publica esa moneda)'
          : `Tipo de cambio pendiente: la cotización DNIT del ${d}/${m}/${y} todavía no se pudo obtener; se completa sola, o cargala a mano`,
      );
    }
  }

  if (missing.length) {
    // An import that goes through with fields missing was silent on the
    // server. On 2026-09-14 a fuel ticket came back with its total but no IVA
    // and no RUC, and nothing here said which layout defeated the parser.
    // Same rule as above: the layout only, never the text or the user.
    logger.warn(
      {
        lines: text.split(/\r?\n/).length,
        reading: layout,
        missing,
        layout: layoutSkeleton(text),
      },
      'import-photo: imported with fields missing',
    );
  }

  // Guaraníes are whole; another currency keeps its cents.
  const round = (v: number) => (parsed.foreignCurrency ? Math.round(v * 100) / 100 : Math.round(v));
  const iva10 = round(parsed.iva10 ?? 0);
  const iva5 = round(parsed.iva5 ?? 0);

  // base + IVA + exentas = total, exactly. The IVA figures are printed on the
  // paper and stand; a base derived from one of them is an inference and
  // carries its rounding — a gravada of 1.538,02 read off an IVA of 139,82
  // against a printed total of 1.538,00 put the report 120 Gs above the sum of
  // its own invoices (2026-09-20). The residual, which totalsAgree has already
  // held to a rounding, goes back into the base it came from.
  const base5 =
    parsed.gravada5 != null ? Math.max(0, round(parsed.gravada5 - iva5)) : round(iva5 * 20);
  let base10 =
    parsed.gravada10 != null ? Math.max(0, round(parsed.gravada10 - iva10)) : round(iva10 * 10);
  let exentas = round(parsed.exentas ?? 0);
  const residual = round(total - (base5 + iva5 + base10 + iva10 + exentas));
  if (residual !== 0) {
    // Onto the taxed base when there is one — that is where the rounding was
    // introduced — and onto the exempt amount when the invoice is untaxed.
    if (base10 + iva10 > 0) base10 = Math.max(0, round(base10 + residual));
    else if (base5 + iva5 <= 0) exentas = Math.max(0, round(exentas + residual));
  }

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
      fechaEmision,
      moneda: parsed.foreignCurrency ?? 'PYG',
      tipoCambio,
      tipoCambioFuente,
      tipoCambioOtroLado,
      timbrado: parsed.timbrado,
      numeroDoc: parsed.numeroDoc,
      totalOpe: total,
      totalIva: round(iva10 + iva5),
      iva5,
      iva10,
      // baseGrav is the NET taxable base — the same thing SIFEN calls
      // dBaseGrav, so the XML and photo paths can be summed together.
      //
      // The ticket prints the GROSS amount ("TOTAL GRAVADAS 10%: 545.600"),
      // which is base + IVA. Subtract when we read it; fall back to deriving
      // from the tax only when we did not. iva*10 and iva*20 are the correct
      // multipliers for the NET base (49.600*10 = 496.000 = 545.600 - 49.600).
      baseGrav5: base5,
      baseGrav10: base10,
      exentas,
      // Line items, when the vision model listed them and they add up to the
      // amounts stored (see itemsFitting).
      items: {
        create: parsed.items.map((it) => {
          const d = it.ivaRate === 10 ? 11 : it.ivaRate === 5 ? 21 : 0;
          const ivaMonto = d ? round(it.total / d) : 0;
          return {
            codigo: null,
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            precioUnit: it.precioUnit,
            total: it.total,
            ivaRate: it.ivaRate,
            ivaBase: round(it.total - ivaMonto),
            ivaMonto,
          };
        }),
      },
      source: 'ocr',
    },
    include: { items: true },
  });
  logger.info(
    { reading: layout, readers: decision.source, items: parsed.items.length },
    'import-photo: stored',
  );

  // The raw Prisma row serialises Decimal columns as strings, which the app's
  // parser rejects — after the invoice was already stored. Same shape as
  // import-xml, so the client has one Invoice to understand.
  return { invoice: toPublicInvoice(invoice, ownRuc), missing, confidence: parsed.confidence };
}

/**
 * Refuses a photo, with the message for its reason.
 *
 * Three real photos were refused on 2026-09-13 and the only record was
 * "400", so the layout that defeated the parser was unrecoverable. Each
 * refusal logs the layout, then — but ONLY the layout: a receipt's text
 * carries the buyer's name and CI/RUC, and Render keeps these logs outside
 * our control. The skeleton keeps fiscal labels and number shapes and masks
 * everything else, and no user id rides on the same line.
 */
function refusePhoto(
  decision: Extract<PhotoDecision, { kind: 'refuse' }>,
  text: string,
  layout: string,
): never {
  const parsed = decision.reading;
  const context = {
    lines: text.split(/\r?\n/).length,
    reading: layout,
    missing: parsed?.missing ?? [],
    ...(decision.detail ? { detail: decision.detail } : {}),
    layout: layoutSkeleton(text),
  };

  switch (decision.reason) {
    case 'nota':
      throw AppError.badRequest(
        `Las notas de ${parsed?.nota === 'debito' ? 'débito' : 'crédito'} todavía no se cargan por foto. ` +
          'Importá su XML.',
      );

    case 'moneda':
      // A dollar invoice adds up in dollars, so every check on the amounts
      // passed it, and it was stored as guaraníes (2026-09-19). So the two
      // readers have to agree on the currency — and a form that only offers
      // one ("Son: ☐ Guaraníes ☐ Dólares") is settled by the tick, which the
      // text does not carry. This used to say "no pudimos leer su tipo de
      // cambio" about a guaraní invoice (Cevelio, 2026-09-21).
      // And a rate the invoice prints is the one the law takes: when no reader
      // confirmed it, its XML carries it.
      logger.warn(context, 'import-photo: foreign currency');
      if (decision.detail === 'rate') {
        throw AppError.badRequest(
          `Esta factura está en ${parsed?.foreignCurrency === 'USD' ? 'dólares' : 'moneda extranjera'} ` +
            'y trae su tipo de cambio, pero no pudimos leerlo en la foto. Cargala con su XML, o dejá ' +
            'que llegue por correo: así se registra con su tipo de cambio.',
        );
      }
      throw AppError.badRequest(
        decision.detail === 'choice'
          ? 'No pudimos confirmar si la factura está en guaraníes o en dólares. Sacá la foto de ' +
              'nuevo, que se vea bien la casilla marcada junto al total.'
          : 'Leímos la factura en dos monedas distintas, así que no la guardamos. Sacá la foto de ' +
              'nuevo, que se vea bien la moneda junto al total.',
      );

    case 'total':
      logger.warn(context, 'import-photo: no total found in OCR text');
      throw AppError.badRequest(
        'No pudimos leer el total de la factura. Sacá una foto por factura, de ' +
          'cerca, con buena luz y la factura plana sobre una superficie oscura.',
      );

    case 'contradiccion':
      // The amounts contradict each other — the total against gravadas plus
      // exentas, or an IVA against its own gravada — so one of them is
      // misread and nothing says which. Storing it put a Gs 223.150 ticket on
      // record as Gs 29 (2026-09-15).
      logger.warn(context, 'import-photo: amounts contradict each other');
      throw AppError.badRequest(
        'Los montos de la factura no cuadran entre sí, así que no la guardamos. ' +
          'Sacá la foto de nuevo: una sola factura por foto, bien derecha, con ' +
          'buena luz y el papel plano.',
      );

    case 'iva':
      // No IVA read at all — and the IVA is what this record is for. Stored
      // anyway, a photo showed "Gs 0" on every tax line (a diesel ticket,
      // 2026-09-14) and read as a purchase without IVA. An exempt-only
      // invoice is not refused: the parser does not report its IVA missing.
      logger.warn(context, 'import-photo: no IVA found in OCR text');
      throw AppError.badRequest(
        'No pudimos leer el IVA de la factura. Sacá la foto de nuevo, que se vea ' +
          'bien el pie con la liquidación del IVA.',
      );

    case 'fecha':
      // Stored anyway, it took the day of the upload and landed in the wrong
      // month's IVA.
      logger.warn(context, 'import-photo: no date found in OCR text');
      throw AppError.badRequest(
        'Leímos los montos, pero no pudimos confirmar la fecha de emisión. Sacá la foto ' +
          'de nuevo con la fecha bien visible y sin sombra — en un talonario escrito a ' +
          'mano, que se lean el día, el mes y el año.',
      );

    case 'lecturas':
      // Two readings that each hold up, with different amounts or dates: one
      // of them is wrong and nothing says which.
      logger.warn(context, 'import-photo: the two readings disagree');
      throw AppError.badRequest(
        'Leímos la factura de dos maneras y no coinciden, así que no la guardamos. ' +
          'Sacá otra foto, bien derecha, con buena luz y el papel plano.',
      );
  }
}
