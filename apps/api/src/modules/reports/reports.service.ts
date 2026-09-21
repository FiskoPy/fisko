import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { normalizeRuc } from '../../utils/ruc';
import { categorize, categoryLabel, type CategoryKey } from '../../services/categories';

export interface ReportPeriod {
  from?: Date;
  to?: Date;
}

export interface MonthBucket {
  month: string; // YYYY-MM
  count: number;
  total: number;
  iva: number;
}

export interface CategoryBucket {
  key: CategoryKey;
  label: string;
  count: number;
  total: number;
  iva: number;
}

export interface FiscalSummary {
  period: { from: string | null; to: string | null };
  count: number;
  totalOpe: number;
  totalIva: number;
  iva5: number;
  iva10: number;
  baseGrav5: number;
  baseGrav10: number;
  /** What was sold without IVA (dSubExe + dSubExo). */
  exentas: number;
  ventas: number; // facturas donde el usuario es emisor (ingresos)
  compras: number; // facturas donde el usuario es receptor (gastos)
  ivaCredito: number; // IVA de compras
  ivaDebito: number; // IVA de ventas
  /**
   * The IVA statement as it is declared, and as the client asked for it:
   * what was credited, what was owed, what a previous period left in his
   * favour, what he actually pays, and what carries on.
   */
  saldoAnterior: number;
  ivaAPagar: number;
  saldoSiguiente: number;
  /** IRE for a company, IRP for a person: an E.A.S. does not pay IRP. */
  rentaRegimen: 'IRE' | 'IRP';
  rentaEstimado: number;
  /** @deprecated use rentaEstimado/rentaRegimen — kept for older app builds. */
  irpEstimado: number; // estimación simplificada
  /// Invoices left OUT of the totals: a foreign currency with no usable rate.
  /// Silently adding those to the guaraní totals produced a wrong tax figure.
  sinConversion: number;
  /// Everything imported in the period, including what carries no operation of
  /// its own. "5 comprobantes" for 4 facturas and a nota de remisión read as
  /// five invoices; they are counted apart now.
  documentos: number;
  /// Documents that carry no operation: notas de remisión, retenciones.
  sinOperacion: number;
  byMonth: MonthBucket[];
  byCategory: CategoryBucket[];
}

const num = (d: unknown): number => (d == null ? 0 : Number(d));

/**
 * Which income tax this taxpayer estimates: a company files IRE, a person
 * IRP. Stated in the profile; a RUC that is not a natural person's (Paraguay
 * gives companies eight digits starting with 8) is taken as a company.
 */
export function rentaRegimenOf(user: {
  tipoContribuyente?: string | null;
  ruc?: string | null;
}): 'IRE' | 'IRP' {
  if (user.tipoContribuyente === 'juridica') return 'IRE';
  if (user.tipoContribuyente === 'fisica') return 'IRP';
  const ruc = (user.ruc ?? '').replace(/\D/g, '');
  return ruc.length >= 8 && ruc.startsWith('8') ? 'IRE' : 'IRP';
}

/**
 * The IVA credit a period starts with: what earlier periods left over.
 *
 * Each month pays max(0, débito − crédito − saldo) and carries the rest
 * forward; credit does not expire. Without this the statement could only ever
 * show one month standing alone, and a client who is always in credit — which
 * is this one, so far — would never see it accumulate.
 */
async function creditCarriedInto(userId: string, from: Date, userRuc: string | null): Promise<number> {
  const rows = (await prisma.invoice.findMany({
    where: { userId, fechaEmision: { lt: from } },
    select: {
      tipoDoc: true,
      fechaEmision: true,
      totalIva: true,
      emisorRuc: true,
      esVenta: true,
      moneda: true,
      tipoCambio: true,
    },
    orderBy: { fechaEmision: 'asc' },
  })) as {
    tipoDoc: number;
    fechaEmision: Date;
    totalIva: unknown;
    emisorRuc: string;
    esVenta: boolean | null;
    moneda: string;
    tipoCambio: unknown;
  }[];

  const months = new Map<string, { credito: number; debito: number }>();
  for (const r of rows) {
    const rate = r.moneda === 'PYG' ? 1 : num(r.tipoCambio);
    const sign = documentSign(r.tipoDoc);
    if (!rate || sign === 0) continue;
    const iva = num(r.totalIva) * rate * sign;
    const key = r.fechaEmision.toISOString().slice(0, 7);
    const b = months.get(key) ?? { credito: 0, debito: 0 };
    const venta = r.esVenta ?? (userRuc != null && normalizeRuc(r.emisorRuc) === userRuc);
    if (venta) b.debito += iva;
    else b.credito += iva;
    months.set(key, b);
  }

  let saldo = 0;
  for (const key of [...months.keys()].sort()) {
    const b = months.get(key) as { credito: number; debito: number };
    saldo = Math.max(0, saldo + b.credito - b.debito);
  }
  return saldo;
}

type Row = {
  tipoDoc: number;
  fechaEmision: Date;
  totalOpe: unknown;
  totalIva: unknown;
  iva5: unknown;
  iva10: unknown;
  baseGrav5: unknown;
  baseGrav10: unknown;
  exentas: unknown;
  categoria: string | null;
  esVenta: boolean | null;
  emisorRuc: string;
  emisorNombre: string;
  moneda: string;
  tipoCambio: unknown;
  items: { descripcion: string }[];
};

/**
 * How a SIFEN document type counts towards totals (iTiDE).
 *  1 Factura, 2/3 Factura de exportación/importación, 4 Autofactura, 6 Nota de
 *  débito → +1. 5 Nota de crédito → −1. 7 Nota de remisión and 8 Comprobante de
 *  retención carry no operation of their own → 0 (left out).
 */
export function documentSign(tipoDoc: number): 1 | -1 | 0 {
  if (tipoDoc === 5) return -1;
  if (tipoDoc === 7 || tipoDoc === 8) return 0;
  return 1;
}

export async function getSummary(userId: string, period: ReportPeriod): Promise<FiscalSummary> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ruc: true } });
  const userRuc = user?.ruc ? normalizeRuc(user.ruc) : null;

  const rows = (await prisma.invoice.findMany({
    where: {
      userId,
      ...(period.from || period.to
        ? {
            fechaEmision: {
              ...(period.from ? { gte: period.from } : {}),
              ...(period.to ? { lte: period.to } : {}),
            },
          }
        : {}),
    },
    select: {
      tipoDoc: true,
      fechaEmision: true,
      totalOpe: true,
      totalIva: true,
      iva5: true,
      iva10: true,
      baseGrav5: true,
      baseGrav10: true,
      exentas: true,
      categoria: true,
      esVenta: true,
      emisorRuc: true,
      emisorNombre: true,
      moneda: true,
      tipoCambio: true,
      // Item descriptions feed the (rule-based) category derivation.
      items: { select: { descripcion: true } },
    },
    orderBy: { fechaEmision: 'asc' },
  })) as Row[];

  const sum = {
    totalOpe: 0,
    totalIva: 0,
    iva5: 0,
    iva10: 0,
    baseGrav5: 0,
    baseGrav10: 0,
    exentas: 0,
    ventas: 0,
    compras: 0,
    ivaCredito: 0,
    ivaDebito: 0,
  };
  let sinConversion = 0;
  let sinOperacion = 0;
  const months = new Map<string, MonthBucket>();
  const cats = new Map<CategoryKey, CategoryBucket>();

  for (const r of rows) {
    // Everything below is in guaraníes. A foreign-currency invoice is converted
    // with the rate the DTE itself carries (dTiCam); without a rate it is left
    // out and counted, because adding USD to PYG is simply a wrong number.
    const rate = r.moneda === 'PYG' ? 1 : num(r.tipoCambio);
    if (!rate) {
      sinConversion += 1;
      continue;
    }
    // A credit note reverses an operation; it used to be added like an invoice,
    // so a refund INCREASED compras and IVA crédito.
    const sign = documentSign(r.tipoDoc);
    if (sign === 0) {
      sinOperacion += 1;
      continue;
    }
    const k = rate * sign;
    const totalOpe = num(r.totalOpe) * k;
    const totalIva = num(r.totalIva) * k;
    sum.totalOpe += totalOpe;
    sum.totalIva += totalIva;
    sum.iva5 += num(r.iva5) * k;
    sum.iva10 += num(r.iva10) * k;
    sum.baseGrav5 += num(r.baseGrav5) * k;
    sum.baseGrav10 += num(r.baseGrav10) * k;
    sum.exentas += num(r.exentas) * k;

    const isVenta = r.esVenta ?? (userRuc != null && normalizeRuc(r.emisorRuc) === userRuc);
    if (isVenta) {
      sum.ventas += totalOpe;
      sum.ivaDebito += totalIva;
    } else {
      sum.compras += totalOpe;
      sum.ivaCredito += totalIva;
    }

    const key = r.fechaEmision.toISOString().slice(0, 7); // YYYY-MM
    const b = months.get(key) ?? { month: key, count: 0, total: 0, iva: 0 };
    b.count += 1;
    b.total += totalOpe;
    b.iva += totalIva;
    months.set(key, b);

    // A category set by hand wins over the rules: the client corrects what
    // the rules could not know, and an improved ruleset still applies to
    // everything he never touched.
    const catKey =
      (r.categoria as CategoryKey | null) ??
      categorize(r.emisorNombre ?? '', (r.items ?? []).map((i) => i.descripcion));
    const cb = cats.get(catKey) ?? {
      key: catKey,
      label: categoryLabel(catKey),
      count: 0,
      total: 0,
      iva: 0,
    };
    cb.count += 1;
    cb.total += totalOpe;
    cb.iva += totalIva;
    cats.set(catKey, cb);
  }

  // Renta — estimativa simplificada: 10% sobre o ganho neto positivo.
  const rentaEstimado = Math.max(0, sum.ventas - sum.compras) * 0.1;
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { tipoContribuyente: true, ruc: true, name: true },
  });
  const rentaRegimen = rentaRegimenOf(owner ?? {});

  // The IVA of the period, as it is declared.
  const saldoAnterior = period.from ? await creditCarriedInto(userId, period.from, userRuc) : 0;
  const ivaAPagar = Math.max(0, sum.ivaDebito - sum.ivaCredito - saldoAnterior);
  const saldoSiguiente = Math.max(0, sum.ivaCredito + saldoAnterior - sum.ivaDebito);

  return {
    saldoAnterior,
    ivaAPagar,
    saldoSiguiente,
    rentaRegimen,
    rentaEstimado,
    period: {
      from: period.from ? period.from.toISOString() : null,
      to: period.to ? period.to.toISOString() : null,
    },
    count: rows.length - sinConversion - sinOperacion,
    sinConversion,
    documentos: rows.length,
    sinOperacion,
    ...sum,
    irpEstimado: rentaEstimado,
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    byCategory: [...cats.values()].sort((a, b) => b.total - a.total),
  };
}

const fmtGs = (v: number): string =>
  'Gs ' + Math.round(v).toLocaleString('es-PY').replace(/,/g, '.');

/**
 * The parts of the period, rounded so that they add up to the printed total.
 *
 * Each figure is exact to the guaraní inside the invoice, but rounding five of
 * them separately leaves the column one guaraní short of the total — and the
 * person reading the report adds the column. The taxed base takes the
 * difference, as it does inside each invoice.
 */
export function printedParts(s: FiscalSummary): {
  base5: number;
  iva5: number;
  base10: number;
  iva10: number;
  exentas: number;
  total: number;
} {
  const base5 = Math.round(s.baseGrav5);
  const iva5 = Math.round(s.iva5);
  const iva10 = Math.round(s.iva10);
  const exentas = Math.round(s.exentas);
  const total = Math.round(s.totalOpe);
  return { base5, iva5, base10: total - base5 - iva5 - iva10 - exentas, iva10, exentas, total };
}

// Brand palette, kept in sync with the app's theme (apps/mobile/lib/core/theme).
// IVA5/IVA10 are reserved: green always means the 5% rate, amber the 10% one.
const BRAND = '#14508F'; // azul Ypacaraí
const IVA5 = '#2E8B6F'; // verde
const IVA10 = '#B8801F'; // ámbar (darkened for contrast on white paper)

/** The taxpayer the report is for, and the comprobantes behind its totals. */
export interface ReportDetail {
  nombre: string;
  ruc: string | null;
  rows: {
    fechaEmision: Date;
    tipoDoc: number;
    emisorNombre: string;
    numeroDoc: string | null;
    moneda: string;
    tipoCambio: unknown;
    totalOpe: unknown;
    totalIva: unknown;
  }[];
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "agosto 2026" when the period is one whole month, else the two dates. */
export function periodLabel(p: FiscalSummary['period']): string {
  if (!p.from || !p.to) return `${p.from?.slice(0, 10) ?? 'inicio'} a ${p.to?.slice(0, 10) ?? 'hoy'}`;
  const from = new Date(p.from);
  const to = new Date(p.to);
  const wholeMonth =
    from.getUTCDate() === 1 &&
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCFullYear() === to.getUTCFullYear() &&
    to.getUTCDate() === new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  if (wholeMonth) return `${MONTHS_ES[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
  return `${p.from.slice(0, 10)} a ${p.to.slice(0, 10)}`;
}

const fmtDay = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

const TIPO_DOC_LABEL: Record<number, string> = {
  1: 'Factura',
  4: 'Autofactura',
  5: 'Nota de crédito',
  6: 'Nota de débito',
  7: 'Nota de remisión',
};

export async function buildPdf(summary: FiscalSummary, detail?: ReportDetail): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  doc.fontSize(20).fillColor('#14508F').text('Fisko — Reporte fiscal', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#555');
  // An accountant is handed this for one taxpayer and one period: both have to
  // be on the page, or the file says nothing about whose IVA it is.
  if (detail) {
    doc.text(`Contribuyente: ${detail.nombre}${detail.ruc ? `  ·  RUC ${detail.ruc}` : ''}`);
  }
  doc.text(`Período: ${periodLabel(summary.period)}`);
  doc.text(
    `${summary.count} comprobante(s) computables` +
      (summary.sinOperacion > 0 ? `  ·  ${summary.sinOperacion} sin operación (notas de remisión)` : '') +
      (summary.sinConversion > 0 ? `  ·  ${summary.sinConversion} sin tipo de cambio, fuera de los totales` : ''),
  );
  doc.moveDown(1);

  const line = (label: string, value: string, bold = false, color?: string) => {
    doc.fontSize(bold ? 13 : 11).fillColor(color ?? (bold ? BRAND : '#000'));
    const y = doc.y;
    doc.text(label, 48, y);
    doc.text(value, 48, y, { align: 'right', width: doc.page.width - 96 });
    doc.moveDown(bold ? 0.6 : 0.4);
  };

  doc.fontSize(13).fillColor(BRAND).text('IVA');
  doc.moveDown(0.3);
  // Rounded so the column adds up to the total below it, which is what the
  // person holding the page will do.
  const parts = printedParts(summary);
  // Same colour discipline as the app: green is always 5%, amber always 10%.
  line('Base imponible 5% (sin IVA)', fmtGs(parts.base5));
  line('IVA 5%', fmtGs(parts.iva5), false, IVA5);
  line('Base imponible 10% (sin IVA)', fmtGs(parts.base10));
  line('IVA 10%', fmtGs(parts.iva10), false, IVA10);
  line('Total IVA', fmtGs(summary.totalIva), true);
  doc.moveDown(0.6);

  line('Exentas', fmtGs(parts.exentas));
  line('Total del período', fmtGs(parts.total), true);
  doc.moveDown(0.6);

  doc.fontSize(13).fillColor(BRAND).text('Liquidación del IVA');
  doc.moveDown(0.3);
  line('IVA crédito (compras)', fmtGs(summary.ivaCredito));
  line('IVA débito (ventas)', fmtGs(summary.ivaDebito));
  line('Saldo a favor del período anterior', fmtGs(summary.saldoAnterior));
  line('IVA a pagar', fmtGs(summary.ivaAPagar), true);
  line('Saldo a favor para el período siguiente', fmtGs(summary.saldoSiguiente), true);
  doc.moveDown(0.6);

  doc.fontSize(13).fillColor('#14508F').text('Resumen');
  doc.moveDown(0.3);
  line('Ventas (ingresos)', fmtGs(summary.ventas));
  line('Compras (gastos)', fmtGs(summary.compras));
  line(
    `${summary.rentaRegimen} estimado (simplificado)`,
    fmtGs(summary.rentaEstimado),
    true,
  );
  doc.moveDown(0.6);

  if (summary.byCategory.length) {
    doc.fontSize(13).fillColor('#14508F').text('Por categoría');
    doc.moveDown(0.3);
    for (const c of summary.byCategory) {
      line(`${c.label} (${c.count})`, `${fmtGs(c.total)} · IVA ${fmtGs(c.iva)}`);
    }
    doc.moveDown(0.6);
  }

  if (summary.byMonth.length) {
    doc.fontSize(13).fillColor('#14508F').text('Por mes');
    doc.moveDown(0.3);
    for (const m of summary.byMonth) {
      line(`${m.month} (${m.count})`, `${fmtGs(m.total)} · IVA ${fmtGs(m.iva)}`);
    }
  }

  // The comprobantes behind the totals. An accountant checks a declaration
  // against the documents, and a page of totals alone cannot be checked.
  if (detail?.rows.length) {
    doc.addPage();
    doc.fontSize(13).fillColor(BRAND).text(`Detalle del período — ${periodLabel(summary.period)}`);
    doc.moveDown(0.5);

    const left = 48;
    const width = doc.page.width - 96;
    const cols = [
      { w: 58, align: 'left' as const },
      { w: 62, align: 'left' as const },
      { w: width - 58 - 62 - 92 - 92 - 70, align: 'left' as const },
      { w: 92, align: 'right' as const },
      { w: 92, align: 'right' as const },
      { w: 70, align: 'right' as const },
    ];
    const row = (cells: string[], bold = false, color?: string) => {
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
      }
      doc.fontSize(bold ? 9.5 : 9).fillColor(color ?? (bold ? BRAND : '#000'));
      const y = doc.y;
      let x = left;
      cells.forEach((c, i) => {
        const col = cols[i] as { w: number; align: 'left' | 'right' };
        doc.text(c, x, y, { width: col.w - 6, align: col.align, ellipsis: true, lineBreak: false });
        x += col.w;
      });
      doc.y = y;
      doc.moveDown(bold ? 0.9 : 0.75);
    };

    row(['Fecha', 'Tipo', 'Emisor / Nº', 'Total', 'En guaraníes', 'IVA'], true);
    for (const r of detail.rows) {
      const rate = r.moneda === 'PYG' ? 1 : num(r.tipoCambio);
      const total = num(r.totalOpe);
      const enGs = rate ? fmtGs(total * rate) : 'sin cambio';
      const propio =
        r.moneda === 'PYG'
          ? fmtGs(total)
          : `${r.moneda} ${total.toLocaleString('es-PY', { minimumFractionDigits: 2 })}`;
      row([
        fmtDay(r.fechaEmision),
        TIPO_DOC_LABEL[r.tipoDoc] ?? `Tipo ${r.tipoDoc}`,
        `${r.emisorNombre}${r.numeroDoc ? ` · ${r.numeroDoc}` : ''}`,
        propio,
        enGs,
        rate ? fmtGs(num(r.totalIva) * rate) : '—',
      ]);
    }
    doc.moveDown(0.4);
    doc.fontSize(8).fillColor('#777').text(
      'Los montos en moneda extranjera se convierten con el tipo de cambio que trae cada documento, ' +
        'no con el del día de la importación. Si el documento no lo trae, con la cotización de la ' +
        'DNIT del día anterior a su emisión (Decreto 3107/2019, art. 13), o con el cargado a mano.',
      left,
      doc.y,
      { width },
    );
  }

  if (summary.sinConversion > 0) {
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor('#B8801F').text(
      `${summary.sinConversion} comprobante(s) en moneda extranjera sin tipo de cambio quedaron fuera de estos totales.`,
    );
  }

  doc.moveDown(1);
  doc.fontSize(8).fillColor('#999').text(
    'Valores estimados a partir de los DTE importados. La estimación de IRP es simplificada y no constituye asesoría fiscal.',
  );

  doc.end();
  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

export async function buildExcel(summary: FiscalSummary): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Resumen');
  ws.columns = [
    { header: 'Concepto', key: 'c', width: 32 },
    { header: 'Valor (Gs)', key: 'v', width: 20 },
  ];
  const add = (c: string, v: number) => ws.addRow({ c, v: Math.round(v) });
  add('Comprobantes', summary.count);
  add('Total operaciones', summary.totalOpe);
  add('Base imponible 5% (sin IVA)', summary.baseGrav5);
  add('IVA 5%', summary.iva5);
  add('Base imponible 10% (sin IVA)', summary.baseGrav10);
  add('IVA 10%', summary.iva10);
  add('Total IVA', summary.totalIva);
  add('Ventas (ingresos)', summary.ventas);
  add('Compras (gastos)', summary.compras);
  add('IVA crédito', summary.ivaCredito);
  add('IVA débito', summary.ivaDebito);
  add('IRP estimado', summary.irpEstimado);
  ws.getRow(1).font = { bold: true };

  const wm = wb.addWorksheet('Por mes');
  wm.columns = [
    { header: 'Mes', key: 'm', width: 12 },
    { header: 'Comprobantes', key: 'n', width: 14 },
    { header: 'Total (Gs)', key: 't', width: 18 },
    { header: 'IVA (Gs)', key: 'i', width: 18 },
  ];
  for (const m of summary.byMonth) {
    wm.addRow({ m: m.month, n: m.count, t: Math.round(m.total), i: Math.round(m.iva) });
  }
  wm.getRow(1).font = { bold: true };

  const wc = wb.addWorksheet('Por categoría');
  wc.columns = [
    { header: 'Categoría', key: 'c', width: 24 },
    { header: 'Comprobantes', key: 'n', width: 14 },
    { header: 'Total (Gs)', key: 't', width: 18 },
    { header: 'IVA (Gs)', key: 'i', width: 18 },
  ];
  for (const c of summary.byCategory) {
    wc.addRow({ c: c.label, n: c.count, t: Math.round(c.total), i: Math.round(c.iva) });
  }
  wc.getRow(1).font = { bold: true };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
