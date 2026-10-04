// Uji flakiness pada kasus kategori yang "abu-abu".
//
// Kenapa perlu: percobaan A/B sekali saja (scripts/verify/ai-model-ab.mts)
// memberi hasil yang bertentangan antar eksekusi untuk input yang sama, jadi
// perbedaan "akurasi" model bisa jadi noise sampling, bukan kemampuan.
// Kasus ini mengulang input sama beberapa kali per model untuk mengukur
// tingkat konsistensi — hal yang jauh lebih menentukan daripada 1 sampel.
//
//   npx tsx --env-file=.env.local scripts/verify/ai-flakiness.mts
import { parseTransactionsFromText } from "../../lib/ai/gemini-text.ts";

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"];
const RUNS = 4;

type Case = { input: string; cats: string[]; acceptable: string[]; label: string };

const CASES: Case[] = [
  {
    label: "nasi goreng (makan luar vs belanja)",
    input: "makan siang nasi goreng 25rb",
    cats: ["Dapur", "Jajan", "Transport", "Lainnya"],
    // Dua-duanya masuk akal secara budget; yang penting tidak "Lainnya".
    acceptable: ["Jajan", "Makan"],
  },
  {
    label: "kopi (kategori makan spesifik)",
    input: "kopi susu 15rb",
    cats: ["Dapur", "Jajan", "Tagihan", "Lainnya"],
    acceptable: ["Jajan", "Makan"],
  },
  {
    label: "parkir (kategori jelas)",
    input: "parkir 2rb",
    cats: ["Dapur", "Jajan", "Transport", "Lainnya"],
    acceptable: ["Transport"],
  },
  {
    label: "pulsa (kategori tagihan)",
    input: "beli pulsa 50rb",
    cats: ["Dapur", "Makan", "Tagihan", "Lainnya"],
    acceptable: ["Tagihan", "Lainnya"],
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tally: Record<string, Record<string, { right: number; wrong: number }>> = {};

for (const model of MODELS) {
  tally[model] = {};
  for (const c of CASES) tally[model][c.label] = { right: 0, wrong: 0 };
}

for (const model of MODELS) {
  process.env.GEMINI_MODEL = model;
  console.log(`\n=== ${model} (${RUNS} run/case) ===`);

  for (const c of CASES) {
    const seen: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      let got = "ERROR";
      try {
        const r = await parseTransactionsFromText(c.input, c.cats);
        if (!r.financial) got = "financial=false";
        else if ("question" in r) got = "question";
        else if (r.items.length === 0) got = "(kosong)";
        else got = r.items[0].category;
      } catch (err) {
        got = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
      seen.push(got);
      if (c.acceptable.includes(got)) tally[model][c.label].right++;
      else tally[model][c.label].wrong++;
      await sleep(11_000);
    }
    const stable = new Set(seen).size === 1;
    console.log(
      `  ${stable ? "stabil " : "Berubah"} ${c.label}: ${seen.join(" -> ")}`
    );
  }
}

console.log("\n=== KONSISTENSI ===");
for (const model of MODELS) {
  let right = 0;
  let wrong = 0;
  for (const c of CASES) {
    right += tally[model][c.label].right;
    wrong += tally[model][c.label].wrong;
  }
  const total = right + wrong;
  console.log(
    `  ${model}: ${right}/${total} masuk kategori yang bisa diterima ` +
      `(${(100 * right / total).toFixed(0)}%)`
  );
  for (const c of CASES) {
    const t = tally[model][c.label];
    console.log(`      ${c.label}: ${t.right} benar / ${t.wrong} salah`);
  }
}