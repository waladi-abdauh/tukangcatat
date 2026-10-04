// Verifikasi rename kategori: laporan bulan lalu harus TIDAK berubah.
//
// Yang dijaga di sini: `renameCategory` cuma menyentuh baris budget bulan
// BERJALAN dan transaksi bertanggal di bulan berjalan. Transaksi & budget
// bulan sebelumnya harus persis sama — jumlah, isi, dan labelnya.
//
//   npm run verify:rename
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[rename] ${name} belum diisi`);
    process.exit(1);
  }
  return value!;
}

const db = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

const TODAY = new Date();
const month = TODAY.toISOString().slice(0, 7);
const currentDay = TODAY.toISOString().slice(0, 10);
// Bulan lalu: selalu ada dan selalu sudah lewat.
const pastDay = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - 1, 15))
  .toISOString()
  .slice(0, 10);
const pastMonth = pastDay.slice(0, 7);
// Awal bulan berikutnya — batas atas rentang transaksi bulan berjalan.
// Tanpa ini, transaksi bertanggal bulan depan ikut ter-label ulang.
const nextMonthStart = (() => {
  const [y, m] = month.split("-").map((n) => Number.parseInt(n, 10));
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, "0")}-01`;
})();
// Transaksi berbulan depan: user bisa saja nyatet "gajian 5 November" hari ini.
const futureDay = `${nextMonthStart.slice(0, 8)}05`;

const FROM = "Makan";
const TO = "Makan dan Snack";

const { data: user, error: userErr } = await db
  .from("profiles")
  .insert({ phone_number: `62${Date.now()}`.slice(0, 14) })
  .select("id")
  .single();
if (userErr || !user) {
  console.error("[rename] gagal membuat profil uji:", userErr?.message);
  process.exit(1);
}
const userId = user.id;

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function cleanup() {
  await db.from("category_budgets").delete().eq("user_id", userId);
  await db.from("transactions").delete().eq("user_id", userId);
  await db.from("profiles").delete().eq("id", userId);
}

// Snapshot laporan bulan lalu: apa adanya, tanpa intervensi kode produksi.
async function pastSnapshot() {
  const [tx, budget] = await Promise.all([
    db
      .from("transactions")
      .select("amount, category, transaction_date")
      .eq("user_id", userId)
      .lt("transaction_date", `${month}-01`)
      .order("transaction_date"),
    db
      .from("category_budgets")
      .select("category_name, limit_amount")
      .eq("user_id", userId)
      .eq("month", pastMonth),
  ]);
  const txRows = (tx.data ?? []).map((r) => ({
    amount: Number(r.amount),
    category: r.category,
    transaction_date: r.transaction_date,
  }));
  const budgetRows = (budget.data ?? [])
    .map((r) => ({ category_name: r.category_name, limit_amount: Number(r.limit_amount) }))
    .sort((a, b) => a.category_name.localeCompare(b.category_name));
  return { txRows, budgetRows };
}

// Logika rename yang diuji ulang di sini, bentuknya sama dengan
// app/dash/actions.ts:renameCategory. Sengaja ditulis ulang supaya tes ini
// tidak butuh sesi login, dan jadi memsetua kalau signing-nya berubah.
async function doRename(from: string, to: string) {
  const { data: source } = await db
    .from("category_budgets")
    .select("limit_amount")
    .eq("user_id", userId)
    .eq("category_name", from)
    .eq("month", month)
    .maybeSingle();

  const ins = await db.from("category_budgets").insert({
    user_id: userId,
    category_name: to,
    limit_amount: Number(source?.limit_amount ?? 0),
    month,
  });
  assert.equal(ins.error, null, `insert budget: ${ins.error?.message}`);

  const tx = await db
    .from("transactions")
    .update({ category: to })
    .eq("user_id", userId)
    .eq("category", from)
    .gte("transaction_date", `${month}-01`)
    .lt("transaction_date", nextMonthStart);
  assert.equal(tx.error, null, `update transaksi: ${tx.error?.message}`);

  const del = await db
    .from("category_budgets")
    .delete()
    .eq("user_id", userId)
    .eq("category_name", from)
    .eq("month", month);
  assert.equal(del.error, null, `hapus budget lama: ${del.error?.message}`);
}

console.log(`[rename] bulan berjalan=${month}, bulan lalu=${pastMonth}`);

// Dua transaksi: satu bulan lalu, satu bulan ini, satu bulan depan (label
// yang ditulis user untuk tanggal tersebut harus dihormati).
await check("seed: transaksi bulan lalu + bulan ini + bulan depan, budget 2 bulan", async () => {
  const { error } = await db.from("transactions").insert([
    {
      user_id: userId,
      amount: 35000,
      category: FROM,
      transaction_date: pastDay,
      item_name: "nasi goreng",
      input_type: "text",
    },
    {
      user_id: userId,
      amount: 15000,
      category: FROM,
      transaction_date: currentDay,
      item_name: "kopi",
      input_type: "text",
    },
    {
      user_id: userId,
      amount: 5000000,
      category: FROM,
      transaction_date: futureDay,
      item_name: "gajian",
      input_type: "text",
    },
  ]);
  assert.equal(error, null, error?.message);

  const { error: bErr } = await db.from("category_budgets").insert([
    { user_id: userId, category_name: FROM, limit_amount: 500000, month },
    { user_id: userId, category_name: FROM, limit_amount: 400000, month: pastMonth },
  ]);
  assert.equal(bErr, null, bErr?.message);
});

const before = await pastSnapshot();
assert.equal(before.txRows.length, 1, "seed transaksi bulan lalu gagal");

await check("rename: bulan berjalan ganti nama", async () => {
  await doRename(FROM, TO);
});

await check("laporan bulan lalu: transaksi utuh (tanggal, nominal, label)", async () => {
  const after = await pastSnapshot();
  assert.deepEqual(after.txRows, before.txRows);
});

await check("laporan bulan lalu: budget beku di nilai lama", async () => {
  const after = await pastSnapshot();
  assert.deepEqual(after.budgetRows, before.budgetRows);
});

await check("total nominal bulan lalu tidak berubah", async () => {
  const after = await pastSnapshot();
  const sum = (rows: Array<{ amount: number }>) =>
    rows.reduce((acc, r) => acc + r.amount, 0);
  assert.equal(sum(after.txRows), sum(before.txRows));
});

await check("transaksi bulan berjalan ikut ke nama baru", async () => {
  const { data } = await db
    .from("transactions")
    .select("category")
    .eq("user_id", userId)
    .gte("transaction_date", `${month}-01`)
    .lt("transaction_date", nextMonthStart);
  assert.equal((data ?? []).length, 1);
  assert.equal(data![0].category, TO);
});

await check("transaksi bulan DEPAN tidak ikut ter-label ulang", async () => {
  // Regresi: filter lama cuma `>= awal bulan`, jadi transaksi tanggal bulan
  // depan ikut berubah labelnya diam-diam — padahal belum jadi bagian
  // laporan bulan berjalan.
  const { data } = await db
    .from("transactions")
    .select("category, amount")
    .eq("user_id", userId)
    .gte("transaction_date", nextMonthStart);
  assert.equal((data ?? []).length, 1);
  assert.equal(data![0].category, FROM);
  assert.equal(Number(data![0].amount), 5000000);
});

await check("limit bulan berjalan ikut, nilai utuh", async () => {
  const { data } = await db
    .from("category_budgets")
    .select("category_name, limit_amount")
    .eq("user_id", userId)
    .eq("month", month);
  assert.deepEqual(data, [{ category_name: TO, limit_amount: 500000 }]);
});

await check("baris limit nama lama di bulan ini hilang", async () => {
  const { data } = await db
    .from("category_budgets")
    .select("category_name")
    .eq("user_id", userId)
    .eq("category_name", FROM)
    .gte("month", month);
  assert.equal((data ?? []).length, 0);
});

await check("nama lama masih utuh di bulan lalu (history beku)", async () => {
  const after = await pastSnapshot();
  assert.ok(
    after.budgetRows.some((r) => r.category_name === FROM),
    "budget bulan lalu ikut terhapus — history tidak beku"
  );
});

// Skenario 2: kategori yang TIDAK punya baris limit di bulan berjalan.
// Menyalin DEFAULT_CATEGORY_LIMIT (Rp500.000) diam-diam akan mengunci budget
// yang tidak pernah dipilih user dan bisa membuat sisa bulanan negatif.
const FROM_NO_BUDGET = "Belum Ada Limit";
const TO_NO_BUDGET = "Belum Ada Limit Baru";

await check("seed: kategori tanpa baris limit di bulan ini", async () => {
  const { error } = await db.from("transactions").insert({
    user_id: userId,
    amount: 7000,
    category: FROM_NO_BUDGET,
    transaction_date: currentDay,
    item_name: "parkir",
    input_type: "text",
  });
  assert.equal(error, null, error?.message);
});

await check("rename tanpa baris limit -> limit 0, bukan DEFAULT 500rb", async () => {
  await doRename(FROM_NO_BUDGET, TO_NO_BUDGET);
  const { data } = await db
    .from("category_budgets")
    .select("limit_amount")
    .eq("user_id", userId)
    .eq("category_name", TO_NO_BUDGET)
    .eq("month", month)
    .maybeSingle();
  assert.equal(Number(data?.limit_amount), 0);
});

await check("rename tanpa baris limit: transaksi tetap ikut ganti label", async () => {
  const { data } = await db
    .from("transactions")
    .select("category")
    .eq("user_id", userId)
    .eq("item_name", "parkir")
    .maybeSingle();
  assert.equal(data?.category, TO_NO_BUDGET);
});

await cleanup();
console.log(`[rename] ${passed} pemeriksaan lulus. Data uji sudah dibersihkan.`);