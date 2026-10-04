// A/B: bandingkan klasifikasi kategori & klasifikasi umum antar model Gemini.
//
// Dipakai untuk keputusan biaya-vs-akurasi di hot path: 1 panggilan per pesan
// user, jadi setiap selisih akurasi kategori berarti budget salah dan alert bocor
// yang tidak pernah menyala.
//
//   npx tsx --env-file=.env.local scripts/verify/ai-model-ab.mts
import { parseTransactionsFromText } from "../../lib/ai/gemini-text.ts";

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"];

// Kasus yang memisahkan model: dua kategori berdekatan (belanja vs makan
// di luar), penyambungan kalimat, dan pesan yang bukan transaksi.
const CASES: Array<{ input: string; cats: string[]; want?: string }> = [
  {
    input: "beli pastel 5rb",
    cats: ["Dapur", "Makan", "Transport", "Leisure", "Tagihan", "Lainnya"],
    want: "Makan",
  },
  {
    input: "makan siang nasi goreng 25rb",
    cats: ["Dapur", "Jajan", "Transport", "Lainnya"],
    want: "Jajan",
  },
  {
    input: "bensin 35rb sama parkir 2rb",
    cats: ["Dapur", "Makan", "Transport", "Lainnya"],
    want: "Transport",
  },
  {
    input: "beli IPI 300rb",
    cats: ["Dapur", "Tagihan", "Lainnya"],
    want: "Tagihan",
  },
  {
    input: "kopi susu 15rb",
    cats: ["Dapur", "Jajan", "Tagihan", "Lainnya"],
    want: "Jajan",
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(model: string, input: string, cats: string[]) {
  process.env.GEMINI_MODEL = model;
  return parseTransactionsFromText(input, cats);
}

const score: Record<string, { pass: number; notes: string[] }> = {};

for (const model of MODELS) {
  score[model] = { pass: 0, notes: [] };
  console.log(`\n=== ${model} ===`);

  for (const c of CASES) {
    let out = "?";
    try {
      const r = await ask(model, c.input, c.cats);
      if (!r.financial) {
        out = "financial=false";
      } else if ("question" in r) {
        out = "question";
      } else if (r.items.length === 0) {
        out = "(kosong)";
      } else {
        out = r.items.map((i) => `${i.item_name}|${i.category}`).join(", ");
      }
    } catch (err) {
      out = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    const gotOk = c.want ? out.includes(`|${c.want}`) : true;
    if (gotOk) score[model].pass++;
    const mark = gotOk ? "ok  " : "Salah";
    console.log(`  ${mark} "${c.input}" -> ${out}`);
    score[model].notes.push(`${mark} ${out}`);
    await sleep(12_000);
  }
}

console.log("\n=== RINGKASAN ===");
for (const model of MODELS) {
  console.log(`  ${model}: ${score[model].pass}/${CASES.length} benar`);
}