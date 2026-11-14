// Draws the toolbar icons: a rounded square in the accent colour with a white capital M.
// No dependencies. Run from the repo root after a colour change:
//   node apps/extension/tools/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const ACCENT = [0x1f, 0x4d, 0x3a];
const WHITE = [0xff, 0xff, 0xff];
const SIZES = [16, 32, 48, 128];
const SAMPLES = 6; // supersampling per axis, for smooth edges

// The M on a unit square, y pointing down.
const M = [
  [0.21, 0.74],
  [0.21, 0.26],
  [0.35, 0.26],
  [0.5, 0.5],
  [0.65, 0.26],
  [0.79, 0.26],
  [0.79, 0.74],
  [0.655, 0.74],
  [0.655, 0.475],
  [0.5, 0.715],
  [0.345, 0.475],
  [0.345, 0.74],
];

function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(x, y, inset, radius) {
  const lo = inset;
  const hi = 1 - inset;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + radius), hi - radius);
  const cy = Math.min(Math.max(y, lo + radius), hi - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function png(size) {
  // The small sizes fill the whole square; the large ones keep a little air around it.
  const inset = size >= 48 ? 0.06 : 0;
  const radius = 0.22 * (1 - 2 * inset);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    const row = py * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let square = 0;
      let letter = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!inRoundedSquare(x, y, inset, radius)) continue;
          square++;
          // The letter is scaled with the square so the proportions hold at every size.
          const lx = (x - inset) / (1 - 2 * inset);
          const ly = (y - inset) / (1 - 2 * inset);
          if (inPolygon(lx, ly, M)) letter++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const mix = square === 0 ? 0 : letter / square;
      const at = row + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[at + c] = Math.round(ACCENT[c] + (WHITE[c] - ACCENT[c]) * mix);
      raw[at + 3] = Math.round((square / total) * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const out = new URL(`../icons/icon${size}.png`, import.meta.url);
  writeFileSync(out, png(size));
  console.log(`icon${size}.png`);
}
