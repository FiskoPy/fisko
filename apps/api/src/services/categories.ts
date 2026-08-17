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
  | 'combustible'
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
      /\b(tigo|personal|claro|copaco|vox|telecel|nucleo)\b/,
      /\b(internet|telefonia|telefono|celular|fibra optica|plan de datos|cable)\b/,
    ],
  },
  {
    key: 'financiero',
    label: 'Bancos y finanzas',
    patterns: [
      /\b(banco|bancard|sudameris|itau|continental|regional|vision banco|financiera|cooperativa)\b/,
      /\b(seguro|seguros|poliza|comision bancaria|interes|prestamo)\b/,
    ],
  },
  {
    key: 'alimentacion',
    label: 'Alimentación',
    patterns: [
      /\b(supermercado|superseis|stock|biggie|arete|casa rica|nuevo superseis|salemma)\b/,
      /\b(restaurante|rotiseria|panaderia|comida|almuerzo|cena|despensa|carniceria|verduleria)\b/,
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
