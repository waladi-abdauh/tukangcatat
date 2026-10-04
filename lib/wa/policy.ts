// Gerbang kebijakan outbound: satu-satunya tempat yang memutuskan boleh-tidaknya
// nomor bot mengirim pesan pada detik ini.
//
// Kenapa file ini ada: pengaman anti-blokir yang tersebar di banyak modul
// (= mudah lupa, gampang tidak kena). Semua keputusan dikumpulkan di sini
// supaya urutan prioritasnya eksplisit dan bisa diuji.
//
// Urutan pemeriksaan (berurutan, berhenti di guard pertama yang menolak):
//   1. Kill switch     — device terblokir? semua pengiriman stop.
//   2. Circuit breaker — gateway gagal berulang? tunggu, jangan menambah
//                        tekanan ke device yang sedang bermasalah.
//   3. Quiet hours     — jam 22:00-06:00 WIB, simpan tanpa membalas.
//   4. Warm-up         — menit pertama setelah start/reconnect, kirim pelan.
//   5. Volume cap      — 500/hari + 60/jam dari nomor bot (atomik, di DB).
//
// PENTING: guard di sini hanya menahan PENGIRIMAN. Transaksi sudah disimpan
// sebelum policy dipanggil, jadi data user tidak hilang Coronary saat jam sepi.
import { serviceRoleClient } from "../supabase/service-role";
import {
  getCircuitBasePauseMinutes,
  getCircuitFailThreshold,
  getCircuitMaxPauseMinutes,
  getGlobalDailyOutboundCap,
  getGlobalHourlyOutboundCap,
  getQuietHoursEnd,
  getQuietHoursStart,
  getWarmupHourlyCap,
  getWarmupMinutes,
  getWarmupSendGapMs,
} from "../constants";

// Error "kebijakan", BUKAN error jaringan. Penyerang yang sama persis, tapi
// tidak boleh memicu circuit breaker (tidak ada yang gagal) dan tidak boleh
// memicu balasan error ke user (justru itu yang akan menambah volume).
export class WaSuppressedError extends Error {
  constructor(
    readonly reason:
      | "device_blocked"
      | "circuit_open"
      | "quiet_hours"
      | "warmup_cap"
      | "daily_cap"
      | "hourly_cap"
      | "counter_unavailable",
    message: string
  ) {
    super(message);
    this.name = "WaSuppressedError";
  }
}

// ===== Jam WIB =====

// Jam (0-23) dalam zona WIB. User Indonesia ada di WIB, jadi kap dan jam tenang
// harus dihitung di zona yang sama dengan user.
export function nowWIBHourAndMinute(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hour, minute };
}

// Tanggal WIB (YYYY-MM-DD) untuk penghitung harian.
export function wibDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(new Date());
}

// Jam tenang bisa melintasi tengah malam (22 -> 6), jadi rentangnya dibelah dua
// supaya tidak ada kondisi "start > end" yang selalu salah.
export function isQuietHoursWIB(now = new Date()): boolean {
  const { hour } = nowWIBHourAndMinute(now);
  const start = getQuietHoursStart();
  const end = getQuietHoursEnd();
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

// ===== Warm-up =====

// Warm-up dimulai saat proses start, dan diulang setiap kali circuit breaker
// selesai membuka (device kemungkinan besar sempat putus / reconnect — riwayat
// fisiknya baru, jadi kirimannya harus pelan lagi).
let warmupUntil = Date.now() + getWarmupMinutes() * 60_000;

export function isWarmingUp(): boolean {
  return Date.now() < warmupUntil;
}

export function resetWarmup(): void {
  warmupUntil = Date.now() + getWarmupMinutes() * 60_000;
}

// Jeda antar pesan yang berlaku sekarang: 8 detik saat warm-up, 1,1+ detik biasanya.
export function currentSendGapMs(): number {
  return isWarmingUp() ? getWarmupSendGapMs() : 1_100;
}

// ===== Circuit breaker =====

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
}
const breaker: BreakerState = { consecutiveFailures: 0, openUntil: 0 };

export function isCircuitOpen(): boolean {
  return Date.now() < breaker.openUntil;
}

export function circuitOpenMinutesRemaining(): number {
  if (!isCircuitOpen()) return 0;
  return Math.ceil((breaker.openUntil - Date.now()) / 60_000);
}

// Dipanggil saat satu pengiriman gagal karena gateway (bukan karena policy).
// 3 gagal berturut -> pause 10 menit; berikutnya 30, lalu 40 (maks).
export function recordGatewayFailure(): void {
  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures < getCircuitFailThreshold()) return;

  const base = getCircuitBasePauseMinutes();
  const attempt = breaker.consecutiveFailures - getCircuitFailThreshold();
  // Kelipatan ganjil: 10 -> 30 -> 50, dipotong di CIRCUIT_MAX (40).
  const minutes = Math.min(base + attempt * base * 2, getCircuitMaxPauseMinutes());
  breaker.openUntil = Date.now() + minutes * 60_000;
  resetWarmup();
  console.error(
    `[wa-policy] circuit breaker OPEN selama ${minutes} menit ` +
      `(${breaker.consecutiveFailures} gagal berturut-turut)`
  );
}

export function recordGatewaySuccess(): void {
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

// Dipanggil script verifikasi untuk menguji breaker tanpa menunggu 10 menit.
export function forceCircuitOpen(minutes: number): void {
  breaker.consecutiveFailures = getCircuitFailThreshold();
  breaker.openUntil = Date.now() + minutes * 60_000;
}

export function resetBreakerForTest(): void {
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
  warmupUntil = 0;
}

// ===== Kill switch device =====

// Cache singkat supaya route tidak memanggil DB pada setiap pesan. Status tetap
// dicek ulang setelah TTL supaya block yang baru saja terjadi tidak menunggu
// cache expired.
let killSwitchCache: { status: string; checkedAt: number } | null = null;
const KILL_SWITCH_TTL_MS = 5_000;

async function deviceIsBlocked(): Promise<boolean> {
  if (killSwitchCache && Date.now() - killSwitchCache.checkedAt < KILL_SWITCH_TTL_MS) {
    return killSwitchCache.status === "blocked";
  }
  const { data, error } = await serviceRoleClient.rpc("get_gateway_status");
  if (error) {
    // Migration belum jalan: fail-open. Mematikan seluruh outbound karena
    // tabel tidak ada akan mematikan produk, dan itu lebih buruk daripada
    // kehilangan satu lapis pengaman.
    console.error("[wa-policy] get_gateway_status gagal:", error.message);
    return false;
  }
  const status = (data as string | null) ?? "ok";
  killSwitchCache = { status, checkedAt: Date.now() };
  return status === "blocked";
}

// Dipanggil client.ts ketika body error gateway mencurigakan (keyword blokir /
// disconnect / token mati). Setelah ini semua pengiriman berhenti sampai
// operator-or-auto-recover mengosongkan switch.
export async function markDeviceBlocked(detail: string): Promise<void> {
  console.error(`[wa-policy] NOMOR BOT MASALAH — outbound dihentikan: ${detail}`);
  const { error } = await serviceRoleClient.rpc("mark_gateway_blocked", {
    p_detail: detail.slice(0, 300),
  });
  if (error) {
    console.error("[wa-policy] mark_gateway_blocked gagal:", error.message);
  }
  // Cache lokal ikut di-set supaya pengiriman berikutnya langsung berhenti
  // tanpa menunggu satu TTL penuh.
  killSwitchCache = { status: "blocked", checkedAt: Date.now() };
}

export async function clearDeviceBlock(): Promise<void> {
  const { error } = await serviceRoleClient.rpc("clear_gateway_blocked");
  if (error) {
    console.error("[wa-policy] clear_gateway_blocked gagal:", error.message);
  }
  killSwitchCache = { status: "ok", checkedAt: Date.now() };
  resetWarmup();
}

// Berapa lama kill switch ditahan sebelum device layak dicek ulang. Terlalu
// pendek = kita menekan device yang memang benar-benar terblokir; terlalu
// lama = device yang sempat reconnect sendiri diam berjam-jam.
//
// Probe-nya BUKAN kirim pesan: dia hanya membaca status device, tidak
// menyentuh API kirim WA. Karena itu probe dini aman.
const RECOVER_PROBE_MINUTES = 15;

let lastProbeAt = 0;

// Dipanggil dari cron health-check. Kill switch diputuskan dari keadaan device
// yang sebenarnya, sehingga device yang sempat reconnect (scan QR ulang) langsung
// melayani lagi tanpa perlu deploy ulang.
export async function reconcileDeviceHealth(
  device: { connected: boolean; active: boolean }
): Promise<"cleared" | "blocked" | "unchanged"> {
  const { data: current } = await serviceRoleClient.rpc("get_gateway_status");
  const wasBlocked = current === "blocked";
  const healthy = device.connected && device.active;

  // Device sehat -> nyalakan lagi lampunya.
  if (healthy && wasBlocked) {
    await clearDeviceBlock();
    console.error("[wa-policy] device sudah terhubung lagi - outbound dipulihkan");
    return "cleared";
  }

  // Device tidak sehat -> pasang kill switch. Idempoten, jadi aman dipanggil
  // di setiap jalan cron.
  if (!healthy && !wasBlocked) {
    await markDeviceBlocked(
      `health-check: connected=${device.connected} active=${device.active}`
    );
    return "blocked";
  }

  return "unchanged";
}

// Apakah kill switch sudah boleh dicek ulang.
export function canProbeDevice(): boolean {
  return Date.now() - lastProbeAt >= RECOVER_PROBE_MINUTES * 60_000;
}

export function markProbeAttempted(): void {
  lastProbeAt = Date.now();
}

// ===== Volume cap =====

// Klaim satu jatah kirim. Mengembalikan false bila cap harian ATAU per jam sudah
// habis. `p_hourlyLimit` sudah termasuk efek warm-up (dipanggil pemanggilnya).
export async function claimOutboundSlot(
  hourlyLimit = getGlobalHourlyOutboundCap()
): Promise<boolean> {
  const date = wibDateKey();
  const { hour } = nowWIBHourAndMinute();

  const { data, error } = await serviceRoleClient.rpc("claim_wa_outbound", {
    p_date: date,
    p_hour: hour,
    p_daily_limit: getGlobalDailyOutboundCap(),
    p_hourly_limit: hourlyLimit,
  });

  if (error) {
    // Migration belum jalan atau RPC gagal: fail-open supaya user tidak
    // kehilangan balasan karena masalah infrastruktur. Log loudly supaya
    // ketahuan (kesalahan diam-diam di sini = kita kembali tanpa cap global).
    console.error("[wa-policy] claim_wa_outbound gagal:", error.message);
    return true;
  }
  return data === true;
}

// Membaca pemakaian hari ini untuk monitoring (dipakai script verifikasi dan
// endpoint health-check).
export async function getOutboundUsageToday(): Promise<{ date: string; daily: number; hours: Array<{ hour: number; count: number }> }> {
  const date = wibDateKey();
  const { data, error } = await serviceRoleClient
    .from("wa_outbound_usage")
    .select("hour_slot, send_count")
    .eq("used_date", date);
  if (error) {
    console.error("[wa-policy] getOutboundUsageToday gagal:", error.message);
    return { date, daily: 0, hours: [] };
  }
  const rows = (data ?? []) as Array<{ hour_slot: number; send_count: number }>;
  return {
    date,
    daily: rows.find((r) => r.hour_slot === -1)?.send_count ?? 0,
    hours: rows
      .filter((r) => r.hour_slot >= 0)
      .map((r) => ({ hour: r.hour_slot, count: r.send_count })),
  };
}

// ===== Pintu masuk utama =====

// Dipanggil client.ts tepat sebelum setiap pengiriman. Melempar
// WaSuppressedError bila policy menolak; pemanggil wajib memperlakukannya
// sebagai "tidak jadi kirim", bukan sebagai kegagalan sistem.
export async function assertOutboundAllowed(): Promise<void> {
  if (await deviceIsBlocked()) {
    throw new WaSuppressedError(
      "device_blocked",
      "Nomor bot ditandai bermasalah — outbound dihentikan"
    );
  }

  if (isCircuitOpen()) {
    throw new WaSuppressedError(
      "circuit_open",
      `Gateway bermasalah, jeda ${circuitOpenMinutesRemaining()} menit lagi`
    );
  }

  if (isQuietHoursWIB()) {
    throw new WaSuppressedError(
      "quiet_hours",
      `Jam tenang ${getQuietHoursStart()}:00-${String(getQuietHoursEnd()).padStart(2, "0")}:00 WIB — transaksi tetap tersimpan, balasan ditahan`
    );
  }

  // Warm-up memakai cap per jam yang lebih ketat, bukan jeda saja: jeda 8 detik
  // dengan 60 pesan/jam masih 450 pesan/jam kalau antreannya panjang.
  const hourlyLimit = isWarmingUp() ? getWarmupHourlyCap() : getGlobalHourlyOutboundCap();
  if (!(await claimOutboundSlot(hourlyLimit))) {
    const limit = isWarmingUp() ? getWarmupHourlyCap() : getGlobalHourlyOutboundCap();
    throw new WaSuppressedError(
      isWarmingUp() ? "warmup_cap" : "hourly_cap",
      `Volume pesan keluar sudah menyentuh batas ${limit}/jam (waktu WIB ${nowWIBHourAndMinute().hour}:00)`
    );
  }
}