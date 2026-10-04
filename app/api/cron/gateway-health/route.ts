// Cron: cek kesehatan device WhatsApp + pulihkan kill switch otomatis.
//
// KAPAN JALANKAN: tiap 15 menit lewat cron sistem di server produksi, misal
//   */15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
//     https://<domain-anda>/api/cron/gateway-health
//
// Kenapa perlu: tanpa cron ini, device yang terblokir atau disconnect hanya
// ketahuan kalau ada yang membaca log. Bot akan tetap menerima pesan, tetap
// memanggil Gemini (bayar), tetap menyimpan transaksi — tapi tidak ada yang
// sampai ke user. Cron ini menutup loop itu.
//
// Catatan: cron ini TIDAK mengirim pesan. Dia hanya membaca status device,
// jadi aman dijalankan tanpa risiko menambah volume outbound.
import { NextResponse, type NextRequest } from "next/server";
import { guardCron } from "../../../../lib/security/cron-guard";
import { checkDeviceHealth } from "../../../../lib/wa/device-status";
import {
  canProbeDevice,
  getOutboundUsageToday,
  markProbeAttempted,
  reconcileDeviceHealth,
} from "../../../../lib/wa/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const denied = guardCron(request);
  if (denied) return denied;

  // Volume hari ini ikut dilaporkan supaya cap yang menyentuh batas kelihatan
  // tanpa harus buka dashboard atau query SQL manual.
  const usage = await getOutboundUsageToday();

  try {
    const probe = await checkDeviceHealth();

    // Gateway tanpa endpoint status (Fonnte) tidak boleh dianggap bermasalah.
    if (!probe.checked) {
      return NextResponse.json({
        status: "unknown",
        reason: probe.reason,
        usage,
      });
    }

    // Tidak memaksa probe terlalu sering supaya device yang benar-benar
    // terblokir tidak terus ditekan.
    if (!canProbeDevice()) {
      return NextResponse.json({ status: "throttled", usage });
    }
    markProbeAttempted();

    const decision = await reconcileDeviceHealth({
      connected: probe.status.connected,
      active: probe.status.active,
    });

    return NextResponse.json({
      status: decision,
      device: {
        connected: probe.status.connected,
        active: probe.status.active,
        quota: probe.status.quota,
        expiredDate: probe.status.expiredDate,
      },
      usage,
    });
  } catch (err) {
    // Gagal cek TIDAK berarti device bermasalah. Mematikan outbound karena
    // endpoint status tidak bisa dijangkau akan mematikan produk, dan itu
    // jauh lebih buruk daripada kehilangan satu lapis deteksi.
    console.error("[cron] gateway-health gagal:", err);
    return NextResponse.json(
      { status: "check_failed", reason: String(err), usage },
      { status: 200 }
    );
  }
}