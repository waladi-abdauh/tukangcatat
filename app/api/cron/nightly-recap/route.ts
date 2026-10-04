// Cron: rekap malam harian ke pengguna PRO.
//
// STATUS: BELUM IMPLEMENTASI SENGAJA. Stub ini dijaga eksplisit supaya tidak
// diimplementasikan tanpa pengaman.
//
// Pesan broadcast WA jauh lebih cepat sampai ke penerima daripada chat yang
// dibalas. Rekap ini akan dikirim ke SEMUA user PRO tanpa mereka minta,
// tanpa jam tenang, tanpa cap volume per device, dan tanpa idempotensi per
// user. Itu kombinasi yang paling cepat memicu pemblokiran nomor.
//
// Kalau nanti Step 8 dikerjakan, SEMUA hal ini harus ada dulu:
//
// 1. Kirim lewat lib/wa/policy.ts (assertOutboundAllowed), bukan fetch langsung,
//    supaya jam tenang + cap 500/hari + 60/jam otomatis berlaku.
// 2. Jadwalkan di luar jam tenang (misal 20:00 WIB) DAN cek ulang zona WIB
//    di dalam route, bukan hanya di baris crontab.
// 3. Idempotensi per user per tanggal: pakai pola claim-then-send yang sudah
//    ada (upsert ignoreDuplicates, lihat lib/wa/policy.ts & sent_alerts).
//    Tanpa ini, satu cron yang di-retry mengirim rekap dua kali ke semua PRO.
// 4. Potong daftar agar tidak meledak: kirim per batch dengan jeda, bukan satu
//    request berisi ribuan nomor. Antrean in-process di lib/wa/client.ts juga
//    punya batas maxDuration yang harus dihormati.
// 5. Hormati opt-out dan DAILY_REPLY_CAP per user.
import { NextResponse, type NextRequest } from "next/server";
import { guardCron } from "../../../../lib/security/cron-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guardCron(request);
  if (denied) return denied;
  return NextResponse.json({
    status: "not_implemented",
    reason: "Rekap via WA butuh guard anti-blokir lebih dulu; lihat komentar di file ini.",
  });
}
