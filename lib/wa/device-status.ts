// Pengecek kesehatan device WhatsApp (gateway).
//
// Kenapa perlu: kalau nomor bot terblokir atau device disconnect, bot tetap
// menerima pesan, tetap memanggil Gemini (bayar), tetap menyimpan transaksi —
// tapi tidak ada yang sampai ke user. Selama ini itu baru ketahuan kalau ada
// yang membaca log. Modul ini membuat device yang bermasalah bisa dideteksi
// otomatis dan memicu kill switch (lihat lib/wa/policy.ts).
import { getGatewayTimeoutMs } from "../constants";

export interface DeviceStatus {
  connected: boolean;
  active: boolean;
  quota: number | null;
  expiredDate: string | null;
  raw: string;
}

function wablasEndpoint(): string {
  const base = (process.env.WA_WABLAS_ENDPOINT ?? "").trim();
  if (!base) throw new Error("WA_WABLAS_ENDPOINT belum diisi");
  return base.replace(/\/+$/, "");
}

// GET {endpoint}/api/device/info?token=...
//
// Response Wablas (dari dokumentasi resmi):
//   { status: true, data: { sender, quota, expired_date, active, status } }
// `data.status` bernilai "connected" atau "disconnected".
export async function fetchWablasDeviceStatus(): Promise<DeviceStatus> {
  const token = process.env.WA_WABLAS_TOKEN;
  if (!token) throw new Error("WA_WABLAS_TOKEN belum diisi");

  const url = `${wablasEndpoint()}/api/device/info?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: token },
    signal: AbortSignal.timeout(getGatewayTimeoutMs()),
  });

  const body = (await res.text().catch(() => "")).slice(0, 300);
  if (!res.ok) {
    throw new Error(`device/info gagal (${res.status}): ${body}`);
  }

  // Tanpa initializer: kalau ditulis `let parsed: T | null = null`, TS
  // menyempitkan `parsed` jadi `null` setelah blok try/catch di bawah dan
  // `parsed.data` jadi error, padahal jalur catch selalu throw.
  let parsed: { status?: unknown; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new Error(`device/info balasan bukan JSON: ${body}`);
  }

  const data = parsed.data ?? {};
  const statusText = String(data.status ?? "").toLowerCase();
  const quota = Number(data.quota);

  return {
    connected: statusText === "connected",
    active: data.active === true,
    quota: Number.isFinite(quota) ? quota : null,
    expiredDate: data.expired_date ? String(data.expired_date) : null,
    raw: body,
  };
}

// Satu titik masuk untuk cek device: Fonnte belum punya endpoint status
// yang sama, jadi di sini Fonnte dianggap "tidak bisa dicek" (bukan "buruk") —
// pemanggil tidak boleh mematikan kill switch karena gateway tidak bisa dicek.
export async function checkDeviceHealth(): Promise<
  { checked: true; status: DeviceStatus } | { checked: false; reason: string }
> {
  if ((process.env.WA_GATEWAY ?? "fonnte") !== "wablas") {
    return {
      checked: false,
      reason: `Gateway ${process.env.WA_GATEWAY ?? "fonnte"} belum punya endpoint status device`,
    };
  }
  return { checked: true, status: await fetchWablasDeviceStatus() };
}