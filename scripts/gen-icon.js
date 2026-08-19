// Fisko launcher icon generator.
//
// Regenerate every icon after a palette change:
//   node scripts/gen-icon.js --install
//
// Or one-off:  node scripts/gen-icon.js <size> <radius> <out> [...]
// radius 0 writes RGB without an alpha channel (Apple rejects App Store
// icons that carry one at all, even fully opaque - ITMS-90717); any other
// radius writes RGBA with rounded, transparent corners for Android.
// Mark: white "F" on azul Ypacaraí, underlined by one two-tone rule —
// left half verde (IVA 5%), right half ámbar (IVA 10%). Same discipline as
// the app: those two hues only ever mean the two IVA rates.
const fs = require('fs');
const zlib = require('zlib');

const AZUL  = [0x14, 0x50, 0x8f];
const VERDE = [0x2e, 0x8b, 0x6f];
const AMBAR = [0xe0, 0xa3, 0x2e];
const WHITE = [0xff, 0xff, 0xff];

// Geometry in a 0..1 square, so it scales to any size.
const G = {
  // The mark (F + rule) is centred as a group: it spans x 0.300..0.700 and
  // y 0.230..0.770, so both axes read balanced inside the tile.
  stem:  { x: 0.300, y: 0.230, w: 0.115, h: 0.400 },
  arm1:  { x: 0.300, y: 0.230, w: 0.400, h: 0.105 },
  arm2:  { x: 0.300, y: 0.410, w: 0.300, h: 0.098 },
  // Two-tone rule, full mark width, split exactly at the centre.
  ruleL: { x: 0.300, y: 0.695, w: 0.200, h: 0.075 },
  ruleR: { x: 0.500, y: 0.695, w: 0.200, h: 0.075 },
};

const inRect = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

// Rounded-square background (Android/iOS mask further, but a baked radius keeps
// the legacy launcher icon from looking like a raw square).
function inRounded(x, y, radius) {
  const r = radius;
  if (x < 0 || y < 0 || x > 1 || y > 1) return false;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r + 1e-12;
}

function colorAt(x, y, radius) {
  if (!inRounded(x, y, radius)) return null; // transparent outside
  if (inRect(x, y, G.stem) || inRect(x, y, G.arm1) || inRect(x, y, G.arm2)) return WHITE;
  if (inRect(x, y, G.ruleL)) return VERDE;
  if (inRect(x, y, G.ruleR)) return AMBAR;
  return AZUL;
}

// 4x4 supersampling per pixel for clean edges.
function render(size, radius) {
  const SS = 4, px = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((pxi + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, radius);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS, o = (py * size + pxi) * 4;
      const cov = a / (255 * n);
      px[o]     = cov > 0 ? Math.round(r / (n * cov)) : 0;
      px[o + 1] = cov > 0 ? Math.round(g / (n * cov)) : 0;
      px[o + 2] = cov > 0 ? Math.round(b / (n * cov)) : 0;
      px[o + 3] = Math.round(a / n);
    }
  }
  return px;
}

// --- minimal PNG encoder -------------------------------------------------
function crc32(buf) {
  let c, table = crc32.t || (crc32.t = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })());
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px, rgbOnly) {
  const ch = rgbOnly ? 3 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = rgbOnly ? 2 : 6; // 8-bit RGB or RGBA
  const stride = size * ch + 1;
  const rows = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    rows[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4, dst = y * stride + 1 + x * ch;
      rows[dst] = px[src]; rows[dst + 1] = px[src + 1]; rows[dst + 2] = px[src + 2];
      if (!rgbOnly) rows[dst + 3] = px[src + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Args come in triples: <size> <radius> <outPath>. Not a ":"-joined string —
// Windows paths start with "c:" and iOS icon filenames contain "@", so both of
// the obvious separators silently truncate the path.
const a0 = process.argv.slice(2);

// --install regenerates every icon the two projects need, in one go, so a
// palette change never leaves a stale size behind.
if (a0[0] === '--install') {
  const path = require('path');
  const root = path.join(__dirname, '..', 'apps', 'mobile');
  const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
  const ios = path.join(root, 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset');
  const android = [[48, 'mdpi'], [72, 'hdpi'], [96, 'xhdpi'], [144, 'xxhdpi'], [192, 'xxxhdpi']];
  const apple = [[20, '20x20@1x'], [40, '20x20@2x'], [60, '20x20@3x'], [29, '29x29@1x'],
    [58, '29x29@2x'], [87, '29x29@3x'], [40, '40x40@1x'], [80, '40x40@2x'], [120, '40x40@3x'],
    [120, '60x60@2x'], [180, '60x60@3x'], [76, '76x76@1x'], [152, '76x76@2x'],
    [167, '83.5x83.5@2x'], [1024, '1024x1024@1x']];
  let n = 0;
  for (const [size, dpi] of android) {
    fs.writeFileSync(path.join(res, 'mipmap-' + dpi, 'ic_launcher.png'),
      png(size, Buffer.from(render(size, 0.22)), false)); n++;
  }
  for (const [size, name] of apple) {
    fs.writeFileSync(path.join(ios, 'Icon-App-' + name + '.png'),
      png(size, Buffer.from(render(size, 0)), true)); n++;
  }
  console.log(n + ' iconos regenerados (Android + iOS)');
  process.exit(0);
}

const a = a0;
if (a.length % 3 !== 0) {
  console.error('uso: node gen_icon.js <size> <radius> <out> [<size> <radius> <out> ...]');
  process.exit(1);
}
for (let i = 0; i < a.length; i += 3) {
  const size = parseInt(a[i], 10);
  const radius = parseFloat(a[i + 1]);
  const out = a[i + 2];
  if (!Number.isFinite(size) || !Number.isFinite(radius) || !out) {
    console.error('argumento invalido:', a.slice(i, i + 3).join(' '));
    process.exit(1);
  }
  const buf = png(size, Buffer.from(render(size, radius)), radius === 0);
  fs.writeFileSync(out, buf);
  console.log(`${String(size).padStart(4)}x${String(size).padEnd(4)} r=${radius}  ${buf.length}B  ${out.split(/[\/]/).pop()}`);
}
