import { describe, expect, it } from 'vitest';

import {
  rowsFromAnnotation,
  type VisionAnnotation,
  type VisionWord,
} from '../src/services/vision-layout';
import { visionFixture } from './fixtures/vision';

describe('rowsFromAnnotation — the Super Primavera ticket stored as Gs 29', () => {
  const a = visionFixture('primavera-ticket');
  const rows = rowsFromAnnotation(a) as string;

  it("reproduces the failure in Vision's own text: two labels, then their values", () => {
    expect(a.text).toMatch(/RES\.347-SEDECO:\nTOTAL GS:\n29\n223\.150/);
  });

  it('puts each value back on the line of its label', () => {
    expect(rows).toMatch(/^RES\.347-SEDECO:\s*29$/m);
    expect(rows).toMatch(/^TOTAL GS:\s*223\.150$/m);
    expect(rows).toMatch(/^TOTAL IVA GS:\s*16\.973$/m);
  });

  it('keeps an item line whole, with its rate at the end, as printed', () => {
    expect(rows).toMatch(/^245208 0,12 69\.990 8\.119 10$/m);
  });
});

describe('rowsFromAnnotation — the KuDE whose total came out as Gs 8.000', () => {
  const rows = rowsFromAnnotation(visionFixture('fox-kude')) as string;

  it('pairs the totals and the tax detail with their own amounts', () => {
    expect(rows).toMatch(/^Total Pago\.\s*Gs 48\.000$/m);
    expect(rows).toMatch(/^Gravadas 10%:\s*Gs 48\.000$/m);
    expect(rows).toMatch(/^IVA 10%:\s*Gs 4\.364$/m);
  });

  it('leaves the last item on its own line instead of on the total', () => {
    expect(rows).toMatch(/^12550 CARTULINA CARTON 1 UN Gs 8\.000$/m);
  });

  it("spaces words by Vision's own breaks, so labels are not glued together", () => {
    expect(rows).toMatch(/^IVA 5%\* Gs 0$/m);
    expect(rows).not.toMatch(/IVA5%|TotalPago/);
  });
});

describe('rowsFromAnnotation — lettering of different sizes on one line', () => {
  it('keeps a small "MINAS281" beside a large "MERCADO"', () => {
    const rows = rowsFromAnnotation(visionFixture('minas281-ticket')) as string;
    expect(rows.split('\n')[0]).toBe('MINAS281 MERCADO');
  });
});

// ---------------------------------------------------------------------------
// Synthetic pages: each isolates one decision the real photos depend on.

/** A word as Vision shapes it: a box, and symbols with the break after the last. */
function word(text: string, x: number, y: number, brk: string | null = 'SPACE', h = 20): VisionWord {
  const w = text.length * 10;
  return {
    boundingBox: {
      vertices: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    },
    symbols: [...text].map((ch, i, all) => ({
      text: ch,
      ...(i === all.length - 1 && brk ? { property: { detectedBreak: { type: brk } } } : {}),
    })),
  };
}

const page = (...blocks: VisionWord[][]): VisionAnnotation => ({
  pages: [{ blocks: blocks.map((words) => ({ paragraphs: [{ words }] })) }],
});

/** Every vertex turned by `deg` about the origin, as in a tilted photo. */
function rotated(a: VisionAnnotation, deg: number): VisionAnnotation {
  const r = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const copy = structuredClone(a);
  for (const pg of copy.pages ?? [])
    for (const b of pg.blocks ?? [])
      for (const p of b.paragraphs ?? [])
        for (const w of p.words ?? [])
          for (const v of w.boundingBox?.vertices ?? []) {
            const [x, y] = [v.x ?? 0, v.y ?? 0];
            v.x = Math.round(x * c - y * s);
            v.y = Math.round(x * s + y * c);
          }
  return copy;
}

/** Labels in one block, their values in another — the layout that broke. */
const COLUMNS = page(
  [word('RES.347:', 0, 0, 'LINE_BREAK'), word('TOTAL', 0, 30), word('GS:', 60, 30, 'LINE_BREAK')],
  [word('29', 300, 0, 'LINE_BREAK'), word('223.150', 300, 30, 'LINE_BREAK')],
);

describe('rowsFromAnnotation — joining and ordering', () => {
  it('pairs a column of labels with the column of their values', () => {
    expect(rowsFromAnnotation(COLUMNS)).toBe('RES.347: 29\nTOTAL GS: 223.150');
  });

  it("glues what Vision reads as one token, like '223' '.' '150'", () => {
    const a = page([
      word('TOTAL', 0, 0),
      word('223', 200, 0, null),
      word('.', 230, 0, null),
      word('150', 240, 0, 'LINE_BREAK'),
    ]);
    expect(rowsFromAnnotation(a)).toBe('TOTAL 223.150');
  });

  it('straightens a tilted photo', () => {
    expect(rowsFromAnnotation(rotated(COLUMNS, 4))).toBe('RES.347: 29\nTOTAL GS: 223.150');
    expect(rowsFromAnnotation(rotated(COLUMNS, -6))).toBe('RES.347: 29\nTOTAL GS: 223.150');
  });

  it('reads a photo taken sideways or upside down', () => {
    expect(rowsFromAnnotation(rotated(COLUMNS, 90))).toBe('RES.347: 29\nTOTAL GS: 223.150');
    expect(rowsFromAnnotation(rotated(COLUMNS, 180))).toBe('RES.347: 29\nTOTAL GS: 223.150');
  });

  it('follows a curled line whose ends sit at different heights', () => {
    // Each word 8px lower than the last: the two ends are 32px apart, more
    // than a word's height, yet every neighbour overlaps the next.
    const a = page([
      word('AA', 0, 0),
      word('BB', 30, 8),
      word('CC', 60, 16),
      word('DD', 90, 24),
      word('EE', 120, 32, 'LINE_BREAK'),
      word('NEXT', 0, 70, 'LINE_BREAK'),
    ]);
    expect(rowsFromAnnotation(a)).toBe('AA BB CC DD EE\nNEXT');
  });

  it('never stacks two words that occupy the same place into one line', () => {
    // Tight line spacing: the heights overlap by more than half, but one word
    // sits on top of the other, so they cannot be on the same printed line.
    const a = page([word('AAAA', 0, 0, 'LINE_BREAK'), word('BBBB', 0, 9, 'LINE_BREAK')]);
    expect(rowsFromAnnotation(a)).toBe('AAAA\nBBBB');
  });

  it('keeps the real Primavera footer intact at a tilt', () => {
    const rows = rowsFromAnnotation(rotated(visionFixture('primavera-ticket'), 5)) as string;
    expect(rows).toMatch(/^TOTAL GS:\s*223\.150$/m);
    expect(rows).toMatch(/^RES\.347-SEDECO:\s*29$/m);
  });
});

describe('rowsFromAnnotation — when there is nothing to rebuild', () => {
  it('returns null without pages', () => {
    expect(rowsFromAnnotation({ text: 'TOTAL 1.000' })).toBeNull();
    expect(rowsFromAnnotation(null)).toBeNull();
  });

  it('returns null for words without boxes', () => {
    const a: VisionAnnotation = {
      pages: [{ blocks: [{ paragraphs: [{ words: [{ symbols: [{ text: 'A' }] }, { symbols: [{ text: 'B' }] }] }] }] }],
    };
    expect(rowsFromAnnotation(a)).toBeNull();
  });

  it('gives up on a box without height rather than split what surrounds it', () => {
    // Leaving the "." out would read "223 150" — a total of 150.
    const dot = word('.', 230, 0, null);
    for (const v of dot.boundingBox?.vertices ?? []) v.y = 0;
    const a = page([word('TOTAL', 0, 0), word('223', 200, 0, null), dot, word('150', 240, 0, 'LINE_BREAK')]);
    expect(rowsFromAnnotation(a)).toBeNull();
  });

  it('returns null for more than one page, whose coordinates do not mix', () => {
    const one = COLUMNS.pages?.[0];
    expect(rowsFromAnnotation({ pages: [one ?? {}, one ?? {}] })).toBeNull();
  });
});
