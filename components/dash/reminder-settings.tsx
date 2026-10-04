"use client";

// Kartu "Pengingat nyatet" di Settings: Switch + jam (WIB). Saat diaktifkan,
// minta izin notifikasi browser lalu langganan web push (VAPID) dan simpan
// ke server — cron akan mengirim pengingat pada jam pilihan user.
//
// Anti hydration mismatch: semua akses window/Notification hanya di dalam
// handler (setelah interaksi user), bukan saat render pertama.
import { useState, useTransition } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { savePushSubscription, updateReminderSetting } from "../../app/dash/actions";
import type { ActionResult } from "../../app/dash/actions";
import { Switch } from "../ui/switch";

const DEFAULT_TIME = "20:00";

interface ReminderSettingsProps {
  reminderTime: string | null;
}

// Konversi base64url ke Uint8Array untuk applicationServerKey (syarat Web Push).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array(rawData.split("").map((c) => c.charCodeAt(0)));
}

export default function ReminderSettings({ reminderTime }: ReminderSettingsProps) {
  const [enabled, setEnabled] = useState(reminderTime != null);
  const [time, setTime] = useState(reminderTime ?? DEFAULT_TIME);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, startBusy] = useTransition();

  // Aktifkan: minta izin notifikasi -> subscribe push -> simpan -> set jam.
  const handleEnable = (nextTime: string) =>
    startBusy(async () => {
      setError(null);
      setNotice(null);

      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setError(
          "Browser/HP ini belum mendukung notifikasi web. Coba Chrome/Android, atau Safari iOS 16.4+ setelah dipasang ke home screen."
        );
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setError("Kunci notifikasi belum terpasang di server. Hubungi Kak Pengembang ya 😅");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          "Izin notifikasi belum diberikan. Buka pengaturan browser → izin situs → Notification → Allow, lalu coba lagi."
        );
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const sub = subscription.toJSON() as {
        endpoint: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const subResult: ActionResult = await savePushSubscription(
        sub.endpoint,
        sub.keys?.p256dh ?? "",
        sub.keys?.auth ?? ""
      );
      if (!subResult.ok) {
        setError(subResult.error ?? "Gagal menyimpan langganan notifikasi.");
        return;
      }

      const timeResult: ActionResult = await updateReminderSetting(nextTime);
      if (!timeResult.ok) {
        setError(timeResult.error ?? "Gagal menyimpan jam pengingat.");
        return;
      }

      setEnabled(true);
      setNotice(`Siap! Aku ingetin kamu nyatet tiap hari jam ${nextTime} WIB 📌`);
    });

  // Nonaktifkan: cukup kosongkan jam (langganan disimpan biar mudah aktif lagi).
  const handleDisable = () =>
    startBusy(async () => {
      setError(null);
      setNotice(null);
      const result: ActionResult = await updateReminderSetting(null);
      if (result.ok) {
        setEnabled(false);
        setNotice("Pengingat dimatiin. Kapan aja bisa dinyalain lagi ya ✌️");
      } else {
        setError(result.error ?? "Gagal mematikan pengingat.");
      }
    });

  // Ubah jam saat sudah aktif: simpan jam baru saja.
  const handleTimeChange = (nextTime: string) =>
    startBusy(async () => {
      setTime(nextTime);
      setError(null);
      setNotice(null);
      if (!enabled) return;
      const result: ActionResult = await updateReminderSetting(nextTime);
      if (!result.ok) setError(result.error ?? "Gagal menyimpan jam pengingat.");
      else setNotice(`Siap! Ingetin jam ${nextTime} WIB 📌`);
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-heading font-script text-base font-medium">
          <BellRing className="size-4 text-primary" />
          Pengingat nyatet
        </h2>
        <div className="flex items-center gap-2">
          {isBusy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <input
            type="time"
            value={time}
            onChange={(e) => handleTimeChange(e.target.value)}
            disabled={isBusy}
            aria-label="Jam pengingat (WIB)"
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring/50"
          />
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              checked ? handleEnable(time) : handleDisable()
            }
            disabled={isBusy}
            aria-label="Aktifkan pengingat nyatet"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Notifikasi muncul di HP kamu tiap hari pada jam yang dipilih (WIB) —
        berisi rekap pengeluaran hari itu. Butuh aplikasi terpasang ke home
        screen & izin notifikasi.
      </p>
      {error && (
        <p className="text-xs font-medium text-destructive">{error}</p>
      )}
      {notice && !error && (
        <p className="text-xs text-muted-foreground">{notice}</p>
      )}
    </div>
  );
}