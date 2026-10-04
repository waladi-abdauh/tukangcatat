// Konstanta bisnis TukangCatat (harga, reward referral, quota, cap).
// Nilai tunggal sumber kebenaran supaya konsisten di seluruh modul.

// Nama brand yang dipakai di UI, metadata, & manifest.
export const APP_NAME = "TukangCatat";

// Budget default bila user belum pernah mengisi monthly_budgets
// (fallback resolver budget per-periode).
export const DEFAULT_MONTHLY_BUDGET = 3_000_000;

// Harga langganan PRO bulanan (rupiah).
export const PRO_PRICE = 19_000;

// Potongan 20% untuk referee (pengguna baru dari kode referral) => bayar 80%.
export const REFERREE_DISCOUNT_PCT = 0.2;
export const REFERREE_DISCOUNT_AMOUNT = Math.round(PRO_PRICE * REFERREE_DISCOUNT_PCT);

// Reward kredit 25% bagi referrer ketika referee berhasil settlement.
export const REFERRER_REWARD_AMOUNT = 4_750;

// Cap credit_balance maksimal agar tidak menumpuk gratis selamanya (setara 2 bulan).
export const CREDIT_BALANCE_CAP = PRO_PRICE * 2;

// Batas balasan per nomor per hari (anti-abuse: setiap pesan masuk memicu
// 1 balasan Fonnte — nomor cerewet/spam tidak boleh membakar pool kuota).
export const DAILY_REPLY_CAP = 50;

export function getDailyReplyCap(): number {
  const fromEnv = Number(process.env.DAILY_REPLY_CAP ?? "");
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : DAILY_REPLY_CAP;
}

// ===== Anti-ban device WA =====
//
// Batas-batas ini untuk "nomor bot" sebagai device WhatsApp, bukan untuk user.
// Satu nomor yang diblokir = seluruh produk mati (bot tidak bisa nyatet), jadi
// di sini kita jauh lebih konservatif daripada yang dibutuhkan untuk bisnis:
//
// - Semua limit bisa di-override via env supaya ops bisa menyetel ulang tanpa
//   deploy (penting: insiden butuh respons cepat, tidak bisa nunggu release).
// - Nilai default dipilih dengan headroom terhadap rencana 10.200 pesan/bulan
//   (~340 pesan/hari rata-rata), supaya cap tidak memicu pada hari normal.

// Total pesan keluar per hari dari nomor bot, SEMUA user. Tanpa ini, 1.000 user
// gratis x 5 catatan = 5.000 pesan/hari dari satu nomor tanpa ada yang sadar.
export const GLOBAL_DAILY_OUTBOUND_CAP = 500;

// Total pesan keluar per jam dari nomor bot. Cap per jam lebih dekat ke sinyal
// "spam" daripada cap per hari: 500 pesan dalam 1 jam jauh lebih mencurigakan
// daripada 500 pesan tersebar sepanjang hari.
export const GLOBAL_HOURLY_OUTBOUND_CAP = 60;

// Jam tenang (WIB). Bot tetap MENYIMPAN transaksi di jam ini, hanya tidak
// membalas. Balasan otomatis jam 2 pagi adalah pola bot yang paling cepat
// kena flag, dan juga paling membosankan buat user.
export const QUIET_HOURS_START = 22;
export const QUIET_HOURS_END = 6;

// Warm-up: menit pertama setelah server start (atau setelah gateway sempat
// gagal) pengiriman diperlambat. Device yang baru connect / reconnect punya
// riwayat fisik baru; langsung tembak 60 pesan/jam di menit pertama itu yang
// bikin WA menandai device.
export const WARMUP_MINUTES = 60;

// Jeda antar pesan saat warm-up aktif (detik). Jauh lebih lambat dari 1,1 detik
// normal supaya burst pertama tidak terlihat seperti bot.
export const WARMUP_SEND_GAP_MS = 8_000;

// Cap per jam selama warm-up aktif.
export const WARMUP_HOURLY_CAP = 10;

// Circuit breaker: berapa kali gagal berturut-turut sebelum semua pengiriman
// dihentikan sementara.
export const CIRCUIT_FAIL_THRESHOLD = 3;

// Durasi pause circuit breaker (menit) untuk kegagalan pertama. Kegagalan
// berikutnya memakai kelipatan ganjil (10 -> 30 -> 40, dibatasi CIRCUIT_MAX).
export const CIRCUIT_BASE_PAUSE_MINUTES = 10;
export const CIRCUIT_MAX_PAUSE_MINUTES = 40;

// Timeout satu request ke gateway (ms). TANPA ini satu fetch yang menggantung
// memblokir `outboundChain` selamanya: semua pesan setelahnya antre tapi tidak
// pernah dikirim, tanpa error apa pun yang terlihat.
export const GATEWAY_TIMEOUT_MS = 20_000;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const getGlobalDailyOutboundCap = () =>
  envInt("GLOBAL_DAILY_OUTBOUND_CAP", GLOBAL_DAILY_OUTBOUND_CAP);
export const getGlobalHourlyOutboundCap = () =>
  envInt("GLOBAL_HOURLY_OUTBOUND_CAP", GLOBAL_HOURLY_OUTBOUND_CAP);
export const getWarmupMinutes = () => envInt("WA_WARMUP_MINUTES", WARMUP_MINUTES);
export const getWarmupSendGapMs = () =>
  envInt("WA_WARMUP_SEND_GAP_MS", WARMUP_SEND_GAP_MS);
export const getWarmupHourlyCap = () => envInt("WA_WARMUP_HOURLY_CAP", WARMUP_HOURLY_CAP);
export const getCircuitFailThreshold = () =>
  envInt("WA_CIRCUIT_FAIL_THRESHOLD", CIRCUIT_FAIL_THRESHOLD);
export const getCircuitBasePauseMinutes = () =>
  envInt("WA_CIRCUIT_BASE_PAUSE_MINUTES", CIRCUIT_BASE_PAUSE_MINUTES);
export const getCircuitMaxPauseMinutes = () =>
  envInt("WA_CIRCUIT_MAX_PAUSE_MINUTES", CIRCUIT_MAX_PAUSE_MINUTES);
export const getGatewayTimeoutMs = () => envInt("WA_GATEWAY_TIMEOUT_MS", GATEWAY_TIMEOUT_MS);

export function getQuietHoursStart(): number {
  const value = Number(process.env.QUIET_HOURS_START ?? "");
  return Number.isFinite(value) && value >= 0 && value <= 23
    ? Math.floor(value)
    : QUIET_HOURS_START;
}

export function getQuietHoursEnd(): number {
  const value = Number(process.env.QUIET_HOURS_END ?? "");
  return Number.isFinite(value) && value >= 0 && value <= 23
    ? Math.floor(value)
    : QUIET_HOURS_END;
}

// Limit awal kategori baru yang ditambahkan dari Settings dashboard.
export const DEFAULT_CATEGORY_LIMIT = 500_000;

// Batas pencatatan via WhatsApp per hari (tiap catatan = 1 balasan Fonnte).
// GRATIS cukup untuk kebiasaan harian (rasa "cukup tapi mau lebih"), PRO longgar
// (user tipikal jauh di bawahnya) tapi tetap dibatasi supaya kapasitas Fonnte
// terhitung. Catat manual dari dashboard TIDAK dibatasi (biaya marginal nol).
// Bisa dioverride via env FREE_DAILY_TRANSACTION_LIMIT / PRO_DAILY_TRANSACTION_LIMIT.
export const FREE_DAILY_TRANSACTION_LIMIT = 5;
export const PRO_DAILY_TRANSACTION_LIMIT = 20;

// Limit pemanggilan AI (Gemini) per hari untuk FREE. Berbeda dengan batas
// transaksi: setiap pesan yang butuh parsing AI consuming token-framework ini
// WALAU berakhir "bukan transaksi" (salam, gibberish, dokumen tidak terbaca),
// jadi batas transaksi saja tidak menutup biaya. PRO longgar karena nilainya
// jauh di bawah kapasitas gateway.
export const FREE_DAILY_AI_PARSE_LIMIT = 10;
export const PRO_DAILY_AI_PARSE_LIMIT = 60;

export function getFreeDailyAiParseLimit(): number {
  const fromEnv = Number(process.env.FREE_DAILY_AI_PARSE_LIMIT ?? "");
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? Math.floor(fromEnv)
    : FREE_DAILY_AI_PARSE_LIMIT;
}

export function getProDailyAiParseLimit(): number {
  const fromEnv = Number(process.env.PRO_DAILY_AI_PARSE_LIMIT ?? "");
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? Math.floor(fromEnv)
    : PRO_DAILY_AI_PARSE_LIMIT;
}

// Helper: ambil nilai limit dengan override env bila ada.
export function getFreeDailyTransactionLimit(): number {
  const fromEnv = Number(process.env.FREE_DAILY_TRANSACTION_LIMIT ?? "");
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? Math.floor(fromEnv)
    : FREE_DAILY_TRANSACTION_LIMIT;
}

export function getProDailyTransactionLimit(): number {
  const fromEnv = Number(process.env.PRO_DAILY_TRANSACTION_LIMIT ?? "");
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? Math.floor(fromEnv)
    : PRO_DAILY_TRANSACTION_LIMIT;
}