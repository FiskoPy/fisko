import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { normalizeRuc } from '../../utils/ruc';

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

export interface FiscalSummary {
  period: { from: string | null; to: string | null };
  count: number;
  totalOpe: number;
  totalIva: number;
  iva5: number;
  iva10: number;
  baseGrav5: number;
  baseGrav10: number;
  ventas: number; // facturas donde el usuario es emisor (ingresos)
  compras: number; // facturas donde el usuario es receptor (gastos)
  ivaCredito: number; // IVA de compras
  ivaDebito: number; // IVA de ventas
  irpEstimado: number; // estimación simplificada
  byMonth: MonthBucket[];
}

const num = (d: unknown): number => (d == null ? 0 : Number(d));

type Row = {
  fechaEmision: Date;
  totalOpe: unknown;
  totalIva: unknown;
  iva5: unknown;
  iva10: unknown;
  baseGrav5: unknown;
  baseGrav10: unknown;
  emisorRuc: string;
};

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
      fechaEmision: true,
      totalOpe: true,
      totalIva: true,
      iva5: true,
      iva10: true,
      baseGrav5: true,
      baseGrav10: true,
      emisorRuc: true,
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
    ventas: 0,
    compras: 0,
    ivaCredito: 0,
    ivaDebito: 0,
  };
  const months = new Map<string, MonthBucket>();

  for (const r of rows) {
    const totalOpe = num(r.totalOpe);
    const totalIva = num(r.totalIva);
    sum.totalOpe += totalOpe;
    sum.totalIva += totalIva;
    sum.iva5 += num(r.iva5);
    sum.iva10 += num(r.iva10);
    sum.baseGrav5 += num(r.baseGrav5);
    sum.baseGrav10 += num(r.baseGrav10);

    const isVenta = userRuc != null && normalizeRuc(r.emisorRuc) === userRuc;
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
  }

  // IRP — estimativa simplificada: 10% sobre o ganho neto positivo (ventas - compras).
  const irpEstimado = Math.max(0, sum.ventas - sum.compras) * 0.1;

  return {
    period: {
      from: period.from ? period.from.toISOString() : null,
      to: period.to ? period.to.toISOString() : null,
    },
    count: rows.length,
    ...sum,
    irpEstimado,
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

const fmtGs = (v: number): string =>
  'Gs ' + Math.round(v).toLocaleString('es-PY').replace(/,/g, '.');

export async function buildPdf(summary: FiscalSummary): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  doc.fontSize(20).fillColor('#0E7C66').text('Fisko — Reporte fiscal', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#555');
  const p = summary.period;
  doc.text(
    `Período: ${p.from ? p.from.slice(0, 10) : 'inicio'} a ${p.to ? p.to.slice(0, 10) : 'hoy'}  ·  ${summary.count} comprobantes`,
  );
  doc.moveDown(1);

  const line = (label: string, value: string, bold = false) => {
    doc.fontSize(bold ? 13 : 11).fillColor(bold ? '#0E7C66' : '#000');
    const y = doc.y;
    doc.text(label, 48, y);
    doc.text(value, 48, y, { align: 'right', width: doc.page.width - 96 });
    doc.moveDown(bold ? 0.6 : 0.4);
  };

  doc.fontSize(13).fillColor('#0E7C66').text('IVA');
  doc.moveDown(0.3);
  line('Base gravada 5%', fmtGs(summary.baseGrav5));
  line('IVA 5%', fmtGs(summary.iva5));
  line('Base gravada 10%', fmtGs(summary.baseGrav10));
  line('IVA 10%', fmtGs(summary.iva10));
  line('Total IVA', fmtGs(summary.totalIva), true);
  doc.moveDown(0.6);

  doc.fontSize(13).fillColor('#0E7C66').text('Resumen');
  doc.moveDown(0.3);
  line('Ventas (ingresos)', fmtGs(summary.ventas));
  line('Compras (gastos)', fmtGs(summary.compras));
  line('IVA crédito (compras)', fmtGs(summary.ivaCredito));
  line('IVA débito (ventas)', fmtGs(summary.ivaDebito));
  line('IRP estimado (simplificado)', fmtGs(summary.irpEstimado), true);
  doc.moveDown(0.6);

  if (summary.byMonth.length) {
    doc.fontSize(13).fillColor('#0E7C66').text('Por mes');
    doc.moveDown(0.3);
    for (const m of summary.byMonth) {
      line(`${m.month} (${m.count})`, `${fmtGs(m.total)} · IVA ${fmtGs(m.iva)}`);
    }
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
  add('Base gravada 5%', summary.baseGrav5);
  add('IVA 5%', summary.iva5);
  add('Base gravada 10%', summary.baseGrav10);
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

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
