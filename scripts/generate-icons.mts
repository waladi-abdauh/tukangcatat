// Generate ikon PWA CepatCatat (192 & 512 px) tanpa dependency gambar.
// Ikon: gradasi hijau + petir putih (sesuai brand). Pakai PNG encoder kecil
// berbasis zlib bawaan Node supaya bisa dijalankan offline.
//
// Jalankan: npx tsx scripts/generate-icons.mts
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// Bentuk petir (path ikon zap lucide dalam kotak 24x24), dinormalisasi jadi 0..1.
const BOLT_RAW: Array<[number, number]> = [
  [13, 2],
  [3, 14],
  [10, 14],
  [9, 22],
  [19, 10],
  [12, 10],
  [13, 4],
];
const CX = BOLT_RAW.reduce((a, p) => a + p[0], 0) / BOLT_RAW.length / 24;
const CY = BOLT_RAW.reduce((a, p) => a + p[1], 0) / BOLT_RAW.length / 24;
// Perkecil sedikit agar aman di zona lingkaran adaptif (maskable).
const SCALE = 0.82;
const BOLT: Array<[number, number]> = BOLT_RAW.map(([x, y]) => [
  CX + (x / 24 - CX) * SCALE,
  CY + (y / 24 - CY) * SCALE,
]);

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const TOP = hexToRgb("#34d399");
const BOTTOM = hexToRgb("#0d9488");

// Ray-casting point-in-polygon (sumbu y menghadap ke bawah).
function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function render(size: number): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  const denom = Math.max(size - 1, 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * denom); // gradasi diagonal kiri-atas -> kanan-bawah
      const r = TOP[0] + (BOTTOM[0] - TOP[0]) * t;
      const g = TOP[1] + (BOTTOM[1] - TOP[1]) * t;
      const b = TOP[2] + (BOTTOM[2] - TOP[2]) * t;
      const inBolt = pointInPolygon(x / size, y / size, BOLT);
      const i = (y * size + x) * 4;
      rgba[i] = inBolt ? 255 : Math.round(r);
      rgba[i + 1] = inBolt ? 255 : Math.round(g);
      rgba[i + 2] = inBolt ? 255 : Math.round(b);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// ===== PNG encoder minimal (RGBA, filter 0) =====
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const png = encodePng(size, size, render(size));
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`[icons] ${file} (${png.length} bytes)`);
}