// Verifikasi dedupe inbound (wa_inbound_seen) & kuota parse AI (claim_ai_parse).
//
// Dua hal ini adalah pengeluaran yang "tak terlihat": tanpa dedupe, retry
// gateway menyebabkan AI parse dua kali & transaksi tercatat ganda; tanpa
// kuota AI, nomor yang disalahgunakan membakar token Gemini tanpa menghasilkan
// catatan sama sekali.
//
// Butuh migration 20260102 sudah jalan. Kalau tabel belum ada, script berhenti
// dengan pesan jelas (bukan diam-diam PASS) supaya tidak ada false confidence.
//
//   npm run verify:guards
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[guards] ${name} belum diisi`);
    process.exit(1);
  }
  return value!;
}

const db = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

const today = new Date().toISOString().slice(0, 10);
const marker = `verify-${Date.now()}`;

// User sementara; dibersihkan di akhir.
const { data: user, error: userErr } = await db
  .from("profiles")
  .insert({ phone_number: `62${Date.now()}`.slice(0, 14) })
  .select("id")
  .single();
if (userErr || !user) {
  console.error("[guards] gagal membuat profil uji:", userErr?.message);
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
  await db.from("wa_inbound_seen").delete().like("message_id", `${marker}%`);
  await db.from("ai_usage_daily").delete().eq("user_id", userId);
  await db.from("profiles").delete().eq("id", userId);
}

console.log("\n[1] Dedupe inbound (wa_inbound_seen)");

// Cek apakah migration sudah jalan; kalau belum, berhenti di sini.
{
  const { error } = await db
    .from("wa_inbound_seen")
    .insert({ message_id: `${marker}-probe` });
  if (error) {
    console.error(
      "\n[guards] TABEL BELUM ADA — jalankan supabase/migrations/20260102_wa_inbound_seen.sql di Supabase SQL Editor lebih dulu.\n         " +
        `detail: ${error.message}\n`
    );
    await cleanup();
    process.exit(1);
  }
  await db.from("wa_inbound_seen").delete().eq("message_id", `${marker}-probe`);
}

async function claim(messageId: string): Promise<boolean> {
  const { data, error } = await db
    .from("wa_inbound_seen")
    .upsert(
      { message_id: messageId },
      { onConflict: "message_id", ignoreDuplicates: true }
    )
    .select("message_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

await check("klaim pertama berhasil", async () => {
  assert.equal(await claim(`${marker}-a`), true);
});

await check("klaim ulang message_id sama ditolak (retry gateway)", async () => {
  assert.equal(await claim(`${marker}-a`), false);
});

await check("10 klaim paralel hanya 1 yang menang (race-safe)", async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => claim(`${marker}-race`))
  );
  assert.equal(
    results.filter(Boolean).length,
    1,
    `harusnya tepat 1, dapat ${results.filter(Boolean).length}`
  );
});

await check("10 retry message sama hanya menghasilkan 1 klaim", async () => {
  await claim(`${marker}-dup`);
  const retries = await Promise.all(
    Array.from({ length: 10 }, () => claim(`${marker}-dup`))
  );
  assert.equal(retries.filter(Boolean).length, 0, "retry tidak boleh klaim lagi");
});

console.log("\n[2] Kuota parse AI (claim_ai_parse)");

await check("limit 3: klaim 1-3 lulus", async () => {
  for (let i = 1; i <= 3; i++) {
    const { data, error } = await db.rpc("claim_ai_parse", {
      p_user: userId,
      p_date: today,
      p_limit: 3,
    });
    if (error) throw new Error(`RPC gagal: ${error.message}`);
    assert.equal(data, true, `klaim ke-${i} harus true`);
  }
});

await check("limit 3: klaim ke-4 ditolak", async () => {
  const { data, error } = await db.rpc("claim_ai_parse", {
    p_user: userId,
    p_date: today,
    p_limit: 3,
  });
  if (error) throw new Error(`RPC gagal: ${error.message}`);
  assert.equal(data, false, "harus false setelah limit habis");
});

await check("counter berhenti di limit (tidak tumbuh terus)", async () => {
  for (let i = 0; i < 5; i++) {
    await db.rpc("claim_ai_parse", {
      p_user: userId,
      p_date: today,
      p_limit: 3,
    });
  }
  const { data: usage } = await db
    .from("ai_usage_daily")
    .select("parse_count")
    .eq("user_id", userId)
    .eq("used_date", today)
    .single();
  assert.equal(
    (usage as { parse_count: number } | null)?.parse_count,
    3,
    "counter harus berhenti tepat di limit"
  );
});

await check("20 klaim paralel dengan limit 10 = tepat 10 yang lulus", async () => {
  await db
    .from("ai_usage_daily")
    .delete()
    .eq("user_id", userId)
    .eq("used_date", today);

  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      db
        .rpc("claim_ai_parse", {
          p_user: userId,
          p_date: today,
          p_limit: 10,
        })
        .then((r) => r.data === true)
    )
  );
  assert.equal(
    results.filter(Boolean).length,
    10,
    `harusnya tepat 10, dapat ${results.filter(Boolean).length}`
  );
});

await cleanup();
console.log(`\nSelesai: ${passed} pemeriksaan lulus.\n`);