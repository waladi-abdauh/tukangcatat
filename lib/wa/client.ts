// WA Gateway: adapter outbound message (swappable: fonnte | wablas | meta-cloud).
// Implementasi konkret tiap gateway; interface wajib dipertahankan agar migrasi
// hanya menambah 1 file adapter baru.
//
// Semua gateway melewati `enqueue` yang sama. `enqueue` adalah antrean PADA
// SATU PROSES: pacing ~1 detik mencegah burst ke device WA, dan seluruh
// keputusan anti-blokir (quiet hours, warm-up, volume cap, kill switch) diambil
// di lib/wa/policy.ts tepat sebelum setiap pengiriman.
//
// Batas yang diketahui dan sengaja diterima: antrean ini in-process, jadi
// hilang saat restart dan tidak dibagi antar proses. cluster PM2 atau
// serverless membuat tiap proses mengirim dengan ritmenya sendiri sehingga
// pacing & cap terlipat ganda. Inilah alasan ecosystem.config.js dipaksa
// instances: 1 — lihat assertion di bawah.

// Kontrak adapter pengiriman pesan keluar.
export interface WAOutboundAdapter {
  sendText(to: string, message: string, refId?: string): Promise<void>;
  sendMedia(to: string, url: string, caption?: string, refId?: string): Promise<void>;
}

// ===== Antrean (per-proses) =====

// SEMUA kirim WA berjarak ~1 detik supaya tidak ada burst serentak ke device
// (sinyal spam Meta). Jitter mencegah ritme terlalu mesinik. Selama warm-up
// jeda dibuat jauh lebih panjang — device yang baru connect perlu pelan.
import { getGatewayTimeoutMs } from "../constants";
import {
  assertOutboundAllowed,
  currentSendGapMs,
  isWarmingUp,
  markDeviceBlocked,
  recordGatewayFailure,
  recordGatewaySuccess,
  WaSuppressedError,
} from "./policy";

let outboundChain: Promise<unknown> = Promise.resolve();
// Jeda basic TIDAK ditulis di sini: currentSendGapMs() dari ./policy yang
// menentukan, supaya warm-up bisa memperlambat jeda tanpa menyentuh client.
const SEND_JITTER_MS = 400;

// Milidetik acak supaya jeda tidak persis sama tiap pesan. Tidak dipakai saat
// warm-up: pola "lalu + jitter" lebih mudah dikenali gateway daripada pola tetap.
function jitterMs(): number {
  return Math.floor(Math.random() * SEND_JITTER_MS);
}

// Guard: kalau aplikasi benar-benar dijalankan multi-proses, pacing in-process
// di atas tidak berlaku dan device akan menerima burst dari tiap proses.
// Lebih baik diperingatkan saat boot daripada diam-diam kehilangan pengaman.
if (process.env.WA_ALLOW_MULTI_PROCESS === "1") {
  console.warn(
    "[wa] WA_ALLOW_MULTI_PROCESS=1 - pacing & volume cap hanya berlaku per proses"
  );
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = outboundChain.then(async () => {
    // Policy diambil sebelum jeda: pesan yang ditolak quiet hours tidak perlu
    // menunggu giliran antrean dan tidak menghabiskan jatah volume.
    await assertOutboundAllowed();
    await new Promise((resolve) =>
      setTimeout(resolve, currentSendGapMs() + (isWarmingUp() ? 0 : jitterMs()))
    );
    return task().then(
      (value) => {
        recordGatewaySuccess();
        return value;
      },
      (err) => {
        // Suppressed = policy menolak, gateway tidak pernah dipanggil. Tidak
        // boleh dihitung sebagai kegagalan (tidak ada yang salah).
        if (err instanceof WaSuppressedError) throw err;
        recordGatewayFailure();
        throw err;
      }
    );
  });
  outboundChain = run.catch(() => undefined);
  return run;
}

// Kredensial dipisah per gateway (WA_FONNTE_TOKEN / WA_WABLAS_TOKEN) alih-alih
// satu WA_GATEWAY_TOKEN yang ditimpa saat cutover. Alasannya operasional:
// pindah gateway = ganti WA_GATEWAY saja, tanpa downtime dan tanpa risiko
// salah paste token (salah token = bot berhenti balas di tengah jalan).
function gatewayToken(gateway: "fonnte" | "wablas"): string {
  const value =
    gateway === "wablas"
      ? process.env.WA_WABLAS_TOKEN
      : process.env.WA_FONNTE_TOKEN ?? process.env.WA_GATEWAY_TOKEN;
  if (!value) {
    throw new Error(
      gateway === "wablas"
        ? "WA_WABLAS_TOKEN belum diisi di .env.local"
        : "WA_FONNTE_TOKEN belum diisi di .env.local"
    );
  }
  return value;
}

// Body form-encoded; dipakai Wablas yang menolak multipart.
function formBody(fields: Record<string, string | number | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

// ===== Deteksi nomor bermasalah =====

// Keyword yang menandakan nomor bot bermasalah, BUKAN error transient. Bedanya
// penting: "timeout" layak dicoba lagi, sedangkan "token invalid" atau "device
// disconnected" akan gagal terus sampai manusia turun tangan — dan selama itu
// semua pengiriman hanya memperburuk kondisi device.
const BLOCK_KEYWORDS = [
  "block",
  "terblokir",
  "banned",
  "ban ",
  "disconnect",
  "offline",
  "not connected",
  "token invalid",
  "invalid token",
  "unauthorized",
  "forbidden",
  "session not",
  "not allowed",
] as const;

function looksLikeBlock(detail: string): boolean {
  const text = detail.toLowerCase();
  return BLOCK_KEYWORDS.some((kw) => text.includes(kw));
}

// Menandai error sebagai "nomor bermasalah" supaya policy menghentikan seluruh
// outbound (kill switch) alih-alih retry Buta.
async function readGatewayError(gateway: string, res: Response): Promise<never> {
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  const message = `${gateway} gagal (${res.status}): ${detail}`;
  if (looksLikeBlock(detail)) {
    await markDeviceBlocked(`${gateway} ${res.status}: ${detail}`);
  }
  throw new Error(message);
}

// ===== Fonnte =====

// Mengirim pesan via Fonnte: POST https://api.fonnte.com/send
// Header Authorization memakai token device tanpa "Bearer".
async function sendFonnte(
  fields: Record<string, string | number>
): Promise<void> {
  const token = gatewayToken("fonnte");
  const endpoint =
    process.env.WA_GATEWAY_ENDPOINT ?? "https://api.fonnte.com";

  // PENTING: Fonnte tetap memakai multipart FormData seperti implementasi
  // awal. Jangan diubah ke form-encoded — jalur ini sedang dipakai device
  // produksi dan tidak boleh diregressi saat migrasi Wablas.
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, String(value));
  }

  const res = await fetch(`${endpoint}/send`, {
    method: "POST",
    headers: { Authorization: token },
    body,
    signal: AbortSignal.timeout(getGatewayTimeoutMs()),
  });

  if (!res.ok) await readGatewayError("Fonnte send", res);
}

export class FonnteAdapter implements WAOutboundAdapter {
  async sendText(to: string, message: string, refId?: string): Promise<void> {
    await enqueue(() =>
      sendFonnte({ target: to, message, ...(refId ? { ref_id: refId } : {}) })
    );
  }

  async sendMedia(
    to: string,
    url: string,
    caption?: string,
    refId?: string
  ): Promise<void> {
    await enqueue(() =>
      sendFonnte({
        target: to,
        url,
        message: caption ?? "",
        ...(refId ? { ref_id: refId } : {}),
      })
    );
  }
}

// ===== Wablas =====

// Batas keras Wablas untuk media keluar (dokumentasi: max 2MB per file).
const WABLAS_MEDIA_MAX_BYTES = 2 * 1024 * 1024;

// Endpoint Wablas dipilih dari tipe media; nama field mengikuti dokumentasi
// (image/audio/video/document), bukan satu field generik. Wablas hanya menerima
// jpg/jpeg/png untuk send-image dan mp3/ogg/mpga untuk send-audio.
function wablasMediaRoute(url: string): { path: string; field: string } {
  const ext = (url.split("?")[0]!.split("#")[0]!.split(".").pop() ?? "")
    .toLowerCase();
  if (["jpg", "jpeg", "png"].includes(ext)) {
    return { path: "send-image", field: "image" };
  }
  if (["mp3", "ogg", "mpga"].includes(ext)) {
    return { path: "send-audio", field: "audio" };
  }
  if (["mp4", "3gp", "mov"].includes(ext)) {
    return { path: "send-video", field: "video" };
  }
  // Gambar lain (webp/gif/heic) akan gagal diam-diam bila dikirim sebagai
  // document; lebih baik gagal sekarang dengan pesan yang bisa ditindaklanjuti.
  if (["webp", "gif", "heic", "heif"].includes(ext)) {
    throw new Error(
      `Format .${ext} tidak didukung Wablas (butuh jpg/jpeg/png). Konversi dulu.`
    );
  }
  return { path: "send-document", field: "document" };
}

// Guard ukuran: Wablas menolak media >2MB dengan error yang tidak jelas.
// Dicek lewat HEAD dulu agar kegagalan punya pesan yang bisa ditindaklanjuti.
async function assertWablasMediaSize(url: string): Promise<void> {
  let size: number | null = null;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(getGatewayTimeoutMs()),
    });
    const len = res.headers.get("content-length");
    if (res.ok && len) size = Number(len);
  } catch {
    return; // HEAD tidak didukung host ini - biarkan Wablas yang menolak.
  }
  if (size !== null && Number.isFinite(size) && size > WABLAS_MEDIA_MAX_BYTES) {
    throw new Error(
      `Media ${(size / 1024 / 1024).toFixed(1)}MB melebihi batas Wablas 2MB: ${url}`
    );
  }
}

// Endpoint Wablas WAJIB memakai subdomain akun, bukan wablas.com/api.
// Wablas membalas 403 "API access is not allowed on this server" untuk
// domain generik — tiap akun punya subdomain sendiri (mis. xxx.wablas.com)
// yang tertera di dashboard. Fallback wablas.com sengaja TIDAK dipakai karena
// pasti ditolak.
function wablasEndpoint(): string {
  const base = (process.env.WA_WABLAS_ENDPOINT ?? "").trim();
  if (!base) {
    throw new Error(
      "WA_WABLAS_ENDPOINT belum diisi di .env.local — pakai subdomain " +
        "akun Wablas dari dashboard (format: https://<subdomain>.wablas.com)"
    );
  }
  return base.replace(/\/+$/, "");
}

async function sendWablas(
  path: string,
  fields: Record<string, string | number | undefined>
): Promise<void> {
  const token = gatewayToken("wablas");
  const secret = process.env.WA_WABLAS_SECRET ?? process.env.WA_GATEWAY_SECRET;
  const endpoint = wablasEndpoint();
  if (!token) {
    throw new Error("WA_WABLAS_TOKEN belum diisi di .env.local");
  }
  if (!secret) {
    throw new Error(
      "WA_WABLAS_SECRET belum diisi di .env.local (Wablas butuh token.secret_key)"
    );
  }

  const res = await fetch(`${endpoint}/api/${path}`, {
    method: "POST",
    headers: {
      // Format Wablas: token.secret_key (tanpa "Bearer").
      Authorization: `${token}.${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody(fields),
    signal: AbortSignal.timeout(getGatewayTimeoutMs()),
  });

  if (!res.ok) await readGatewayError("Wablas", res);

  // Wablas balas 200 dengan body {"status":false} saat media melebihi kuota.
  // Status HTTP saja tidak cukup untuk dianggap sukses.
  const payload = (await res.json().catch(() => null)) as {
    status?: unknown;
    message?: unknown;
  } | null;
  if (payload && payload.status !== true) {
    const message = String(payload.message ?? "tidak diketahui");
    // Status false bisa berarti device putus ATAU kuota habis. Bedakan: yang
    // mencurigakan soal blokir adalah device, bukan limit tagihan.
    if (looksLikeBlock(message)) {
      await markDeviceBlocked(`Wablas status=false: ${message}`);
    }
    throw new Error(`Wablas menolak pesan: ${message}`);
  }
}

export class WablasAdapter implements WAOutboundAdapter {
  async sendText(to: string, message: string, refId?: string): Promise<void> {
    await enqueue(() =>
      sendWablas("send-message", { phone: to, message, ref_id: refId })
    );
  }

  async sendMedia(
    to: string,
    url: string,
    caption?: string,
    refId?: string
  ): Promise<void> {
    const route = wablasMediaRoute(url);
    await assertWablasMediaSize(url);
    await enqueue(() =>
      sendWablas(route.path, {
        phone: to,
        [route.field]: url,
        caption,
        ref_id: refId,
      })
    );
  }
}

// ===== Factory =====

// Membuat adapter sesuai WA_GATEWAY (fonnte default).
export function createWAOutboundAdapter(): WAOutboundAdapter {
  const gateway = process.env.WA_GATEWAY ?? "fonnte";
  switch (gateway) {
    case "fonnte":
      return new FonnteAdapter();
    case "wablas":
      return new WablasAdapter();
    case "meta-cloud":
      // TODO Step lanjutan: implementasi adapter Meta Cloud API.
      throw new Error(`Adapater WA_GATEWAY="${gateway}" belum diimplementasikan`);
    default:
      throw new Error(`WA_GATEWAY tidak dikenal: "${gateway}"`);
  }
}
