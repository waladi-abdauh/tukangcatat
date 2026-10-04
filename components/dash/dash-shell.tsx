"use client";

// Shell navigasi area /dash: header (brand + menu akun) & bottom nav PWA.
// Login otomatis via magic link WhatsApp => logout di sini berarti "akhiri
// sesi di perangkat ini", makanya menu akun menampilkan penjelasan tersebut.
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Settings,
} from "lucide-react";
import { logout } from "../../app/dash/actions";
import { APP_NAME } from "../../lib/constants";
import { cn } from "../../lib/utils";

const NAV_ITEMS = [
  { href: "/dash", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/dash/analytics", label: "Analisis", icon: BarChart3 },
  { href: "/dash/settings", label: "Atur", icon: Settings },
];

interface DashShellProps {
  fullName: string;
  isPro: boolean;
  phoneNumber: string;
  children: ReactNode;
}

// "6285773365200" -> "085773365200"
function formatPhone(phone: string): string {
  if (!phone) return "";
  if (phone.startsWith("62") && phone.length >= 11) return `0${phone.slice(2)}`;
  return phone;
}

export default function DashShell({
  fullName,
  isPro,
  phoneNumber,
  children,
}: DashShellProps) {
  const pathname = usePathname();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Tutup menu akun saat klik di luar / tekan Escape.
  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

  const initial = (fullName || "S").trim().charAt(0).toUpperCase();

  return (
    <div className="min-h-full">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/dash" className="flex items-center gap-2 font-script font-semibold">
            <Image
              src="/logo-tc.png"
              alt=""
              width={32}
              height={32}
              className="relative -top-0.5 left-1 size-8 shrink-0 object-contain"
              priority
            />
            {APP_NAME}
            {isPro && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-semibold text-primary">
                PRO
              </span>
            )}
          </Link>

          {/* Menu akun */}
          <div className="relative" ref={accountRef}>
            <button
              type="button"
              onClick={() => setAccountOpen((o) => !o)}
              aria-expanded={accountOpen}
              aria-label="Menu akun"
              className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-muted"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initial}
              </span>
              <span className="max-w-28 truncate text-sm text-muted-foreground">
                {fullName}
              </span>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  accountOpen && "rotate-180"
                )}
              />
            </button>

            {accountOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-3 text-popover-foreground shadow-md">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatPhone(phoneNumber)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Kamu login lewat link WhatsApp — sesi aktif 30 hari di HP ini.
                  Keluar artinya akhiri sesi browser ini.
                </p>
                <form action={logout} className="mt-3">
                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
                  >
                    <LogOut className="size-4" />
                    Keluar
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Konten */}
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">{children}</main>

      {/* Bottom nav (mobile-first seperti app; aman dari home indicator iPhone) */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2 text-[0.7rem] font-medium text-muted-foreground transition-colors",
                  active && "text-primary"
                )}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}