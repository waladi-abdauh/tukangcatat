// Smoke test Step 4: runtime parse teks via Gemini (API key live) + zod.
// Jalankan: node --env-file=.env.local scripts/verify/ai.mts
import assert from "node:assert/strict";
import { parseTransactionsFromText, type FinancialResult } from "../../lib/ai/gemini-text.ts";
import type { ParsedTransactions } from "../../lib/security/sanitization.ts";

// Daftar kategori dummy meniru kategori user di dashboard.
const CATEGORIES = ["Dapur", "Makan", "Transport", "Leisure", "Tagihan", "Lainnya"];

// Type guard: hasil finansial harus varian items (transactions), bukan question.
function asItems(result: FinancialResult): ParsedTransactions {
  if (!("items" in result)) {
    assert.fail(`harus varian items (transactions), dapat: ${JSON.stringify(result)}`);
  }
  return result.items;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry untuk 429 (quota) & 503 (overload) yang bersifat sementara.
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 4,
  delayMs = 15_000
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= retries || !/429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|quota/i.test(msg)) {
        throw err;
      }
      console.log(`  retry (${attempt + 1}/${retries}) untuk ${msg.trim().slice(0, 70)}...`);
      await sleep(delayMs * (attempt + 1));
    }
  }
}

async function main() {
  const cases: Array<[string, number]> = [
    ["Bensin 35rb sama parkir 2rb", 2],
    ["telkom 200 ribu dan indosat 30rb", 2],
    ["gajian bukan pengeluaran, catat makan siang 25 ribu", 1],
  ];
  // Free tier Gemini: 5 request/menit/model -> beri jeda antar pemanggilan.
  const INTERVAL_MS = 12_000;

  for (const [input, expectedCount] of cases) {
    const result = await withRetry(() => parseTransactionsFromText(input, CATEGORIES));
    assert.equal(result.financial, true, `harus terklasifikasi finansial: ${input}`);
    const txs = asItems(result);
    assert.equal(
      txs.length,
      expectedCount,
      `jumlah item tidak sesuai utk "${input}" (dapat ${txs.length})`
    );
    for (const tx of txs) {
      assert.equal(typeof tx.item_name, "string");
      assert.ok(tx.item_name.length > 0, "item_name kosong");
      assert.equal(typeof tx.amount, "number");
      assert.ok(tx.amount > 0, `amount <= 0: ${tx.amount}`);
      assert.equal(typeof tx.category, "string");
      assert.ok(tx.category.length > 0, "category kosong");
      console.log(
        `  hasil: ${tx.item_name} | Rp${tx.amount} | ${tx.category}`
      );
    }
    console.log(`PASS AI parse: "${input}" -> ${txs.length} item(s)`);
    await sleep(INTERVAL_MS);
  }

  // Guardrail: pesan off-topic harus diklasifikasikan non-finansial.
  const offTopic: Array<string> = [
    "Cuaca Jakarta hari ini cerah gak?",
    "halo bot, lagi apa?",
    "Pendapat kamu soal pemilu gimana?",
    "cerita dong, lagi bingung sama kerjaan",
  ];
  for (const input of offTopic) {
    const result = await withRetry(() => parseTransactionsFromText(input, CATEGORIES));
    assert.equal(result.financial, false, `harus off-topic: "${input}"`);
    console.log(`PASS AI off-topic: "${input}" -> financial=false`);
    await sleep(INTERVAL_MS);
  }

  // Finansial tapi tanpa transaksi (harus key kosong, bukan error).
  const vague = await withRetry(() =>
    parseTransactionsFromText(
      "aku lagi mikirin cara ngatur keuangan bulan ini",
      CATEGORIES
    )
  );
  if (vague.financial) {
    const vagueItems = asItems(vague);
    console.log(`PASS AI finansial-tanpa-transaksi -> ${vagueItems.length} item(s)`);
  } else {
    console.log("PASS AI finansial-tanpa-transaksi -> diklasifikasi off-topic (aman)");
  }

  console.log("\nAI OK: Gemini key valid, klasifikasi + parser (schema + zod) bekerja.");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});