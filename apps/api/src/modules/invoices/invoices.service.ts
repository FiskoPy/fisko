import type { Invoice, InvoiceItem, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../errors/app-error';
import { parseDte, isValidCdcCheckDigit } from '../../services/sifen';
import { extractText, MAX_IMAGE_BYTES } from '../../services/ocr';
import { parseReceipt, receiptKey, type ParsedReceipt } from '../../services/receipt-parser';
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
    select: { id: true },
  });
  if (existing) {
    throw AppError.conflict('Esta factura ya fue importada', { cdc: dte.cdc });
  }

  const created = await prisma.invoice.create({
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
 * twice deduplicates instead of creating a second record. What the form
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

  const text = await extractText(imageBase64);
  const parsed: ParsedReceipt = parseReceipt(text);

  if (parsed.total == null) {
    throw AppError.badRequest(
      'No pudimos leer el total de la factura. Sacá la foto más de cerca, ' +
        'con buena luz y la factura plana sobre una superficie oscura.',
    );
  }

  const key = receiptKey(parsed);
  const existing = await prisma.invoice.findUnique({
    where: { userId_cdc: { userId, cdc: key } },
  });
  if (existing) throw AppError.conflict('Esta factura ya fue importada');

  const iva10 = parsed.iva10 ?? 0;
  const iva5 = parsed.iva5 ?? 0;

  const invoice = await prisma.invoice.create({
    data: {
      userId,
      cdc: key,
      tipoDoc: 1, // Factura
      tipoDocDesc: 'Factura (papel)',
      emisorRuc: parsed.emisorRuc ?? '',
      emisorDv: parsed.emisorDv,
      emisorNombre: parsed.emisorNombre ?? 'Sin identificar',
      receptorRuc: parsed.receptorRuc,
      receptorNombre: parsed.receptorNombre,
      fechaEmision: parsed.fechaEmision ?? new Date(),
      moneda: 'PYG',
      timbrado: parsed.timbrado,
      numeroDoc: parsed.numeroDoc,
      totalOpe: parsed.total,
      totalIva: iva10 + iva5,
      iva5,
      iva10,
      // The form prints the IVA, not the taxable base; derive it so the
      // dashboard's 5/10 split stays consistent with electronic invoices.
      baseGrav5: iva5 > 0 ? iva5 * 20 : 0,
      baseGrav10: iva10 > 0 ? iva10 * 10 : 0,
      source: 'ocr',
    },
    include: { items: true },
  });

  // The raw Prisma row serialises Decimal columns as strings, which the app's
  // parser rejects — after the invoice was already stored. Same shape as
  // import-xml, so the client has one Invoice to understand.
  return { invoice: toPublicInvoice(invoice), missing: parsed.missing, confidence: parsed.confidence };
}
