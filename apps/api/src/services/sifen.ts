import { XMLParser } from 'fast-xml-parser';
import { AppError } from '../errors/app-error';

/**
 * SIFEN DTE (Documento Tributário Electrónico) parser.
 *
 * Handles the Paraguayan electronic invoice XML (namespace
 * http://ekuatia.set.gov.py/sifen/xsd). The DE node may be wrapped in rDE /
 * rEnviDe / xDE and/or a SOAP envelope — we locate it structurally.
 *
 * IMPORTANT: validate against more real DTEs and the official DNIT spec before
 * relying on the CDC check-digit in production.
 */

export type DteDocType = 1 | 4 | 5 | 6 | 7; // Factura, Autofactura, NC, ND, NR

export interface ParsedDteItem {
  codigo: string | null;
  descripcion: string;
  cantidad: number;
  precioUnit: number;
  total: number;
  ivaRate: number; // 0 exento, 5, 10
  ivaBase: number;
  ivaMonto: number;
}

export interface ParsedDte {
  cdc: string;
  tipoDoc: number;
  tipoDocDesc: string | null;
  emisorRuc: string;
  emisorDv: number | null;
  emisorNombre: string;
  receptorRuc: string | null;
  receptorDv: number | null;
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
  items: ParsedDteItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true, // coerce numeric tag values
  parseAttributeValue: false, // keep attributes (CDC) as strings (preserve leading zeros)
  trimValues: true,
});

type AnyObj = Record<string, unknown>;

const isObj = (v: unknown): v is AnyObj => typeof v === 'object' && v !== null;

/** Finds the DE node anywhere in the parsed tree (it has gTimb + gDatGralOpe). */
function findDeNode(node: unknown): AnyObj | null {
  if (!isObj(node)) return null;
  if ('gTimb' in node && 'gDatGralOpe' in node) return node;
  for (const key of Object.keys(node)) {
    const found = findDeNode((node as AnyObj)[key]);
    if (found) return found;
  }
  return null;
}

/** First value found anywhere under `node` for a given key. */
function deepFind(node: unknown, key: string): unknown {
  if (!isObj(node)) return undefined;
  if (key in node) return node[key];
  for (const k of Object.keys(node)) {
    const found = deepFind(node[k], key);
    if (found !== undefined) return found;
  }
  return undefined;
}

const num = (v: unknown, fallback = 0): number => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown): string | null => {
  if (v === undefined || v === null || v === '') return null;
  return String(v);
};

const asArray = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function parseItem(raw: unknown): ParsedDteItem {
  const it = isObj(raw) ? raw : {};
  const valor = isObj(it.gValorItem) ? it.gValorItem : {};
  const resta = isObj(valor.gValorRestaItem) ? valor.gValorRestaItem : {};
  const iva = isObj(it.gCamIVA) ? it.gCamIVA : {};
  return {
    codigo: str(it.dCodInt),
    descripcion: str(it.dDesProSer) ?? '',
    cantidad: num(it.dCantProSer),
    precioUnit: num(valor.dPUniProSer),
    total: num(resta.dTotOpeItem ?? valor.dTotBruOpeItem),
    ivaRate: num(iva.dTasaIVA),
    ivaBase: num(iva.dBasGravIVA),
    ivaMonto: num(iva.dLiqIVAItem),
  };
}

/** Parses a raw DTE XML string into a normalized structure. Throws AppError on bad input. */
export function parseDte(xml: string): ParsedDte {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    throw AppError.badRequest('XML inválido');
  }

  const de = findDeNode(parsed);
  if (!de) throw AppError.badRequest('No se encontró el documento electrónico (DE) en el XML');

  const cdc = String(de['@_Id'] ?? deepFind(de, '@_Id') ?? '');
  if (!isValidCdcStructure(cdc)) {
    throw AppError.badRequest('CDC inválido (se esperan 44 dígitos)');
  }

  const gTimb = isObj(de.gTimb) ? de.gTimb : {};
  const gGral = isObj(de.gDatGralOpe) ? de.gDatGralOpe : {};
  const gEmis = isObj(gGral.gEmis) ? gGral.gEmis : {};
  const gRec = isObj(gGral.gDatRec) ? gGral.gDatRec : {};
  const gOpeCom = isObj(gGral.gOpeCom) ? gGral.gOpeCom : {};
  const gTot = (isObj(de.gTotSub) ? de.gTotSub : deepFind(de, 'gTotSub')) as AnyObj | undefined;
  const tot = isObj(gTot) ? gTot : {};

  const items = asArray(deepFind(de, 'gCamItem')).map(parseItem);

  return {
    cdc,
    tipoDoc: num(gTimb.iTiDE),
    tipoDocDesc: str(gTimb.dDesTiDE),
    emisorRuc: str(gEmis.dRucEm) ?? '',
    emisorDv: gEmis.dDVEmi === undefined ? null : num(gEmis.dDVEmi),
    emisorNombre: str(gEmis.dNomEmi) ?? '',
    receptorRuc: str(gRec.dRucRec),
    receptorDv: gRec.dDVRec === undefined ? null : num(gRec.dDVRec),
    receptorNombre: str(gRec.dNomRec),
    fechaEmision: parseDate(gGral.dFeEmiDE),
    moneda: str(gOpeCom.cMoneOpe) ?? 'PYG',
    totalOpe: num(tot.dTotGralOpe),
    totalIva: num(tot.dTotIVA),
    iva5: num(tot.dIVA5),
    iva10: num(tot.dIVA10),
    baseGrav5: num(tot.dBaseGrav5),
    baseGrav10: num(tot.dBaseGrav10),
    originalCdc: str(deepFind(de, 'dCdCDERef')),
    items,
  };
}

function parseDate(v: unknown): Date {
  const d = v ? new Date(String(v)) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest('Fecha de emisión inválida en el DTE');
  return d;
}

/** Structural CDC check: 44 digits. */
export function isValidCdcStructure(cdc: string): boolean {
  return /^\d{44}$/.test(cdc);
}

/**
 * CDC check digit (módulo 11, base 11) over the first 43 digits — the 44th is
 * the verifier. Best-effort: validated against a real signed DTE.
 */
export function cdcCheckDigit(cdc: string, base = 11): number {
  const digits = cdc.slice(0, 43);
  let total = 0;
  let k = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    total += parseInt(digits[i] as string, 10) * k;
    k = k < base ? k + 1 : 2;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

export function isValidCdcCheckDigit(cdc: string): boolean {
  if (!isValidCdcStructure(cdc)) return false;
  return cdcCheckDigit(cdc) === parseInt(cdc[43] as string, 10);
}
