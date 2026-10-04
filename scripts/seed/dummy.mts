// Seed dummy data untuk tes dashboard (DEV ONLY).
// Mengisi profile + transaksi + category_budgets untuk nomor test,
// lalu mencetak magic link login /dash?token=<magic>.
//
// CATATAN: data transaksi & budget milik nomor ini DIHAPUS diganti di tiap run,
// supaya hasil deterministic. Jangan dipakai di environment produksi.
//
// Jalankan: npx tsx --env-file=.env.local scripts/seed/dummy.mts
import assert from "node:assert/strict";
import { serviceRoleClient } from "../../lib/supabase/service-role.ts";
import { createMagicToken } from "../../lib/security/jwt-token.ts";
import { todayID } from "../../lib/utils.ts";
import { currentMonthKey } from "../../lib/dash/budgets.ts";

// Nomor pengguna test — dibaca dari DEV_TEST_PHONE supaya tidak ada nomor
// pribadi yang tersimpan di repo ini. WAJIB bukan nomor bot: script ini
// MENGHAPUS semua transaksi & budget nomor tersebut tiap run.
const PHONE = process.env.DEV_TEST_PHONE;
if (!PHONE) {
  console.error("DEV_TEST_PHONE belum diisi di .env.local");
  process.exit(1);
}
if (PHONE === process.env.WA_DEVICE_NUMBER) {
  console.error("DEV_TEST_PHONE tidak boleh sama dengan WA_DEVICE_NUMBER (itu nomor bot!)");
  process.exit(1);
}
const FULL_NAME = "Budi Test";
const MONTHLY_BUDGET = 5_000_000;

// Limit per kategori — mensimulasikan SEMUA kondisi status:
//   BOCOR     (>100%) Hiburan 160%
//   MENDEKATI (80-99%) Makan 95%, Transport 84%
//   AMAN      (<80%)   Belanja, Tagihan, Kesehatan
//   Tanpa transaksi:   Lainnya (limit dipasang, tidak terpakai -> tidak di-alert)
//   Transaksi tanpa limit: Snack (muncul di pie, tidak pernah di-alert)
const BUDGETS: Array<[string, number]> = [
  ["Makan", 1_200_000],
  ["Transport", 600_000],
  ["Belanja", 900_000],
  ["Tagihan", 1_500_000],
  ["Kesehatan", 500_000],
  ["Hiburan", 200_000],
  ["Lainnya", 300_000],
];

// Transaksi bulan berjalan: [kategori, deskripsi, nominal, daysAgo].
// Total ~Rp3.128.000 dari budget 5jt (62%) -> bar overall aman,
// Makan 95% & Transport 84% (Mendekati), Hiburan 160% (Bocor).
const TRANSACTIONS: Array<[string, string, number, number]> = [
  ["Makan", "Stok dapur mingguan (sayur+protein)", 850_000, 2],
  ["Makan", "Seblak + es teh", 35_000, 0],
  ["Makan", "Nasi padang ayam", 45_000, 1],
  ["Makan", "Kopi susu gula aren", 28_000, 4],
  ["Makan", "Ayam geprek + es", 40_000, 6],
  ["Makan", "Bakso sapi + es teh", 38_000, 9],
  ["Makan", "Pecel lele komplit", 42_000, 11],
  ["Makan", "Sarapan roti + susu", 25_000, 13],
  ["Makan", "Nasi uduk + telur", 35_000, 15],
  ["Transport", "Bensin 5L", 100_000, 0],
  ["Transport", "Ganti oli mesin", 180_000, 3],
  ["Transport", "Tol + parkir", 75_000, 8],
  ["Transport", "Gojek pulang kantor", 150_000, 12],
  ["Belanja", "Kaos senam", 150_000, 5],
  ["Belanja", "Skincare pembersih", 100_000, 10],
  ["Tagihan", "Listrik PLN", 550_000, 6],
  ["Tagihan", "Wifi rumah", 230_000, 10],
  ["Kesehatan", "Obat + vitamin", 120_000, 7],
  ["Hiburan", "Nonton bioskop 2 tiket", 180_000, 5],
  ["Hiburan", "Grab ke mall + jajan", 140_000, 9],
  ["Snack", "Cemilan sore di kantin", 15_000, 2],
];

// Tanggal WIB n-hari yang lalu, dibatasi agar tidak keluar bulan berjalan.
function wibDateDaysAgo(daysAgo: number): string {
  const today = todayID();
  const monthStart = `${today.slice(0, 8)}01`;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  const asString = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(date);
  return asString < monthStart ? monthStart : asString;
}

async function main() {
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL kosong");
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY kosong");
  assert.ok(process.env.JWT_SECRET_KEY, "JWT_SECRET_KEY kosong");

  // 1) Upsert profile (sekaligus memastikan trigger referral code jalan).
  const { data: profile, error: upsertError } = await serviceRoleClient
    .from("profiles")
    .upsert(
      {
        phone_number: PHONE,
        full_name: FULL_NAME,
      },
      { onConflict: "phone_number" }
    )
    .select("id, full_name, referral_code")
    .single();
  assert.equal(upsertError, null, `upsert profile: ${upsertError?.message ?? "?"}`);
  const userId = profile!.id;
  console.log(`PASS profile ${PHONE} (${profile!.full_name}) budget Rp${MONTHLY_BUDGET.toLocaleString("id-ID")}`);

  // 2) Bersihkan data lama user ini, lalu tanam data dummy.
  const { error: delTx } = await serviceRoleClient
    .from("transactions")
    .delete()
    .eq("user_id", userId);
  const { error: delBudget } = await serviceRoleClient
    .from("category_budgets")
    .delete()
    .eq("user_id", userId);
  const { error: delMonthly } = await serviceRoleClient
    .from("monthly_budgets")
    .delete()
    .eq("user_id", userId);
  assert.equal(delTx, null, `hapus transaksi lama: ${delTx?.message ?? "?"}`);
  assert.equal(delBudget, null, `hapus budget lama: ${delBudget?.message ?? "?"}`);
  assert.equal(delMonthly, null, `hapus monthly budget lama: ${delMonthly?.message ?? "?"}`);

  // Budget total bulan berjalan (model per-periode).
  const { error: insMonthly } = await serviceRoleClient.from("monthly_budgets").upsert(
    { user_id: userId, month: currentMonthKey(), amount: MONTHLY_BUDGET },
    { onConflict: "user_id,month" }
  );
  assert.equal(insMonthly, null, `insert monthly budget: ${insMonthly?.message ?? "?"}`);

  const { error: insBudget } = await serviceRoleClient.from("category_budgets").insert(
    BUDGETS.map(([category_name, limit_amount]) => ({
      user_id: userId,
      category_name,
      limit_amount,
      month: currentMonthKey(),
    }))
  );
  assert.equal(insBudget, null, `insert budgets: ${insBudget?.message ?? "?"}`);

  const now = Date.now();
  const { data: txRows, error: insTx } = await serviceRoleClient
    .from("transactions")
    .insert(
      TRANSACTIONS.map(([category, item_name, amount, daysAgo], index) => ({
        user_id: userId,
        category,
        item_name,
        amount,
        input_type: "text" as const,
        transaction_date: wibDateDaysAgo(daysAgo),
        created_at: new Date(now - daysAgo * 86_400_000 - index).toISOString(),
      }))
    )
    .select("category, amount");

  assert.equal(insTx, null, `insert transactions: ${insTx?.message ?? "?"}`);

  // 3) Ringkasan + magic link login.
  const byCategory = new Map<string, number>();
  for (const row of txRows ?? []) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + Number(row.amount));
  }
  console.log(`PASS ${(txRows ?? []).length} transaksi, ${BUDGETS.length} budget kategori`);
  for (const [cat, total] of byCategory) {
    const limit = BUDGETS.find(([name]) => name === cat)?.[1] ?? 0;
    const ratio = limit > 0 ? total / limit : 0;
    const pct = limit > 0 ? (ratio * 100).toFixed(0) : "n/a";
    const status =
      limit === 0 ? "tanpa limit" : ratio >= 1 ? "BOCOR" : ratio >= 0.8 ? "mendekati" : "aman";
    console.log(
      `  ${cat.padEnd(10)} Rp${Number(total).toLocaleString("id-ID")}  (${pct}% dari limit) [${status}]`
    );
  }

  const token = await createMagicToken(PHONE!);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log("\nMagic link login (berlaku 15 menit):");
  console.log(`  LOCAL : http://localhost:3000/dash?token=${token}`);
  if (base !== "http://localhost:3000") console.log(`  PUBLIC: ${base}/dash?token=${token}`);
}

main().catch((err) => {
  console.error("GAGAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});