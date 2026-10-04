// Tes resolusi budget per periode (carryover + fallback + pembekuan).
// Memakai bulan-bulan JAUH di luar jendela 12 bulan selector supaya tidak
// menyentuh data asli user; baris tes dibersihkan di akhir.
//
// PRASYARAT: migrasi SQL budget per-bulan sudah dijalankan di Supabase.
// Jalankan: npx tsx --env-file=.env.local scripts/verify/budget-periods.mts
import assert from "node:assert/strict";
import { serviceRoleClient } from "../../lib/supabase/service-role.ts";
import {
  currentMonthKey,
  resolveMonthlyBudget,
  resolveCategoryBudgets,
} from "../../lib/dash/budgets.ts";

// Nomor profil uji — dibaca dari DEV_TEST_PHONE (tidak ada nomor pribadi
// yang disimpan di repo ini).
const PHONE = process.env.DEV_TEST_PHONE;
if (!PHONE) {
  console.error("DEV_TEST_PHONE belum diisi di .env.local");
  process.exit(1);
}
const TEST_CATEGORY = "TesKategoriPeriods";

// Geser kunci bulan 'YYYY-MM' sebanyak delta bulan.
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL kosong");
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY kosong");

  const { data: profile } = await serviceRoleClient
    .from("profiles")
    .select("id")
    .eq("phone_number", PHONE)
    .maybeSingle();
  assert.ok(profile, `profil ${PHONE} tidak ditemukan — kirim chat apa pun ke bot dulu`);
  const userId = profile.id;

  // Bulan tes: -18 (M2, lebih tua) dan -17 (M1, lebih baru) — di luar jendela
  // 12 bulan; M_BETWEEN (-16) dipakai untuk menguji warisan (carryover).
  const current = currentMonthKey();
  const M2 = shiftMonth(current, -18);
  const M1 = shiftMonth(current, -17);
  const M_BETWEEN = shiftMonth(current, -16);

  // Bersihkan sisa tes lama (jika ada).
  await serviceRoleClient
    .from("monthly_budgets")
    .delete()
    .eq("user_id", userId)
    .in("month", [M1, M2]);
  await serviceRoleClient
    .from("category_budgets")
    .delete()
    .eq("user_id", userId)
    .eq("category_name", TEST_CATEGORY);

  try {
    // Baseline: nilai bulan pra-fitur = fallback nilai terbaru (tidak explicit).
    const before = await resolveMonthlyBudget(userId, M2);
    assert.equal(before.explicit, false, "bulan pra-fitur tidak boleh explicit");

    // Tanam nilai berbeda per periode (error insert wajib menggagalkan tes,
    // jangan ditelan diam-diam).
    const insMb = await serviceRoleClient.from("monthly_budgets").insert([
      { user_id: userId, month: M2, amount: 2_000_000 },
      { user_id: userId, month: M1, amount: 1_000_000 },
    ]);
    assert.equal(insMb.error, null, `insert monthly_budgets gagal: ${insMb.error?.message ?? "?"}`);
    const insCb = await serviceRoleClient.from("category_budgets").insert([
      { user_id: userId, category_name: TEST_CATEGORY, limit_amount: 300_000, month: M2 },
      { user_id: userId, category_name: TEST_CATEGORY, limit_amount: 500_000, month: M1 },
    ]);
    assert.equal(insCb.error, null, `insert category_budgets gagal: ${insCb.error?.message ?? "?"}`);

    // 1) Baris bulan itu dipakai persis (pembekuan sejarah).
    const rM1 = await resolveMonthlyBudget(userId, M1);
    assert.equal(rM1.amount, 1_000_000, `M1 harus 1jt (dapat ${rM1.amount})`);
    assert.equal(rM1.explicit, true);
    const rM2 = await resolveMonthlyBudget(userId, M2);
    assert.equal(rM2.amount, 2_000_000, `M2 harus 2jt (dapat ${rM2.amount})`);
    assert.equal(rM2.explicit, true);

    // 2) Bulan tanpa baris mewarisi nilai terbaru sebelumnya (carryover).
    const rBetween = await resolveMonthlyBudget(userId, M_BETWEEN);
    assert.equal(
      rBetween.amount,
      1_000_000,
      `bulan kosong harus waris 1jt dari M1 (dapat ${rBetween.amount})`
    );
    assert.equal(rBetween.explicit, false);

    // 3) Bulan berjalan tidak terpengaruh baris tes.
    const rNow = await resolveMonthlyBudget(userId, current);
    assert.equal(rNow.amount, before.amount, "bulan berjalan berubah oleh tes!");

    // 4) Set kategori per bulan mengikuti zamannya masing-masing.
    const cM1 = await resolveCategoryBudgets(userId, M1);
    const tesM1 = cM1.find((c) => c.category_name === TEST_CATEGORY);
    assert.equal(tesM1?.limit_amount, 500_000, `kategori M1 harus 500rb (dapat ${tesM1?.limit_amount})`);
    const cM2 = await resolveCategoryBudgets(userId, M2);
    const tesM2 = cM2.find((c) => c.category_name === TEST_CATEGORY);
    assert.equal(tesM2?.limit_amount, 300_000, `kategori M2 harus 300rb (dapat ${tesM2?.limit_amount})`);
    const cBetween = await resolveCategoryBudgets(userId, M_BETWEEN);
    const tesBetween = cBetween.find((c) => c.category_name === TEST_CATEGORY);
    assert.equal(
      tesBetween?.limit_amount,
      500_000,
      `kategori bulan kosong harus waris set M1 (dapat ${tesBetween?.limit_amount})`
    );

    // 5) Set bulan berjalan tidak tercemar kategori tes.
    const cNow = await resolveCategoryBudgets(userId, current);
    assert.ok(
      !cNow.some((c) => c.category_name === TEST_CATEGORY),
      "kategori tes bocor ke set bulan berjalan!"
    );

    console.log("PASS 1: baris bulan itu dipakai persis (pembekuan sejarah)");
    console.log("PASS 2: bulan kosong mewarisi nilai terbaru sebelumnya (carryover)");
    console.log("PASS 3: bulan berjalan tidak terpengaruh");
    console.log("PASS 4: set kategori per bulan mengikuti zamannya");
    console.log("PASS 5: isolasi — kategori tes tidak bocor");
    console.log("\nBUDGET PER-PERIODE OK.");
  } finally {
    // Bersihkan baris tes.
    await serviceRoleClient
      .from("monthly_budgets")
      .delete()
      .eq("user_id", userId)
      .in("month", [M1, M2]);
    await serviceRoleClient
      .from("category_budgets")
      .delete()
      .eq("user_id", userId)
      .eq("category_name", TEST_CATEGORY);
    console.log("bersih: baris tes dihapus.");
  }
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});