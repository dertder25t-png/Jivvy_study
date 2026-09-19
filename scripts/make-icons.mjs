// Generates the app icons (a stack of flashcards on indigo) as plain PNGs — no image libraries needed.
//   node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const INDIGO = [79, 70, 229];
const WHITE = [255, 255, 255];

// ---- tiny PNG encoder ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- drawing: signed distance to a rounded rectangle (negative = inside) ----
const rr = (x, y, cx, cy, w, h, r) => {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d)); // 1px antialiasing
const mix = (base, top, t) => base.map((v, i) => Math.round(v * (1 - t) + top[i] * t));

function art(x, y, s, { rounded }) {
  let c = INDIGO;
  let alpha = 255;
  if (rounded) alpha = Math.round(255 * cover(rr(x, y, s / 2, s / 2, s, s, s * 0.22)));
  const u = s / 100;
  // back card (softer), front card (white), two "lines of text" on the front card
  c = mix(c, WHITE, 0.45 * cover(rr(x, y, 55 * u, 42 * u, 46 * u, 33 * u, 5 * u)));
  c = mix(c, WHITE, cover(rr(x, y, 47 * u, 52 * u, 46 * u, 33 * u, 5 * u)));
  c = mix(c, INDIGO, cover(rr(x, y, 47 * u, 46 * u, 26 * u, 4 * u, 2 * u)));
  c = mix(c, INDIGO, 0.75 * cover(rr(x, y, 43 * u, 56 * u, 18 * u, 4 * u, 2 * u)));
  return [...c, alpha];
}

mkdirSync('public', { recursive: true });
mkdirSync('assets', { recursive: true });
const out = [
  ['public/icon-192.png', 192, true],
  ['public/icon-512.png', 512, true],
  ['public/apple-touch-icon.png', 180, false], // iOS applies its own rounding
  ['assets/icon.png', 1024, false],
  ['assets/favicon.png', 48, true],
];
for (const [file, size, rounded] of out) {
  writeFileSync(file, png(size, (x, y, s) => art(x, y, s, { rounded })));
  console.log('wrote', file);
}
