/**
 * Rule-based expense categorisation for imported DTEs.
 *
 * Deliberately NOT AI: the Dashboard's category breakdown is Marco 2 and must
 * work without the OpenAI key. Marco 2 phase 2E can later refine (or override)
 * these buckets — keeping the derivation pure and re-computed on read means an
 * improved ruleset applies retroactively, with no migration or backfill.
 *
 * Matching looks at the issuer's name first (a fuel station is a fuel station
 * whatever it sold) and then at the line-item descriptions.
 */

export type CategoryKey =
  | 'insumos_agricolas'
  | 'combustible'
  | 'supermercado'
  | 'alimentacion'
  | 'servicios_basicos'
  | 'telecomunicaciones'
  | 'transporte'
  | 'salud'
  | 'educacion'
  | 'tecnologia'
  | 'financiero'
  | 'alquiler'
  | 'vestimenta'
  | 'otros';

export interface CategoryDef {
  key: CategoryKey;
  /** es-PY label shown in the app. */
  label: string;
  patterns: RegExp[];
}

/** Lowercases and strips accents so "TELEFONÍA" matches "telefonia". */
export function normalizeText(v: string): string {
  return v
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip combining marks
    .toLowerCase();
}

// Order matters: the first definition that matches wins. More specific
// categories are declared before broader ones.
export const CATEGORIES: CategoryDef[] = [
  {
    // First, and by product name as much as by shop: the client farms, and his
    // agrochemical invoices were all landing in "Otros" — a category tells him
    // nothing, and the accountant reads these as insumos.
    key: 'insumos_agricolas',
    label: 'Insumos agrícolas',
    patterns: [
      // What the invoice is for.
      /\b(agroquimic|agroquimic[oa]s?|herbicida|fungicida|insecticida|acaricida|plaguicida|pesticida|fertilizante|abono|urea|fosfato|semillas?|silo ?bolsa|inoculante|coadyuvante|adherente)\b/,
      // Active ingredients as they are printed on a Paraguayan invoice.
      /\b(glifosato|glyphosat|sulfentrazona|cletodim|clethodim|atrazina|paraquat|dicamba|imazetapir|haloxifop|flumioxazin|metolacloro|acetocloro|tebuconazol|azoxistrobin|mancozeb|clorpirifos|lambdacialotrina|tiametoxam|imidacloprid|bifentrina|2\s*,?\s*4\s*-?\s*d)\b/,
      // Trade names seen on the client's own invoices.
      /\b(acrux|acruz|tactic|diadem|capaz)\b/,
      // The trade: a business that names itself agro sells agro.
      /\b(agro ?(?:servicios?|insumos?|campo|centro|quimica|ciencia|tienda)|agropecuaria|agroveterinaria|semilleria|cooperativa agricola)\b/,
      /\b(agro)\b(?=.*\b(?:s\.?a|s\.?r\.?l|e\.?a\.?s|ltda|cia)\b)/,
    ],
  },
  {
    // Declared first deliberately. An invoice from OCR carries no line items,
    // so the issuer's name is the only signal — which makes the order of these
    // definitions the whole classification.
    key: 'supermercado',
    label: 'Supermercado y despensa',
    patterns: [
      // Format words. The optional space survives OCR splitting the word.
      /\b(super ?mercado|hipermercado|autoservicio|mini ?mercado|mini ?market|despensa|almacen)\b/,
      // Invented names are safe on their own.
      /\b(superseis|biggie|salemma|arete|casa rica|nueva americana|los jardines|gran via|supermas|luisito)\b/,
      // Ordinary words need the format word beside them, or this would swallow
      // any company called Real, España, Primavera or Continental.
      /\b(?:super ?mercados?|hipermercado)\s+(?:real|espana|pueblo|fortis|primavera|continental|regional|guarani|central)\b/,
      /\b(stock\s+(?:express|supermarket|market)|supermercados?\s+stock)\b/,
      // "MERCADO" alone is the neighbourhood-shop format ("MINAS281 MERCADO"),
      // but not Mercado Libre or Mercado Pago.
      /\bmercado\b(?!\s+(?:libre|pago))/,
      // "SUPER <name>" is the local convention for a grocery store — but not
      // for SUPER MOTOS or SUPER REPUESTOS.
      /^(?:super|hiper)\s+(?!moto|auto|repuesto|ferreteria|hierro|deporte|sport|gomeria|neumatico|pollo)[a-z]/,
    ],
  },
  {
    key: 'combustible',
    label: 'Combustible',
    patterns: [
      /\b(petrobras|copetrol|puma energy|puma|shell|barcos y rodados|petrosur|enex)\b/,
      /\b(combustible|nafta|gasoil|gas ?oil|diesel|lubricante|estacion de servicio)\b/,
    ],
  },
  {
    key: 'servicios_basicos',
    label: 'Servicios básicos',
    patterns: [
      /\b(ande|essap|senasa)\b/,
      /\b(energia electrica|electricidad|agua potable|alcantarillado|saneamiento)\b/,
    ],
  },
  {
    key: 'telecomunicaciones',
    label: 'Telecomunicaciones',
    patterns: [
      // "personal" and "claro" are ordinary Spanish words; anchor them to the
      // company or they claim any invoice that happens to use them.
      /\b(tigo|copaco|vox|telecel|nucleo|amx paraguay)\b/,
      /\b(claro|personal)\s+(?:paraguay|py|s\.?a\.?)\b/,
      /\b(internet|telefonia|telefono|celular|fibra optica|plan de datos|cable)\b/,
    ],
  },
  {
    key: 'financiero',
    label: 'Bancos y finanzas',
    patterns: [
      // "continental" and "regional" only count as banks when the word bank is
      // present: both are also supermarket names here, and this category is
      // declared before Alimentación, so it used to win.
      /\b(bancard|sudameris|itau|vision banco|ueno|familiar|atlas|gnb|financiera|cooperativa)\b/,
      /\bbanco\s+[a-z]/,
      /\b(seguro|seguros|poliza|comision bancaria|interes|prestamo)\b/,
    ],
  },
  {
    key: 'alimentacion',
    label: 'Restaurantes y delivery',
    patterns: [
      // Supermarkets moved to their own category; this one is eating out.
      /\b(restaurante|rotiseria|panaderia|confiteria|heladeria|pizzeria|parrilla|lomiteria|hamburgueseria|cafeteria|comedor)\b/,
      /\b(comida|almuerzo|cena|carniceria|verduleria|fruteria)\b/,
      /\b(pedidosya|pedidos ya|monchis|delivery)\b/,
    ],
  },
  {
    key: 'salud',
    label: 'Salud',
    patterns: [
      /\b(farmacia|farmacenter|punto farma|catedral|sanatorio|hospital|clinica|laboratorio)\b/,
      /\b(medicamento|consulta medica|odontolog|analisis clinico|medicina prepaga)\b/,
    ],
  },
  {
    key: 'transporte',
    label: 'Transporte',
    patterns: [
      /\b(muv|bolt|uber|taxi|encarnacion express|peaje|estacionamiento)\b/,
      /\b(flete|transporte|pasaje|encomienda|logistica|neumatico|cubierta|taller mecanico)\b/,
    ],
  },
  {
    key: 'tecnologia',
    label: 'Tecnología',
    patterns: [
      /\b(microsoft|google|amazon web|aws|apple|adobe|openai|meta platforms|nubetel)\b/,
      /\b(software|licencia|hosting|dominio|servidor|notebook|computadora|impresora|toner|suscripcion digital)\b/,
    ],
  },
  {
    key: 'educacion',
    label: 'Educación',
    patterns: [
      /\b(universidad|colegio|instituto|academia|facultad)\b/,
      /\b(matricula|cuota escolar|curso|capacitacion|libro|utiles escolares)\b/,
    ],
  },
  {
    key: 'alquiler',
    label: 'Alquiler',
    patterns: [/\b(alquiler|arrendamiento|locacion de inmueble|expensas|condominio)\b/],
  },
  {
    key: 'vestimenta',
    label: 'Vestimenta',
    patterns: [
      /\b(indumentaria|vestimenta|calzado|zapateria|boutique|textil|ropa)\b/,
      /\b(unicentro|punto farma moda)\b/,
    ],
  },
];

export const OTHERS_LABEL = 'Otros';

/** Human label for a category key. */
export function categoryLabel(key: CategoryKey): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? OTHERS_LABEL;
}

/**
 * Picks the category for an invoice from the issuer name plus the item
 * descriptions. Returns 'otros' when nothing matches.
 */
export function categorize(emisorNombre: string, itemDescriptions: string[] = []): CategoryKey {
  const issuer = normalizeText(emisorNombre ?? '');
  const items = normalizeText(itemDescriptions.join(' '));

  // Issuer name is the stronger signal — check every category against it first.
  for (const def of CATEGORIES) {
    if (def.patterns.some((re) => re.test(issuer))) return def.key;
  }
  for (const def of CATEGORIES) {
    if (def.patterns.some((re) => re.test(items))) return def.key;
  }
  return 'otros';
}
