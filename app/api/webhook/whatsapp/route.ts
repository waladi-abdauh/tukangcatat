// Webhook utama inbound WhatsApp (Fonnte sekarang; format netral untuk gateway lain).
//
// Keamanan:
// - GET dipakai cek URL saat save di dashboard Fonnte (return 200).
// - POST wajib verifikasi ?key= (WA_WEBHOOK_SECRET_TOKEN).
// - Wajib balas HTTP 200 secepatnya (Fonnte retry 15x/menit kalau gagal).
// - Allowlist device (WA_DEVICE_NUMBER); abaikan group & pesan device sendiri.
//
// Alur bisnis: auto-register profil -> referral -> parse AI -> simpan transaksi -> balas.
import { after, type NextRequest } from "next/server";
import { serviceRoleClient } from "../../../../lib/supabase/service-role";
import { createWAOutboundAdapter } from "../../../../lib/wa/client";
import { normalizeInboundWebhook, normalizePhoneDigits } from "../../../../lib/wa/inbound";
import { WaSuppressedError } from "../../../../lib/wa/policy";
import { parseCommand, REFERAL_PATTERN, REFERAL_PREFIX } from "../../../../lib/wa/commands";
import {
  ProfileRow,
  buildMagicLink,
  handleCommand,
  handleReferalClaim,
  referalFormatHint,
} from "../../../../lib/wa/handlers";
import {
  transactionsSavedTemplate,
  onboardingTemplate,
  featureLockedTemplate,
  noTransactionsTemplate,
  errorTemplate,
  offTopicRedirectTemplate,
  greetingTemplate,
  nonReceiptPhotoTemplate,
  dailyLimitReachedTemplate,
  aiLimitReachedTemplate,
  recapQuestionTemplate,
} from "../../../../lib/wa/templates";
import { sendWebPushToUser } from "../../../../lib/wa/push";
import { isGreetingMessage } from "../../../../lib/wa/offtopic";
import { parseTransactionsFromText, type FinancialResult } from "../../../../lib/ai/gemini-text";
import { parseTransactionsFromVoice } from "../../../../lib/ai/gemini-voice";
import { parseTransactionsFromImage } from "../../../../lib/ai/gemini-vision";
import type { InboundWAMessage, ParsedTransactions } from "../../../../lib/security/sanitization";
import { waInboundSchema } from "../../../../lib/security/sanitization";
import { formatIDR, todayID } from "../../../../lib/utils";
import {
  getFreeDailyTransactionLimit,
  getProDailyTransactionLimit,
  getFreeDailyAiParseLimit,
  getProDailyAiParseLimit,
  getDailyReplyCap,
} from "../../../../lib/constants";
import { currentMonthKey, resolveCategoryBudgets, computeDailySummary } from "../../../../lib/dash/budgets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DBC = typeof serviceRoleClient;

// GET: balasan validasi URL webhook (dibutuhkan sebagian dashboard gateway).
export async function GET() {
  return Response.json({ status: "ok" });
}

export async function POST(request: NextRequest) {
  // 1) Verifikasi kunci bersama via query ?key=.
  const { searchParams } = new URL(request.url);
  const keyOk = searchParams.get("key") === process.env.WA_WEBHOOK_SECRET_TOKEN;
  if (!keyOk) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }

let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    console.warn("[webhook] body bukan JSON");
    return Response.json({ status: "ok" }); // jangan retry gateway
  }

  // 2) Normalisasi lintas gateway (Fonnte/Wablas) — nomor device & user punya
  // nama field BERBEDA per gateway, lihat lib/wa/inbound.ts.
  const { inbound, messageId, devicePhone, isFromMe, isGroup } =
    normalizeInboundWebhook(raw);

  // 3) Allowlist device + abaikan group & pesan dari device sendiri.
  // Nomor dinormalisasi dulu (0.. vs 62..) agar format lokal tak salah-blok.
  const deviceNumber = process.env.WA_DEVICE_NUMBER
    ? normalizePhoneDigits(process.env.WA_DEVICE_NUMBER)
    : "";
  const isOtherDevice =
    devicePhone !== "" && deviceNumber !== "" && devicePhone !== deviceNumber;
  const isSelf = deviceNumber !== "" && inbound.sender === deviceNumber;
  if (isOtherDevice || isSelf || isGroup || isFromMe) {
    return Response.json({ status: "ok" });
  }

  // 4) Validasi schema; payload tak sah diabaikan pelan-pelan.
  const parsed = waInboundSchema.safeParse(inbound);
  if (!parsed.success) {
    console.warn("[webhook] payload tak valid:", parsed.error.issues[0]?.message);
    return Response.json({ status: "ok" });
  }

  // 4b) Hanya proses nomor Indonesia (62*): payload palsu tidak bisa memaksa
  // bot mengirim pesan ke nomor arbitrer atau membuat profil spam di DB.
  if (!parsed.data.sender.startsWith("62")) {
    return Response.json({ status: "ok" });
  }

  // 5) Dedupe retry: gateway mengirim ulang payload yang sama bila jawaban
  // lambat (Fonnte retry 15x/menit). Tanpa klaim ini, 1 chat bisa di-parse
  // AI berulang & transaksi terduplikasi. Pesan tanpa messageId diproses
  // tanpa dedupe (lebih baik daripada membuang transaksi sah).
  if (messageId && !(await claimInboundMessage(messageId))) {
    return Response.json({ status: "ok", deduped: true });
  }

  // 6) Balas 200 segera (hindari retry gateway -> duplikat), proses di background.
  after(async () => {
    let reply: string | null = null;
    try {
      reply = await processInbound(parsed.data);
    } catch (err) {
      // Gagal di sisi KITA (parse/simpan), gateway belum disentuh sama sekali.
      // Balasan error ke user aman & berguna di sini.
      console.error("[webhook] processInbound error:", err);
      await deliverSuppressedSafe(parsed.data.sender, () =>
        createWAOutboundAdapter().sendText(parsed.data.sender, errorTemplate())
      );
      return;
    }

    if (!reply) return;

    // Selesai: kirim balasan. Kalau INI yang gagal (gateway down / device
    // terblokir), JANGAN kirim pesan kedua sebagai "error" — satu pesan masuk
    // jadi dua percobaan kirim tepat di saat device paling tidak boleh
    // ditekan. Diam + log justru perilaku yang benar.
    try {
      await createWAOutboundAdapter().sendText(parsed.data.sender, reply);
    } catch (err) {
      console.error("[webhook] kirim balasan gagal:", err);
    }
  });

  return Response.json({ status: "ok" });
}

// Membungkus pengiriman balasan agar kegagalan tidak menggagalkan pemanggil.
// `WaSuppressedError` (quiet hours, cap, kill switch) itu keputusan kebijakan,
// bukan malfunction: dicatat singkat tanpa error ticker supaya tidak memenuhi
// log dengan spam.
async function deliverSuppressedSafe(
  to: string,
  send: () => Promise<void>
): Promise<void> {
  try {
    await send();
  } catch (err) {
    if (err instanceof WaSuppressedError) {
      console.log(`[webhook] balasan ditahan (${err.reason}): ${to}`);
      return;
    }
    throw err;
  }
}

// Klaim message_id secara atomik; false = sudah pernah diproses (retry).
// Pola upsert-ignore-duplicates pada PRIMARY KEY: baris hanya dikembalikan
// bila ini klaim BARU, sehingga retry paralel tetap aman (race-safe).
async function claimInboundMessage(messageId: string): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .from("wa_inbound_seen")
    .upsert(
      { message_id: messageId },
      { onConflict: "message_id", ignoreDuplicates: true }
    )
    .select("message_id");

  if (error) {
    // Tabel belum ter-deploy: jangan membuang pesan user demi dedupe —
    // degradasi ke perilaku lama (retry mungkin dobel) sampai migration jalan.
    console.error("[webhook] claim inbound gagal:", error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

// ===== Logika bisnis (exported untuk unit test) =====

export async function processInbound(inbound: InboundWAMessage): Promise<string | null> {
  const db = serviceRoleClient;
  const sender = inbound.sender;

  // Anti-abuse: nomor yang sudah melampaui batas balasan harian diabaikan
  // senyap (jangan buat profil / jangan balas - hemat kuota gateway).
  if (!withinReplyBudget(sender)) return null;

  const profile = await getOrCreateProfile(db, sender);
  if (!profile) throw new Error("Gagal membuat profil");

  // Perintah cepat & klaim referral (tanpa AI).
  if (inbound.messageType === "text" && inbound.text) {
    const trimmed = inbound.text.trim();
    const command = parseCommand(trimmed);
    if (command) return handleCommand(db, profile, command, sender);

    const refMatch = trimmed.match(REFERAL_PATTERN);
    if (refMatch) return handleReferalClaim(db, profile, refMatch[1]);

    if (REFERAL_PREFIX.test(trimmed)) return referalFormatHint();
  }

  // Daftar kategori aktif milik user (Settings + yang pernah terpakai di
  // catatan) - AI hanya boleh memilih dari sini, mengikuti dashboard user.
  const aiCategories = await getUserCategories(db, profile.id);

  // Gerbang biaya AI. WAHAN pesan bisa "tidak menghasilkan transaksi" (salam,
  // gibberish, struk tak terbaca) tetapi tetap memanggil Gemini — batas catatan
  // saja tidak menutup biaya itu. Klaim atomik per user per hari.
  const aiLimit = profile.is_pro
    ? getProDailyAiParseLimit()
    : getFreeDailyAiParseLimit();
  if (!(await claimAiParse(db, profile.id, todayID(), aiLimit))) {
    const preview =
      inbound.text ??
      (inbound.messageType === "audio"
        ? "voice note"
        : inbound.messageType === "image"
          ? "foto"
          : "pesan");
    return aiLimitReachedTemplate(aiLimit, previewText(preview));
  }

  // Parse AI sesuai tipe; voice/scan struk khusus PRO (biaya Gemini + media).
  let items: FinancialResult;
  let inputType: "text" | "voice" | "ocr";
  // Sisa jatah catatan via WA hari ini (free & pro sama-sama dibatasi,
  // tiap catatan = 1 balasan Fonnte) untuk clamp multi-item per pesan.
  let textQuotaLeft: number | null = null;

  if (inbound.messageType === "audio") {
    inputType = "voice";
    if (!profile.is_pro) return featureLockedTemplate();
    if (!inbound.mediaUrl) throw new Error("Audio tanpa media url");
    const buf = await downloadBuffer(inbound.mediaUrl);
    items = await parseTransactionsFromVoice(
      buf,
      inbound.mediaMimeType ?? "audio/mp4",
      aiCategories
    );
  } else if (inbound.messageType === "image") {
    inputType = "ocr";
    if (!profile.is_pro) return featureLockedTemplate();
    if (!inbound.mediaUrl) throw new Error("Gambar tanpa media url");
    const buf = await downloadBuffer(inbound.mediaUrl);
    items = await parseTransactionsFromImage(
      buf,
      inbound.mediaMimeType ?? "image/jpeg",
      aiCategories
    );
  } else {
    inputType = "text";
    if (!inbound.text) return onboardingTemplate();

    // Batas catatan via WA per hari (free & pro): cek SEBELUM memanggil
    // Gemini (hemat token) & sebelum menyimpan (hitung tersimpan hari ini).
    const dailyLimit = profile.is_pro
      ? getProDailyTransactionLimit()
      : getFreeDailyTransactionLimit();
    const usedToday = await countTodayTransactions(db, profile.id, todayID());
    if (usedToday >= dailyLimit) {
      return dailyLimitReachedTemplate(
        dailyLimit,
        previewText(inbound.text),
        getProDailyTransactionLimit()
      );
    }
    textQuotaLeft = dailyLimit - usedToday;

    items = await parseTransactionsFromText(inbound.text, aiCategories);
  }

  // Guardrail: pesan non-finansial ditolak ramah tanpa biaya token tambahan.
  if (!items.financial) {
    if (inbound.messageType === "image") return nonReceiptPhotoTemplate();
    if (inbound.text && isGreetingMessage(inbound.text)) return greetingTemplate();
    return offTopicRedirectTemplate();
  }

  // Pertanyaan seputar dompet: dijawab LOKAL dari database (angka asli,
  // nol teks AI) — "reply bagus" tanpa membuka obrolan bebas.
  if ("question" in items) {
    const { monthlySpent, monthlyRemaining } = await computeDailySummary(
      profile.id,
      todayID()
    );
    return recapQuestionTemplate(
      monthlySpent,
      monthlyRemaining,
      await buildMagicLink(sender)
    );
  }

  const parsedItems = items.items;
  if (parsedItems.length === 0) {
    return noTransactionsTemplate();
  }

  // Defensive: kategori hasil AI di luar daftar user dibaca "Lainnya" supaya
  // dashboard tidak ditumbuhi kategori liar (halusinasi model).
  const sanitizedItems = parsedItems.map((it) => ({
    ...it,
    category: aiCategories.includes(it.category) ? it.category : "Lainnya",
  }));

  // Satu pesan banyak item di-clamp ke sisa jatah hari ini supaya total
  // catatan via WA tidak menembus batas paket (free 5 / pro 20 sehari).
  const itemsToSave =
    textQuotaLeft != null && sanitizedItems.length > textQuotaLeft
      ? sanitizedItems.slice(0, textQuotaLeft)
      : sanitizedItems;

  const today = todayID();
  const { error: insertErr } = await db.from("transactions").insert(
    itemsToSave.map((it) => ({
      user_id: profile.id,
      item_name: it.item_name,
      amount: it.amount,
      category: it.category,
      input_type: inputType,
      transaction_date: today,
    }))
  );
  if (insertErr) throw new Error(`Simpan transaksi gagal: ${insertErr.message}`);

  const { dailyTotal, monthlyRemaining } = await computeDailySummary(
    profile.id,
    today
  );
  const reply = transactionsSavedTemplate(
    itemsToSave,
    dailyTotal,
    monthlyRemaining,
    await buildMagicLink(sender)
  );

  await sendCategoryLeakAlerts(db, profile, itemsToSave);

  return reply;
}

// ===== Helper =====

async function getOrCreateProfile(db: DBC, phone: string): Promise<ProfileRow | null> {
  const { data: existing } = await db
    .from("profiles")
    .select(
      "id, phone_number, referral_code, is_pro, referred_by"
    )
    .eq("phone_number", phone)
    .maybeSingle();
  if (existing) return existing as unknown as ProfileRow;

  const { data: created, error: createErr } = await db
    .from("profiles")
    .insert({ phone_number: phone })
    .select(
      "id, phone_number, referral_code, is_pro, referred_by"
    )
    .single();
  if (createErr || !created) {
    // Race dua pesan bersamaan dari nomor baru: unique phone_number bentrok
    // -> profil sebenarnya sudah tersimpan, ambil yang ada.
    if ((createErr as { code?: string } | null)?.code === "23505") {
      const { data: raced } = await db
        .from("profiles")
        .select(
          "id, phone_number, referral_code, is_pro, referred_by"
        )
        .eq("phone_number", phone)
        .maybeSingle();
      if (raced) return raced as unknown as ProfileRow;
    }
    console.error("[webhook] create profile:", createErr?.message);
    return null;
  }
  const { error: seedErr } = await db.rpc("seed_default_categories", {
    target_user_id: created.id,
  });
  if (seedErr) console.error("[webhook] seed categories:", seedErr.message);
  return created as unknown as ProfileRow;
}

// Daftar kategori aktif milik user: yang dikelola di Settings (category_budgets)
// set kategori yang pernah dipakai di catatan - persis seperti tampilan dashboard.
// "Lainnya" selalu disertakan; bila user belum punya kategori sama sekali,
// fallback ke daftar default supaya AI tetap bisa berkategorisasi.
async function getUserCategories(db: DBC, userId: string): Promise<string[]> {
  const [budgetRows, txRes] = await Promise.all([
    resolveCategoryBudgets(userId, currentMonthKey()),
    db.from("transactions").select("category").eq("user_id", userId).limit(2000),
  ]);
  const set = new Set<string>();
  for (const row of budgetRows) {
    if (row.category_name) set.add(row.category_name);
  }
  for (const row of (txRes.data ?? []) as Array<{ category: string }>) {
    if (row.category) set.add(row.category);
  }
  set.delete("Lainnya");
  if (set.size === 0) {
    return ["Dapur", "Makan", "Transport", "Leisure", "Tagihan", "Lainnya"];
  }
  return [...set, "Lainnya"];
}

// Potongan isi pesan user untuk pesan limit (jelas + konten bervariasi).
function previewText(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean;
}

// Anti-abuse: setiap pesan masuk memicu tepat 1 balasan gateway. Nomor cerewet
// atau spam tidak boleh membakar pool kuota pesan: lebih dari DAILY_REPLY_CAP
// balasan per nomor per hari diabaikan senyap. Counter in-memory per proses
// (reset saat restart server, cukup untuk menahan burst spam).
//
// CATATAN: ini penghematan kuota, bukan pengaman blokir. Pengaman device ada di
// lib/wa/policy.ts (volume cap global, jam tenang, warm-up, kill switch).
const replyBudget = new Map<string, { date: string; count: number }>();

function withinReplyBudget(sender: string): boolean {
  const today = todayID();
  const entry = replyBudget.get(sender);
  if (!entry || entry.date !== today) {
    replyBudget.set(sender, { date: today, count: 1 });
    // Anti bocoran memori pelan: entri sender lama disapu berkala
    // (Map tidak pernah menyusut sendiri sepanjang umur proses).
    if (replyBudget.size > 1000) {
      for (const [key, val] of replyBudget) {
        if (val.date !== today) replyBudget.delete(key);
      }
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= getDailyReplyCap();
}

// Klaim satu jatah parse AI (atomik, race-safe). RPC melakukan INSERT ... ON
// CONFLICT DO UPDATE dengan kondisi `parse_count < limit`, jadi overweight
// tidak hanya mengembalikan false tetapi juga tidak menaikkan counter.
async function claimAiParse(
  db: DBC,
  userId: string,
  date: string,
  limit: number
): Promise<boolean> {
  const { data, error } = await db.rpc("claim_ai_parse", {
    p_user: userId,
    p_date: date,
    p_limit: limit,
  });
  if (error) {
    // Migration belum jalan: fail-open agar user tidak kehilangan catatan demi
    // tabel penghitung. Batas catatan (textQuotaLeft) tetap menahan penyalahgunaan.
    console.error("[webhook] claim ai parse gagal:", error.message);
    return true;
  }
  return data === true;
}

// Jumlah catatan VIA WA yang tersimpan hari ini (untuk batas harian paket).
// Catatan manual dari dashboard TIDAK dihitung — janji produk: manual bebas
// batas (tidak mengirim pesan Fonnte).
async function countTodayTransactions(
  db: DBC,
  userId: string,
  today: string
): Promise<number> {
  const { count } = await db
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("transaction_date", today)
    .in("input_type", ["text", "voice", "ocr"]);
  return count ?? 0;
}

// Hanya unduh media dari URL https publik (anti-SSRF: localhost, IP privat,
// IP literal, dan host metadata internal diblok sebelum di-fetch).
function assertSafeMediaUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`URL media harus https: ${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[");
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (isIpLiteral || isPrivate) {
    throw new Error(`Host media tidak diizinkan: ${host}`);
  }
}

async function downloadBuffer(url: string): Promise<Uint8Array> {
  assertSafeMediaUrl(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download media gagal (${res.status}): ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Alert bocor via WEB PUSH (bukan WA — WhatsApp hanya untuk loop nyatet,
// pemberitahuan lewat push: mengurangi sinyal spam device WA & hemat kuota).
// Dedupe harian: maksimal 1 push per kategori per hari meski transaksi
// berulang (claim-then-send race-safe lewat UNIQUE sent_alerts).
async function sendCategoryLeakAlerts(
  db: DBC,
  profile: ProfileRow,
  items: ParsedTransactions
): Promise<void> {
  const budgets = await resolveCategoryBudgets(profile.id, currentMonthKey());
  if (budgets.length === 0) return;

  const monthStart = `${todayID().slice(0, 7)}-01`;
  const { data: monthRows } = await db
    .from("transactions")
    .select("amount, category")
    .eq("user_id", profile.id)
    .gte("transaction_date", monthStart);

  const usedMap = new Map<string, number>();
  for (const row of monthRows ?? []) {
    usedMap.set(row.category, (usedMap.get(row.category) ?? 0) + Number(row.amount));
  }

  const today = todayID();
  for (const budget of budgets) {
    const used = usedMap.get(budget.category_name) ?? 0;
    const limit = Number(budget.limit_amount);
    const touched = items.some((it) => it.category === budget.category_name);
    if (limit <= 0 || used / limit < 0.8 || !touched) continue;

    // Klaim dedupe dulu (race-safe): upsert-ignore-duplicates pada UNIQUE
    // (user_id,kind,key,sent_date) mengembalikan baris HANYA bila ini klaim
    // baru. Baris kosong = sudah ada push hari ini -> skip.
    const { data: claimed } = await db
      .from("sent_alerts")
      .upsert(
        {
          user_id: profile.id,
          kind: "leak",
          key: budget.category_name,
          sent_date: today,
        },
        { onConflict: "user_id,kind,key,sent_date", ignoreDuplicates: true }
      )
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    // Terklaim -> kirim push (body bervariasi: angka asli per user).
    const pct = Math.round((used / limit) * 100);
    await sendWebPushToUser(profile.id, {
      body: `⚠️ ${budget.category_name} udah ${pct}% — ${formatIDR(used)} dari ${formatIDR(limit)}. Ngerem dikit yuk 🧘`,
      url: "/dash",
    }).catch(() => {});
  }
}
