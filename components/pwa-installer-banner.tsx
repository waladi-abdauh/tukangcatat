"use client";

// Banner "Tambah ke Home Screen" untuk menginstal PWA.
// - Android/Chrome: pakai peristiwa beforeinstallprompt (prompt native).
// - iOS & browser tanpa prompt: buka dialog panduan langkah demi langkah.
// - Sekaligus mendaftarkan service worker saat pertama kali dimuat.
//
// ANTI HYDRATION MISMATCH: deteksi standalone/iOS/localStorage memakai
// useSyncExternalStore dengan server-snapshot false — render hydration
// identik dengan server, lalu React menyinkronkan nilai asli browser
// tanpa error "server rendered HTML didn't match the client".
import { useEffect, useState, useSyncExternalStore } from "react";
import { MonitorSmartphone, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "cepatcatat:pwa-dismissed";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// Subscribe tanpa sumber perubahan (nilai UA tidak berubah selama sesi).
const subscribeNoop = () => () => {};

// Terapkan di dalam PWA ter-install? (server: false, client: nilai asli)
function useStandalone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(display-mode: standalone)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    isStandalone,
    () => false
  );
}

// Perangkat iOS? (server: false, client: nilai asli)
function useIsIOS(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => /iphone|ipad|ipod/i.test(navigator.userAgent),
    () => false
  );
}

// Banner pernah ditutup user? (localStorage; server: false)
function useDismissedPersisted(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      return () => window.removeEventListener("storage", onChange);
    },
    () => localStorage.getItem(DISMISS_KEY) === "1",
    () => false
  );
}

export default function PwaInstallerBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissedNow, setDismissedNow] = useState(false);
  const standalone = useStandalone();
  const isIOS = useIsIOS();
  const dismissedPersisted = useDismissedPersisted();
  const dismissed = dismissedNow || dismissedPersisted;

  useEffect(() => {
    if (isStandalone()) return;
    if ("serviceWorker" in navigator) {
      // SW tetap terdaftar di dev & prod — dibutuhkan untuk push notification
      // pengingat. Di dev, CacheStorage dibersihkan tiap load supaya aset
      // (URL stabil tapi isi berubah) selalu segar tanpa menyandera push.
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .catch(() => {});
      if (process.env.NODE_ENV !== "production" && "caches" in window) {
        caches
          .keys()
          .then((keys) => keys.forEach((key) => caches.delete(key)))
          .catch(() => {});
      }
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferredPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") setDeferredPrompt(null);
    } else {
      setDialogOpen(true);
    }
  };

  const dismiss = () => {
    setDismissedNow(true);
    localStorage.setItem(DISMISS_KEY, "1");
  };

  if (standalone || dismissed) return null;

  return (
    <>
      <div className="mx-auto flex max-w-3xl items-stretch gap-2 px-4 pt-2">
        <button
          type="button"
          onClick={handleInstall}
          className="flex w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
        >
          <MonitorSmartphone className="size-4 shrink-0" />
          <span className="truncate">
            {deferredPrompt
              ? "Jadikan aplikasi — Install"
              : "Tambah ke Home Screen"}
          </span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Tutup banner instalasi"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="mx-auto max-w-3xl px-4 pb-2 text-center text-[0.7rem] text-muted-foreground">
        Dipasang = kamu diingetin nyatet tiap hari 📌
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Tambah ke Home Screen</DialogTitle>
            <DialogDescription>
              Buka TukangCatat kayak aplikasi, tanpa install dari store.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-5 text-sm sm:pl-4">
            {isIOS ? (
              <>
                <li>
                  Di <b>Safari</b>, buka menu <b>Share</b> (kotak dengan
                  panah ke atas).
                </li>
                <li>
                  Pilih <b>Add to Home Screen</b> (gulir bila perlu).
                </li>
                <li>
                  Tekan <b>Add</b> di pojok kanan atas. Selesai! 🎉
                </li>
              </>
            ) : deferredPrompt ? (
              <>
                <li>
                  Pastikan kamu pakai <b>Chrome/Edge/Android</b>.
                </li>
                <li>
                  Tekan tombol <b>Install</b> di banner atas.
                </li>
                <li>
                  Klik <b>Install</b> di popup browser. Selesai! 🎉
                </li>
              </>
            ) : (
              <>
                <li>Buka menu ⋮ di pojok kanan atas browser.</li>
                <li>
                  Pilih <b>Install app</b> / <b>Pasang TukangCatat</b>.
                </li>
                <li>Konfirmasi, lalu buka dari home screen. 🎉</li>
              </>
            )}
          </ol>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Bonus: sekalian diingetin nyatet tiap hari 📌
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}