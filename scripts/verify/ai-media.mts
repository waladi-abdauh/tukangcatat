// Smoke test media: verifikasi wrapper gemini-voice & gemini-vision end-to-end.
// Media sintetis (PNG polos & WAV senyap) cukup membuktikan jalur buffer->base64->Gemini->schema.
// Jalankan: npx tsx --env-file=.env.local scripts/verify/ai-media.mts
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { parseTransactionsFromImage } from "../../lib/ai/gemini-vision.ts";
import { parseTransactionsFromVoice } from "../../lib/ai/gemini-voice.ts";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= retries || !/429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|quota/i.test(msg)) {
        throw err;
      }
      console.log(`  retry (${attempt + 1}/${retries}) utk ${msg.slice(0, 60)}...`);
      await sleep(12_000 * (attempt + 1));
    }
  }
}

// ---------- PNG minimal (8x8, warna solid, tanpa teks) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makeBlankPNG(): Buffer {
  const w = 8,
    h = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0); // filter: none
    for (let x = 0; x < w; x++) {
      rows.push(30 + x * 20, 90 + y * 20, 180); // gradasi "foto" bukan struk
    }
  }
  const idat = zlib.deflateSync(Buffer.from(rows));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- WAV PCM 16-bit mono 8kHz, senyap 0.25 detik ----------
function makeSilenceWAV(seconds = 0.25): Buffer {
  const rate = 8000,
    samples = Math.floor(rate * seconds);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf; // sisanya nol (senyap)
}

function expectShape(result: { financial: boolean; items?: unknown[] }) {
  assert.equal(typeof result.financial, "boolean", "financial harus boolean");
  if (result.financial) {
    assert.ok(Array.isArray(result.items), "items harus array saat financial");
  }
}

async function main() {
  const png = makeBlankPNG();
  const wav = makeSilenceWAV();
  assert.ok(png.length > 40 && wav.length > 44, "media sintetis gagal dibuat");

  // Daftar kategori dummy meniru kategori user di dashboard.
  const categories = ["Dapur", "Makan", "Transport", "Leisure", "Tagihan", "Lainnya"];

  const img = await withRetry(() => parseTransactionsFromImage(png, "image/png", categories));
  expectShape(img);
  console.log(`PASS vision wrapper -> financial=${img.financial}${img.financial && "items" in img ? ` items=${img.items.length}` : " (bukan struk)"}`);
  await sleep(12_000);

  const audio = await withRetry(() => parseTransactionsFromVoice(wav, "audio/wav", categories));
  expectShape(audio);
  console.log(`PASS voice wrapper -> financial=${audio.financial}${audio.financial && "items" in audio ? ` items=${audio.items.length}` : " (tidak ada transaksi)"}`);

  console.log("\nAI-MEDIA OK: wrapper voice & vision end-to-end (buffer->base64->Gemini->zod).");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});