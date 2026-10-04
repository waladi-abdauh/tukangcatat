// Smoke test Step 5: normalize Fonnte -> schema, command parser, processInbound, route auth.
// Jalankan: npx tsx --env-file=.env.local scripts/verify/step5.mts
import assert from "node:assert/strict";
import { normalizeFonntePayload } from "../../lib/wa/inbound.ts";
import { parseCommand, REFERAL_PATTERN } from "../../lib/wa/commands.ts";
import { isGreetingMessage } from "../../lib/wa/offtopic.ts";
import { getFreeDailyTransactionLimit } from "../../lib/constants.ts";
import { todayID } from "../../lib/utils.ts";
import { processInbound } from "../../app/api/webhook/whatsapp/route.ts";
import { serviceRoleClient } from "../../lib/supabase/service-role.ts";

const FAKE_PHONE = "6280000000000";

async function cleanup() {
  await serviceRoleClient.from("profiles").delete().eq("phone_number", FAKE_PHONE);
}

async function main() {
  // ---------- 1) Normalisasi payload ----------
  const t = normalizeFonntePayload({
    device: "6281514449712",
    sender: "6281234567890",
    name: "Budi",
    message: "Bensin 35rb",
  });
  assert.equal(t.sender, "6281234567890");
  assert.equal(t.messageType, "text");
  assert.equal(t.text, "Bensin 35rb");
  assert.equal(t.mediaUrl, undefined);
  console.log("PASS normalize text");

  const a = normalizeFonntePayload({
    sender: "6281234567890",
    url: "https://files.fonnte.com/a.m4a",
    filename: "a",
    extension: "m4a",
  });
  assert.equal(a.messageType, "audio");
  assert.equal(a.mediaMimeType, "audio/mp4");
  assert.equal(a.mediaUrl, "https://files.fonnte.com/a.m4a");
  console.log("PASS normalize audio (m4a -> audio/mp4)");

  const img = normalizeFonntePayload({
    sender: "6281234567890",
    url: "https://files.fonnte.com/s.jpg",
    extension: "jpg",
  });
  assert.equal(img.messageType, "image");
  assert.equal(img.mediaMimeType, "image/jpeg");
  console.log("PASS normalize image (jpg -> image/jpeg)");

  const unk = normalizeFonntePayload({
    sender: "6281234567890",
    url: "https://files.fonnte.com/x.exe",
    extension: "exe",
  });
  assert.equal(unk.messageType, "unknown");
  console.log("PASS normalize unknown extension");

  // ---------- 2) Command & referral parser ----------
  assert.equal(parseCommand("!BANTUAN"), "!bantuan");
  assert.equal(parseCommand("!dashboard"), "!dashboard");
  assert.equal(parseCommand("!referral"), "!referal");
  assert.equal(parseCommand("halo"), null);
  console.log("PASS parseCommand");

  // ---------- 2b) Deteksi sapaan (guardrail off-topic, tanpa token) ----------
  assert.equal(isGreetingMessage("Halo bot, lagi apa?"), true);
  assert.equal(isGreetingMessage("apa kabar kak"), true);
  assert.equal(isGreetingMessage("kamu siapa?"), true);
  assert.equal(isGreetingMessage("Bensin 35rb"), false);
  assert.equal(isGreetingMessage("Cuaca Jakarta cerah gak?"), false);
  console.log("PASS isGreetingMessage");

  const refMatch = "REF CCAT-5FC860".match(REFERAL_PATTERN);
  assert.equal(refMatch?.[1], "CCAT-5FC860");
  assert.equal("REF CCAT-123Z".match(REFERAL_PATTERN), null);
  console.log("PASS REFERAL_PATTERN");

  // ---------- 3) processInbound (DB nyata, tanpa kirim WA / AI) ----------
  try {
    const bantuan = await processInbound({
      sender: FAKE_PHONE,
      messageType: "text",
      text: "!bantuan",
    });
    assert.ok(bantuan && bantuan.includes("TukangCatat"), "balasan !bantuan salah");
    console.log("PASS processInbound !bantuan");

    const badRef = await processInbound({
      sender: FAKE_PHONE,
      messageType: "text",
      text: "REF CCAT-12345",
    });
    assert.ok(badRef && badRef.includes("Format kode salah"), "invalid ref tidak ditolak");
    console.log("PASS processInbound REF invalid format");

    const { data: profile } = await serviceRoleClient
      .from("profiles")
      .select("referral_code")
      .eq("phone_number", FAKE_PHONE)
      .maybeSingle();
    assert.ok(profile, "profil tidak dibuat");
    assert.match(String(profile.referral_code), /^CCAT-[A-F0-9]{6}$/, "referral_code salah");
    console.log(`PASS auto-register (profil dibuat, referral=${profile.referral_code})`);
  } finally {
    await cleanup();
  }

  // ---------- 3b) Batas pencatatan harian akun gratis ----------
  {
    const HEAVY_PHONE = "6280000000002";
    const db = serviceRoleClient;
    async function cleanHeavy() {
      await db.from("transactions").delete().eq("user_id",
        (await db.from("profiles").select("id").eq("phone_number", HEAVY_PHONE).maybeSingle()).data?.id ?? "");
      await db.from("profiles").delete().eq("phone_number", HEAVY_PHONE);
    }
    try {
      const limit = getFreeDailyTransactionLimit();
      const { data: heavy } = await db
        .from("profiles")
        .insert({ phone_number: HEAVY_PHONE })
        .select("id, referral_code, is_pro, referred_by")
        .single();
      assert.ok(heavy, "profil heavy tidak dibuat");

      const rows = Array.from({ length: limit }, (_, i) => ({
        user_id: heavy.id,
        item_name: `Tes ${i + 1}`,
        amount: 1000,
        category: "Lainnya",
        // input_type "text" = catatan via WA (manual TIDAK dihitung limit).
        input_type: "text",
        transaction_date: todayID(),
      }));
      const { error: bulkErr } = await db.from("transactions").insert(rows);
      assert.ifError(bulkErr);

      const reply = await processInbound({
        sender: HEAVY_PHONE,
        messageType: "text",
        text: "Bensin 40rb",
      });
      assert.ok(
        reply && reply.includes("Bensin 40rb") && reply.includes("nggak kecatat") && reply.includes("PRO"),
        `harus balas daily-limit + menyebut isi catatan, dapat: ${reply?.slice(0, 80)}`
      );

      const { count } = await db
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", heavy.id)
        .eq("transaction_date", todayID());
      assert.equal(count, limit, "tidak boleh ada transaksi baru setelah diblokir");
      console.log(`PASS daily-limit free diblokir (limit=${limit}, tanpa AI & tanpa insert baru)`);
    } finally {
      await cleanHeavy();
    }
  }

  // ---------- 4) Route HTTP (via dev server lokal) ----------
  const base = "http://localhost:3000/api/webhook/whatsapp";
  const secret = process.env.WA_WEBHOOK_SECRET_TOKEN!;

  const get = await fetch(base);
  assert.equal(get.status, 200, "GET harus 200 (validasi URL Fonnte)");
  console.log("PASS GET route -> 200");

  const badKey = await fetch(base + "?key=salah", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device: "x", sender: "6281234567890", message: "t" }),
  });
  assert.equal(badKey.status, 401, "POST key salah harus 401");
  console.log("PASS POST wrong key -> 401");

  const wrongDevice = await fetch(base + `?key=${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device: "6289999999999",
      sender: "6281234567890",
      message: "Bensin 35rb",
    }),
  });
  assert.equal(wrongDevice.status, 200, "device bukan allowlist harus tetap 200 (diabaikan)");
  console.log("PASS POST non-allowlist device -> 200 diabaikan");

  const group = await fetch(base + `?key=${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device: "6281514449712",
      sender: "6281234567890",
      member: "6281514449712",
      message: "halo group",
    }),
  });
  assert.equal(group.status, 200, "pesan group harus 200 diabaikan");
  console.log("PASS POST group message -> 200 diabaikan");

  // ---------- 5) Proses background via after() (auto-register, tanpa AI) ----------
  {
    const res = await fetch(base + `?key=${secret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Device HARUS nomor allowlist (WA_DEVICE_NUMBER) supaya diproses —
        // bukan hardcode, biar tes jalan di env mana pun.
        device: process.env.WA_DEVICE_NUMBER!,
        sender: FAKE_PHONE,
        name: "Tester",
        message: "!bantuan",
      }),
    });
    assert.equal(res.status, 200, "POST valid harus balas 200 cepat (ack-first)");
    console.log("PASS ack-first 200 (sebelum proses background selesai)");

    // Proses berjalan di background (after); tunggu profil muncul (max ~15 detik).
    let created = false;
    for (let i = 0; i < 30; i++) {
      const { data } = await serviceRoleClient
        .from("profiles")
        .select("id")
        .eq("phone_number", FAKE_PHONE)
        .maybeSingle();
      if (data) {
        created = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(created, "proses background tidak membuat profil");
    console.log("PASS after() background process (auto-register jalan)");
  }

  console.log("\nSTEP5 OK: normalize, command, referral, auto-register, route auth, after() -- semua pass.");
}

main()
  .catch((e) => {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });