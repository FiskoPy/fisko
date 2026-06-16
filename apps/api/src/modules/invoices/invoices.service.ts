import type { Invoice, InvoiceItem, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../errors/app-error';
import { parseDte, isValidCdcCheckDigit } from '../../services/sifen';

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
export async function importXml(
  userId: string,
  xml: string,
  source = 'manual',
): Promise<PublicInvoice> {
  const dte = parseDte(xml);

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
