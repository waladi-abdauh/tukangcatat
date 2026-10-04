// Verifikasi Step 2: koneksi Supabase live (anon & service role), 5 tabel, trigger referral, RLS.
// Jalankan: node --env-file=.env.local scripts/verify/supabase.mts
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [name, v] of [
  ["NEXT_PUBLIC_SUPABASE_URL", url],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey],
  ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
]) {
  assert.ok(v, `${name} belum terisi di .env.local`);
}

const TABLES = ["profiles", "category_budgets", "transactions", "payments", "referrals"] as const;

function makeClient(key: string): SupabaseClient {
  return createClient(url!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const anon = makeClient(anonKey!);
  const srv = makeClient(serviceKey!);

  // 1) Anon key: kelima tabel harus terekspos + grant SELECT aktif (RLS membatasi baris).
  for (const t of TABLES) {
    const { error } = await anon.from(t).select("id", { count: "exact", head: true });
    assert.equal(error, null, `[ANON] ${t}: ${error?.message ?? "?"}`);
    console.log(`PASS [ANON] akses tabel ${t}`);
  }

  // 2) Service role: query jalan (bypass RLS) -> membuktikan key valid.
  for (const t of TABLES) {
    const { error } = await srv.from(t).select("id", { count: "exact", head: true });
    assert.equal(error, null, `[SERVICE] ${t}: ${error?.message ?? "?"}`);
    console.log(`PASS [SERVICE] akses tabel ${t}`);
  }

  // 3) Smoke test round-trip: insert -> trigger referral -> RLS block anon -> cleanup.
  const phone = `628${String(randomInt(0, 1_000_000_0000)).padStart(10, "0")}`;
  const { data: inserted, error: insErr } = await srv
    .from("profiles")
    .insert({ phone_number: phone, full_name: "Verify Smoke" })
    .select("id, referral_code")
    .single();
  assert.equal(insErr, null, `insert profile: ${insErr?.message ?? "?"}`);
  const id = inserted!.id as string;
  console.log(`PASS [SERVICE] insert profile temp ${phone} (id=${id})`);

  const rc = inserted!.referral_code as string | null;
  assert.ok(rc, "referral_code tidak ter-generate oleh trigger");
  assert.match(rc, /^CCAT-[A-F0-9]{6}$/, `format referral_code salah: ${rc}`);
  console.log(`PASS [TRIGGER] referral_code otomatis = ${rc}`);

  const { data: anonRead, error: anonReadErr } = await anon
    .from("profiles")
    .select("id")
    .eq("id", id);
  assert.equal(anonReadErr, null, `[ANON] baca profil: ${anonReadErr?.message ?? "?"}`);
  assert.equal(
    anonRead!.length,
    0,
    "RLS tidak memblokir baca anon (baris orang lain kebaca)"
  );
  console.log("PASS [RLS] anon key tidak bisa baca profil orang lain (0 baris)");

  const { error: delErr } = await srv.from("profiles").delete().eq("id", id);
  assert.equal(delErr, null, `cleanup hapus profile: ${delErr?.message ?? "?"}`);
  console.log(`PASS [CLEANUP] profile ${id} dihapus`);

  console.log("\nSUPABASE OK: anon+service role, 5 tabel, trigger referral, RLS -- semua pass.");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});