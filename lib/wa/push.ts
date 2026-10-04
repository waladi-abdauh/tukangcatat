// Web Push (SERVER ONLY): pengiriman notifikasi ke langganan push user.
// Dipakai cron pengingat & alert bocor kategori. Semua "pemberitahuan"
// lewat push — WhatsApp hanya untuk loop nyatet (mengurangi sinyal spam
// device WA: volume burst & pesan identik beruntun antar nomor).
import webpush from "web-push";
import { serviceRoleClient } from "../supabase/service-role";

const VAPID_SUBJECT = "mailto:dev@tukangcatat.app";

// Set VAPID sekali per proses (idempotent).
let vapidReady = false;
export function ensureVapid(): void {
  if (vapidReady) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error(
      "VAPID keys belum diset (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)"
    );
  }
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
  vapidReady = true;
}

export interface PushPayload {
  title?: string;
  body: string;
  url?: string;
}

// Kirim push ke semua langganan user. Return true bila minimal satu sukses.
// Langganan mati (404/410) otomatis dihapus supaya tidak dicoba terus.
export async function sendWebPushToUser(
  userId: string,
  payload: PushPayload
): Promise<boolean> {
  ensureVapid();
  const { data } = await serviceRoleClient
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  const subscriptions = ((data ?? []) as unknown as Array<{
    endpoint: string;
    p256dh: string;
    auth: string;
  }>);
  if (subscriptions.length === 0) return false;

  const message = JSON.stringify({
    title: payload.title ?? "TukangCatat",
    body: payload.body,
    url: payload.url ?? "/dash",
  });

  let anySent = false;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message
      );
      anySent = true;
    } catch (err) {
      const statusCode =
        err instanceof webpush.WebPushError ? err.statusCode : 0;
      if (statusCode === 404 || statusCode === 410) {
        await serviceRoleClient
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", sub.endpoint);
      } else {
        console.error(
          "[push] send:",
          err instanceof Error ? err.message : err
        );
      }
    }
  }
  return anySent;
}