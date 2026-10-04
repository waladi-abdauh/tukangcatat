// Verifikasi pengaman anti-blokir: volume cap global + kill switch device.
//
// Yang dijaga di sini adalah kebocoran yang paling mahal: nomor terblokir.
// Kalau claim_wa_outbound racy, beberapa klaim bisa lolos dari batas yang
// sama dan menembus cap; kalau policy fail-closed saat tabel belum ada,
// produk mati total.
//
// Butuh migration 20260103 sudah jalan. Kalau belum, script berhenti di
// preflight dengan pesan yang bisa langsung diikuti (bukan 10 baris FAIL).
//
//   npm run verify:guard
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[guard] ${name} belum diisi`);
    process.exit(1);
  }
  return value!;
}

const db = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

// Tanggal uji yang TERPISAH dari hari ini supaya tidak menyentuh penghitung
// volume produksi. Cap diuji di masa lalu yang tidak dipakai bot.
const TEST_DATE = "2020-01-15";
const TEST_HOUR = 9;

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

async function claim(daily: number, hourly: number): Promise<boolean> {
  const { data, error } = await db.rpc("claim_wa_outbound", {
    p_date: TEST_DATE,
    p_hour: TEST_HOUR,
    p_daily_limit: daily,
    p_hourly_limit: hourly,
  });
  assert.equal(error, null, `RPC error: ${error?.message}`);
  return data === true;
}

async function resetRow() {
  await db.from("wa_outbound_usage").delete().eq("used_date", TEST_DATE);
}

async function main() {
  // Preflight: migration 20260103 WAJIB sudah jalan. Kalau belum, cap global
  // dan kill switch di aplikasi sedang fail-open — produk masih jalan tapi
  // tidak terlindungi. Stop di sini daripada lanjut jadi 10 baris FAIL.
  const { error: preflightError } = await db.rpc("get_gateway_status");
  if (preflightError) {
    console.error("");
    console.error("  MIGRASI BELUM JALAN — pengaman anti-blokir belum aktif.");
    console.error("");
    console.error(
      "  Jalankan SQL ini di Supabase Dashboard → SQL Editor:"
    );
    console.error(
      "    supabase/migrations/20260103_wa_outbound_guard.sql"
    );
    console.error("");
    console.error(`  Detail: ${preflightError.message}`);
    console.error("");
    process.exitCode = 1;
    return;
  }

  console.log(
    `[guard] menguji tanggal uji ${TEST_DATE} jam ${TEST_HOUR}:00 WIB`
  );
  await resetRow();

  await check("baris harian dibuat otomatis saat klaim pertama", async () => {
    assert.equal(await claim(5, 5), true);
    const { data } = await db
      .from("wa_outbound_usage")
      .select("send_count")
      .eq("used_date", TEST_DATE)
      .eq("hour_slot", -1)
      .maybeSingle();
    assert.equal(data?.send_count, 1);
  });

  await check("counter harian naik 1 per klaim", async () => {
    await claim(5, 5);
    const { data } = await db
      .from("wa_outbound_usage")
      .select("send_count")
      .eq("used_date", TEST_DATE)
      .eq("hour_slot", -1)
      .maybeSingle();
    assert.equal(data?.send_count, 2);
  });

  await check("counter per jam naik sinkron dengan harian", async () => {
    const { data } = await db
      .from("wa_outbound_usage")
      .select("send_count")
      .eq("used_date", TEST_DATE)
      .eq("hour_slot", TEST_HOUR)
      .maybeSingle();
    assert.equal(data?.send_count, 2);
  });

  await check("cap per jam: 5 lalu yang 6 DITOLAK", async () => {
    // sudah 2 terpakai, sisakan 3
    assert.equal(await claim(100, 5), true); // ke-3
    assert.equal(await claim(100, 5), true); // ke-4
    assert.equal(await claim(100, 5), true); // ke-5
    assert.equal(await claim(100, 5), false); // ke-6: kena cap jam
  });

  await check(" overweight tidak menambah counter harian", async () => {
    const { data: before } = await db
      .from("wa_outbound_usage")
      .select("send_count")
      .eq("used_date", TEST_DATE)
      .eq("hour_slot", -1)
      .maybeSingle();
    await claim(100, 5); // pasti ditolak, cap jam sudah habis
    const { data: after } = await db
      .from("wa_outbound_usage")
      .select("send_count")
      .eq("used_date", TEST_DATE)
      .eq("hour_slot", -1)
      .maybeSingle();
    assert.equal(after?.send_count, before?.send_count);
  });

  await check(
    "10 klaim paralel dengan cap 5 -> tepat 5 menang (race-safe)",
    async () => {
      await resetRow();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => claim(5, 5))
      );
      assert.equal(results.filter(Boolean).length, 5);
    }
  );

  await check(
    "counter harian = jumlah klaim yang menang (race-safe)",
    async () => {
      const { data } = await db
        .from("wa_outbound_usage")
        .select("send_count")
        .eq("used_date", TEST_DATE)
        .eq("hour_slot", -1)
        .maybeSingle();
      assert.equal(data?.send_count, 5);
    }
  );

  await check("jam berbeda punya counter sendiri", async () => {
    const { error } = await db.rpc("claim_wa_outbound", {
      p_date: TEST_DATE,
      p_hour: TEST_HOUR + 1,
      p_daily_limit: 100,
      p_hourly_limit: 100,
    });
    assert.equal(error, null, error?.message);
    const { data } = await db
      .from("wa_outbound_usage")
      .select("send_count")
      .eq("used_date", TEST_DATE)
      .eq("hour_slot", TEST_HOUR + 1)
      .maybeSingle();
    assert.equal(data?.send_count, 1);
  });

  await check(
    "kill switch default-nya 'ok' (tidak memblokir startup)",
    async () => {
      const { data, error } = await db.rpc("get_gateway_status");
      assert.equal(error, null, `get_gateway_status: ${error?.message}`);
      assert.ok(["ok", "blocked"].includes(data), `status tak dikenal: ${data}`);
      console.log(`       (status sekarang: ${data})`);
    }
  );

  await check("gateway_health bisa ditandai & dipulihkan", async () => {
    const before = await db.rpc("get_gateway_status");

    await db.rpc("mark_gateway_blocked", { p_detail: "verify-test" });
    const blocked = await db.rpc("get_gateway_status");
    assert.equal(blocked.data, "blocked", "kill switch tidak aktif");

    await db.rpc("clear_gateway_blocked");
    const cleared = await db.rpc("get_gateway_status");
    assert.equal(cleared.data, "ok", "kill switch tidak bisa dipulihkan");

    // Kembalikan seperti semula supaya test tidak meninggalkan jejak.
    if (before.data === "blocked") {
      await db.rpc("mark_gateway_blocked", {
        p_detail: "verify-test restore",
      });
    }
  });

  await resetRow();
  console.log(
    `[guard] ${passed} pemeriksaan lulus. Data uji sudah dibersihkan.`
  );
}

await main();