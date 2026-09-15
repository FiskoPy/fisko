/**
 * Rebuilds a receipt's printed lines from Cloud Vision's word boxes.
 *
 * Vision's own text (fullTextAnnotation.text) follows its BLOCKS, and on a till
 * receipt it puts a column of labels and the column of their values in
 * separate blocks. The Super Primavera ticket came back as
 *     RES.347-SEDECO:
 *     TOTAL GS:
 *     29          <- the rounding, printed beside RES.347-SEDECO
 *     223.150     <- the total, printed beside TOTAL GS
 * and reading that line by line paired TOTAL GS with 29: the app stored a
 * Gs 223.150 purchase as Gs 29 (2026-09-15). The paper is printed in rows, so
 * rebuild the rows. Every word carries its box; words that sit on the same
 * printed line are joined left to right.
 *
 * A wrong row here is caught downstream — the parser checks the amounts
 * against each other and importPhoto refuses what does not add up — but each
 * one costs the user a retake, so the geometry is worth getting right.
 */

export interface VisionVertex {
  x?: number;
  y?: number;
}
export interface VisionSymbol {
  text?: string;
  property?: { detectedBreak?: { type?: string } };
}
export interface VisionWord {
  boundingBox?: { vertices?: VisionVertex[] };
  symbols?: VisionSymbol[];
}
export interface VisionPage {
  blocks?: { paragraphs?: { words?: VisionWord[] }[] }[];
}
export interface VisionAnnotation {
  text?: string;
  pages?: VisionPage[];
}

type Point = [number, number];

interface RawWord {
  text: string;
  /** Position in Vision's reading order. */
  order: number;
  /** Whether Vision itself prints a space (or a line break) after this word. */
  spaceAfter: boolean;
  /** Corners in Vision's order: top-left, top-right, bottom-right, bottom-left. */
  v: [Point, Point, Point, Point];
  chars: number;
}

interface Box {
  text: string;
  order: number;
  spaceAfter: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Breaks after which Vision's own text has whitespace. */
const SPACED = new Set(['SPACE', 'SURE_SPACE', 'EOL_SURE_SPACE', 'LINE_BREAK', 'HYPHEN']);

/** Rows further back than this are finished; a word never joins them. */
const LOOKBACK = 8;

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]): number => sum(values) / values.length;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** An angle folded into (-π, π]. */
const wrap = (t: number): number => Math.atan2(Math.sin(t), Math.cos(t));

/** Horizontal distance between two boxes; 0 when they overlap. */
const gapX = (a: Box, b: Box): number => Math.max(0, a.x0 - b.x1, b.x0 - a.x1);

/** How much of the narrower box's width the two boxes share. */
function sharedWidth(a: Box, b: Box): number {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  return overlap / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
}

/** How much of the shorter box's height the two boxes share. */
function sharedHeight(a: Box, b: Box): number {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return overlap / Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0));
}

/**
 * Vision's words in reading order — or null when a box cannot be placed.
 *
 * A box without width or height, or with a coordinate that is not a number,
 * sits on no line; leaving its word out would split what surrounds it ("223"
 * "." "150" read as "223 150", a total of 150). Then the rows are not rebuilt
 * at all, and the caller keeps Vision's own text.
 */
function readWords(page: VisionPage): RawWord[] | null {
  const raw: RawWord[] = [];
  let order = 0;
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const word of para.words ?? []) {
        const symbols = word.symbols ?? [];
        const text = symbols.map((s) => s.text ?? '').join('');
        const vertices = word.boundingBox?.vertices ?? [];
        const index = order++;
        if (!text || vertices.length !== 4) continue;

        // Vision leaves out a coordinate that is zero.
        const v = vertices.map((p) => [Number(p.x ?? 0), Number(p.y ?? 0)] as Point) as RawWord['v'];
        if (!v.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return null;
        const [p0, p1, , p3] = v;
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1) return null;
        if (Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) < 1) return null;

        const brk = symbols[symbols.length - 1]?.property?.detectedBreak?.type;
        raw.push({ text, order: index, spaceAfter: brk != null && SPACED.has(brk), v, chars: symbols.length });
      }
    }
  }
  return raw;
}

/**
 * The photo's rotation, from the angle of each word's top edge — Vision orders
 * a word's corners along its reading direction.
 *
 * Angles wrap at ±180°: a plain median over an upside-down photo, whose words
 * read +179.5° and −179.5°, lands near 0° and straightens nothing (a KuDE at
 * 180.5° was read as a total of Gs 1). So the mean direction comes first, then
 * the median of each word's offset from it.
 */
function rotation(words: RawWord[]): number {
  const angles = words
    .filter((w) => w.chars >= 3)
    .map(({ v: [p0, p1] }) => Math.atan2(p1[1] - p0[1], p1[0] - p0[0]));
  if (!angles.length) return 0;
  const direction = Math.atan2(sum(angles.map(Math.sin)), sum(angles.map(Math.cos)));
  return direction + median(angles.map((t) => wrap(t - direction)));
}

interface Bend {
  a: number;
  b: number;
  c: number;
  xm: number;
  ym: number;
}

/**
 * The bend left in the lines once the page is level.
 *
 * One rotation levels a flat photo taken square-on. A curled ticket bows its
 * lines — their words tilt one way on the left and the other on the right —
 * and a photo taken off-axis tilts the lines above the centre against those
 * below. Either moved a KuDE's IVA 10% amount one row, onto the IVA 5% line,
 * in testing. Each word's tilt is fitted as
 *     slope = a + b·(x − xm) + c·(y − ym)
 * by least squares over the longer words, twice: the second pass drops words
 * more than three median deviations off the first fit. Null when too few
 * words carry a usable tilt.
 */
function fitBend(words: { v: Point[]; chars: number }[]): Bend | null {
  let pts = words
    .filter((w) => w.chars >= 3)
    .map(({ v }) => {
      const [p0, p1, p2, p3] = v as [Point, Point, Point, Point];
      // Top and bottom edges together: half the noise of either alone.
      const dx = p1[0] - p0[0] + (p2[0] - p3[0]);
      const dy = p1[1] - p0[1] + (p2[1] - p3[1]);
      return {
        x: (p0[0] + p1[0] + p2[0] + p3[0]) / 4,
        y: (p0[1] + p1[1] + p2[1] + p3[1]) / 4,
        s: dx > 0 ? dy / dx : NaN,
      };
    })
    .filter((p) => Number.isFinite(p.s));

  let bend: Bend | null = null;
  for (let pass = 0; pass < 2 && pts.length >= 12; pass++) {
    const n = pts.length;
    const xm = mean(pts.map((p) => p.x));
    const ym = mean(pts.map((p) => p.y));
    const a = mean(pts.map((p) => p.s));
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let sxs = 0;
    let sys = 0;
    for (const p of pts) {
      const [X, Y, S] = [p.x - xm, p.y - ym, p.s - a];
      sxx += X * X;
      syy += Y * Y;
      sxy += X * Y;
      sxs += X * S;
      sys += Y * S;
    }
    const det = sxx * syy - sxy * sxy;
    // A single row of words (all at one height) has no y spread to fit c from.
    const full = det > 1e-9 * Math.max(1, sxx * syy);
    const b = full ? (sxs * syy - sys * sxy) / det : sxx > 0 ? sxs / sxx : 0;
    const c = full ? (sys * sxx - sxs * sxy) / det : 0;

    const off = pts.map((p) => p.s - (a + b * (p.x - xm) + c * (p.y - ym)));
    // A term is kept only when the words clearly hold it — three standard
    // errors. On a flat photo the fit is noise, and applying a noisy bend
    // moved a small "5%" off its line on a ticket turned by a single degree.
    const s2 = sum(off.map((r) => r * r)) / Math.max(1, n - 3);
    const seA = Math.sqrt(s2 / n);
    const seB = Math.sqrt(s2 * (full ? syy / det : 1 / Math.max(sxx, 1e-12)));
    const seC = full ? Math.sqrt((s2 * sxx) / det) : Infinity;
    bend = {
      a: Math.abs(a) > 3 * seA ? a : 0,
      b: Math.abs(b) > 3 * seB ? b : 0,
      c: Math.abs(c) > 3 * seC ? c : 0,
      xm,
      ym,
    };

    const dev = off.map(Math.abs);
    const mad = median(dev) || 1e-9;
    pts = pts.filter((_, i) => (dev[i] as number) <= 3 * mad);
  }
  return bend;
}

/**
 * The receipt's words, levelled and unbent.
 *
 * After the rotation, the fitted tilt is integrated back out of every corner:
 *     y' = y − a·X − (b/2)·X² − c·X·Y,   X = x − xm, Y = y − ym
 * which flattens a line whose slope varies across the page the way the fit
 * says it does.
 */
function straightened(words: RawWord[], unbend: boolean): Box[] {
  const angle = rotation(words);
  const [cos, sin] = [Math.cos(-angle), Math.sin(-angle)];
  const turned = words.map((w) => ({
    ...w,
    v: w.v.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos] as Point),
  }));

  const bend = unbend ? fitBend(turned) : null;
  const flat = ([x, y]: Point): Point => {
    if (!bend) return [x, y];
    const X = x - bend.xm;
    const Y = y - bend.ym;
    return [x, y - bend.a * X - (bend.b / 2) * X * X - bend.c * X * Y];
  };

  return turned.map((w) => {
    const v = w.v.map(flat);
    const xs = v.map(([x]) => x);
    const ys = v.map(([, y]) => y);
    return {
      text: w.text,
      order: w.order,
      spaceAfter: w.spaceAfter,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
  });
}

/**
 * Groups words into printed rows.
 *
 * A word joins the row whose nearest word (in x) shares at least half of the
 * shorter height with it. Comparing against the NEAREST word rather than the
 * row as a whole follows whatever bend the straightening left; comparing
 * heights relative to the shorter word keeps a small "MINAS281" beside a large
 * "MERCADO". A word that would sit on top of one already in the row is on
 * another line, however tight the spacing.
 */
function groupRows(words: Box[]): Box[][] {
  const sorted = [...words].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const rows: Box[][] = [];

  for (const w of sorted) {
    let best: Box[] | null = null;
    let bestShare = 0.5;
    for (let r = rows.length - 1; r >= Math.max(0, rows.length - LOOKBACK); r--) {
      const row = rows[r] as Box[];
      if (row.some((o) => sharedWidth(o, w) > 0.3)) continue;
      const near = row.reduce((a, b) => (gapX(a, w) <= gapX(b, w) ? a : b));
      const share = sharedHeight(near, w);
      if (share >= bestShare) {
        best = row;
        bestShare = share;
      }
    }
    if (best) best.push(w);
    else rows.push([w]);
  }

  const middle = (row: Box[]) => median(row.map((b) => (b.y0 + b.y1) / 2));
  return rows.sort((a, b) => middle(a) - middle(b));
}

/**
 * Joins a row's words left to right.
 *
 * Where two neighbours are also neighbours in Vision's reading order, Vision's
 * own break decides the space — it knows "223", "." and "150" are one number.
 * Words that meet only because the row brought them together (a label and a
 * value from different blocks) get a space.
 */
function joinRow(row: Box[]): string {
  const ordered = [...row].sort((a, b) => a.x0 - b.x0);
  let line = (ordered[0] as Box).text;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1] as Box;
    const cur = ordered[i] as Box;
    const glued = cur.order === prev.order + 1 && !prev.spaceAfter;
    line += (glued ? '' : ' ') + cur.text;
  }
  return line;
}

/**
 * The receipt as printed, one row per line — or null when the annotation has
 * no usable geometry, in which case the caller keeps Vision's own text.
 * With `unbend: false` the page is levelled but its lines keep any bend.
 */
export function rowsFromAnnotation(
  annotation: VisionAnnotation | null | undefined,
  { unbend = true }: { unbend?: boolean } = {},
): string | null {
  // A receipt is one page. Several pages share a coordinate space only by
  // accident, and mixing their rows would be worse than not rebuilding them.
  const pages = annotation?.pages ?? [];
  if (pages.length !== 1) return null;

  const words = readWords(pages[0] as VisionPage);
  if (!words || words.length < 2) return null;

  return groupRows(straightened(words, unbend)).map(joinRow).join('\n');
}

/**
 * Every reading of one photo that parseBest should weigh, in order of
 * preference on a tie: the rows levelled; the rows levelled and unbent; and
 * Vision's own text.
 *
 * Unbending is right for a curled or off-axis photo and wrong for a flat one:
 * on the Super Primavera ticket turned by a single degree, the fitted bend
 * moved a small "5%" off its line. Neither is right every time, so both are
 * offered and the footer's arithmetic chooses.
 */
export function layoutsOf(
  annotation: VisionAnnotation | null | undefined,
): { layout: string; text: string | null }[] {
  return [
    { layout: 'rows', text: rowsFromAnnotation(annotation, { unbend: false }) },
    { layout: 'rows-unbent', text: rowsFromAnnotation(annotation) },
    { layout: 'blocks', text: annotation?.text?.trim() || null },
  ];
}
