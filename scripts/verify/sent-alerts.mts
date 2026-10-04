// Verifikasi tabel sent_alerts: dedupe alert bocor kategori maksimal 1 push
// per (user, kind, key, tanggal) meski transaksi berulang / webhook paralel.
//
// Jalankan: npx tsx --env-file=.env.local scripts/verify/sent-alerts.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serviceRoleClient as db } from "../../lib/supabase/service-role";
import { todayID } from "../../lib/utils";

// Klaim yang sama dengan yang dipakai webhook (claim-then-send).
async function claim(userId: string, key: string): Promise<number> {
  const { data, error } = await db
    .from("sent_alerts")
    .upsert(
      {
        user_id: userId,
        kind: "leak",
        key,
        sent_date: todayID(),
      },
      { onConflict: "user_id,kind,key,sent_date", ignoreDuplicates: true }
    )
    .select("id");
  assert.ok(
    !error,
    `upsert claim gagal: ${error?.message ?? "unknown"}` +
      (error?.message.includes("schema cache")
        ? " -> jalankan SQL sent_alerts di Supabase dulu (scripts/verify/sent-alerts.mts)"
        : "")
  );
  return data?.length ?? 0;
}

async function main() {
  // User uji: profil real pertama (FK ke profiles), dibersihkan di finally.
  const { data: profiles, error: pErr } = await db
    .from("profiles")
    .select("id")
    .limit(1);
  assert.ok(!pErr, `gagal ambil profil: ${pErr?.message}`);
  const userId = profiles?.[0]?.id as string | undefined;
  assert.ok(userId, "tidak ada profil di database");

  // Key unik supaya tidak bentrok dengan data production.
  const key = `__uji__${randomUUID().slice(0, 8)}`;
  const kind = "leak";

  try {
    // 1. Klaim pertama = baris baru (push dikirim).
    const first = await claim(userId, key);
    assert.ok(first === 1, `klaim pertama harus 1 baris, dapat ${first}`);
    console.log("PASS klaim pertama (push dikirim)");

    // 2. Klaim identik = 0 baris (push DILEWATI — inilah anti-duplikatnya).
    const second = await claim(userId, key);
    assert.ok(second === 0, `klaim ulang harus 0 baris, dapat ${second}`);
    console.log("PASS klaim ulang dedupe (push dilewati)");

    // 3. 5 klaim paralel (simulasi burst webhook) -> tepat 1 yang menang.
    const burst = await Promise.all([
      claim(userId, key),
      claim(userId, key),
      claim(userId, key),
      claim(userId, key),
      claim(userId, key),
    ]);
    const winners = burst.filter((n) => n > 0).length;
    assert.ok(winners === 0, `burst setelah klaim pertama: ${winners} push duplikat`);
    console.log("PASS burst paralel (0 push tambahan)");

    // 4. Key berbeda (kategori lain) tetap boleh diklaim.
    const other = await claim(userId, `${key}-b`);
    assert.ok(other === 1, `kategori lain harus 1 baris, dapat ${other}`);
    console.log("PASS key berbeda tidak ikut dedupe");

    // 5. Tepat 1 baris tersimpan untuk key tadi.
    const { count } = await db
      .from("sent_alerts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("key", key);
    assert.ok(count === 1, `harus ada tepat 1 baris, dapat ${count}`);
    console.log("PASS tepat 1 baris per kategori per hari");

    console.log("\nSENT-ALERTS OK: claim-then-send + dedupe harian race-safe.");
  } finally {
    const { error: delErr } = await db
      .from("sent_alerts")
      .delete()
      .eq("user_id", userId)
      .eq("kind", kind)
      .like("key", `${key}%`);
    // Cleanup tidak boleh menutupi error asli (mis. tabel belum ada).
    if (delErr) console.warn(`PERINGATAN: gagal bersihkan data uji: ${delErr.message}`);
    else console.log("data uji dibersihkan");
  }
}

main().catch((err) => {
  console.error("SENT-ALERTS GAGAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
