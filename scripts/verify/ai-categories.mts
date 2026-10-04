// Smoke test kategori dinamis: AI harus memilih kategori dari daftar user,
// termasuk saat daftarnya diganti-ganti (mis. "Makan" vs "Jajan").
// Jalankan: npx tsx --env-file=.env.local scripts/verify/ai-categories.mts
import assert from "node:assert/strict";
import { parseTransactionsFromText, type FinancialResult } from "../../lib/ai/gemini-text.ts";
import type { ParsedTransactions } from "../../lib/security/sanitization.ts";

// Type guard: hasil finansial harus varian items (transactions).
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
  // Free tier Gemini: beri jeda antar pemanggilan.
  const INTERVAL_MS = 12_000;

  // Kasus 1: pastel masuk kategori makanan dari daftar standar.
  const r1 = await withRetry(() =>
    parseTransactionsFromText("beli pastel 5rb", [
      "Dapur",
      "Makan",
      "Transport",
      "Leisure",
      "Tagihan",
      "Lainnya",
    ])
  );
  assert.equal(r1.financial, true, "pastel harus finansial");
  const p1 = asItems(r1);
  assert.equal(p1.length, 1, "pastel harus 1 item");
  assert.equal(p1[0].item_name, "Pastel", `item_name harus "Pastel" (dapat "${p1[0].item_name}")`);
  assert.equal(p1[0].category, "Makan", `kategori harus "Makan" (dapat "${p1[0].category}")`);
  console.log(`PASS 1: "beli pastel 5rb" -> ${p1[0].item_name} | ${p1[0].category}`);
  await sleep(INTERVAL_MS);

  // Kasus 2: user ganti kategorinya jadi "Jajan" (tanpa "Makan") -> AI ikut.
  const r2 = await withRetry(() =>
    parseTransactionsFromText("makan siang nasi goreng 25rb", [
      "Dapur",
      "Jajan",
      "Transport",
      "Lainnya",
    ])
  );
  assert.equal(r2.financial, true, "makan siang harus finansial");
  const p2 = asItems(r2);
  assert.equal(p2[0].category, "Jajan", `kategori harus "Jajan" (dapat "${p2[0].category}")`);
  console.log(`PASS 2: daftar tanpa "Makan" -> kategori "${p2[0].category}" (AI ikut daftar user)`);
  await sleep(INTERVAL_MS);

  // Kasus 3: tidak ada kategori cocok -> jatuh ke "Lainnya", bukan mengarang.
  const r3 = await withRetry(() =>
    parseTransactionsFromText("service motor 150rb", ["Dapur", "Makan", "Leisure", "Lainnya"])
  );
  assert.equal(r3.financial, true, "service motor harus finansial");
  const p3 = asItems(r3);
  assert.equal(p3[0].category, "Lainnya", `kategori harus "Lainnya" (dapat "${p3[0].category}")`);
  console.log(`PASS 3: tanpa kategori cocok -> "Lainnya" (tidak mengarang kategori baru)`);

  console.log("\nKATEGORI DINAMIS OK: AI mengikuti daftar kategori user.");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});