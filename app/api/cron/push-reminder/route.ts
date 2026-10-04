// Vercel Cron: kirim notifikasi pengingat nyatet (web push) ke user yang
// jadwalnya sudah tiba hari ini (WIB). Disarankan jadwal tiap 15 menit
// (vercel.json — urusan Step 9). Guard: Authorization Bearer CRON_SECRET.
// Idempoten: klaim atomik lewat sent_alerts (claim-then-send) memastikan
// maksimal 1 pengingat/user/hari walau dua invocation cron overlap.
// Body DINAMIS: angka pengeluaran user hari itu (dari database).
import { NextResponse, type NextRequest } from "next/server";
import { guardCron } from "../../../../lib/security/cron-guard";
import { serviceRoleClient } from "../../../../lib/supabase/service-role";
import { ensureVapid, sendWebPushToUser } from "../../../../lib/wa/push";
import { computeDailySummary } from "../../../../lib/dash/budgets";
import { formatIDR, todayID } from "../../../../lib/utils";

// Jam sekarang zona WIB, format HH:MM.
function nowWIBHHMM(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export async function GET(request: NextRequest) {
  const denied = guardCron(request);
  if (denied) return denied;

  try {
    ensureVapid();
  } catch (err) {
    console.error("[cron push-reminder]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "konfigurasi push belum lengkap" },
      { status: 503 }
    );
  }

  const now = nowWIBHHMM();
  const today = todayID();

  // User dengan pengingat aktif yang jamnya sudah lewat hari ini
  // dan belum dikirimi hari ini.
  const { data: profilesRes } = await serviceRoleClient
    .from("profiles")
    .select("id, reminder_time, reminder_last_sent")
    .not("reminder_time", "is", null);
  const due = ((profilesRes ?? []) as unknown as Array<{
    id: string;
    reminder_time: string | null;
    reminder_last_sent: string | null;
  }>).filter(
    (u) =>
      u.reminder_time != null &&
      u.reminder_time <= now &&
      String(u.reminder_last_sent ?? "") < today
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of due) {
    // Klaim dulu, baru kirim. Sebelumnya ini read-then-write
    // (filter di atas, update di bawah), jadi dua invocation yang overlap —
    // cron retry yang jalan sebelum yang pertama selesai, atau dua instance
    // server — bisa dua-duanya lolos filter dan mengirim dua push.
    // Pola claim-then-send yang sama sudah dipakai untuk sent_alerts di
    // app/api/webhook/whatsapp/route.ts.
    const { data: claimed } = await serviceRoleClient
      .from("sent_alerts")
      .upsert(
        {
          user_id: user.id,
          kind: "reminder",
          key: "push",
          sent_date: today,
        },
        { onConflict: "user_id,kind,key,sent_date", ignoreDuplicates: true }
      )
      .select("id");
    if (!claimed || claimed.length === 0) {
      skipped++;
      continue;
    }

    // Body dinamis: rekap asli pengeluaran user hari itu.
    const { dailyTotal, monthlyRemaining } = await computeDailySummary(
      user.id,
      today
    );
    const body =
      dailyTotal > 0
        ? `Hari ini udah ${formatIDR(dailyTotal)} — sisa bulan ini ${formatIDR(monthlyRemaining)} ✍️`
        : "Belum ada catatan hari ini — ada pengeluaran? Catat yuk ✍️";

    const anySent = await sendWebPushToUser(user.id, {
      body,
      url: "/dash",
    });
    if (anySent) {
      sent++;
    } else {
      // Tidak ada langganan aktif (belum pasang PWA / semua mati).
      failed++;
    }

    // Tandai terkirim SETELAH PERCOBAAN PERTAMA hari ini (apa pun hasilnya)
    // — anti retry storm: langganan bermasalah tidak dicoba ulang tiap
    // 15 menit seharian. Kegagalan transien ditutupi cron besok.
    await serviceRoleClient
      .from("profiles")
      .update({ reminder_last_sent: today })
      .eq("id", user.id);
  }

  return NextResponse.json({ status: "ok", due: due.length, sent, skipped, failed });
}