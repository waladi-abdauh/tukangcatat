"use client";

// Perhatian kategori berdasar batas limit:
//   >= 100%  -> Bocor (merah)        |  80-99% -> Mendekati limit (amber)
//   < 80%    -> Aman (kartu check).
// Layout mobile-friendly: tiap item tumpuk vertikal (nama+badge, angka,
// progress bar tipis, hint) supaya tidak menyempit di layar HP.
import { AlertTriangle, CheckCheck, Flame } from "lucide-react";
import { cn, formatIDR, formatIDRPlain } from "../../lib/utils";
import type { CategoryBudget } from "../../lib/dash/data";

interface LeakDetectorCardProps {
  budgets: CategoryBudget[];
  // "card": blok berdiri sendiri (border) — dipakai di halaman Analisis.
  // "inline": blok di dalam kartu lain (tanpa border, padding lebih ramping)
  //           — dipakai di dalam kartu Total pengeluaran Ringkasan.
  variant?: "card" | "inline";
}

export default function LeakDetectorCard({
  budgets,
  variant = "card",
}: LeakDetectorCardProps) {
  const bocor = budgets.filter((b) => b.status === "bocor");
  const mendekati = budgets.filter((b) => b.status === "mendekati");
  const attention = [...bocor, ...mendekati];

  if (attention.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground",
          variant === "card" && "border"
        )}
      >
        <CheckCheck className="size-4 shrink-0 text-primary" />
        Aman semua, masih di bawah 80%. 👍
      </div>
    );
  }

  const critical = bocor.length > 0;

  return (
    <div
      className={cn(
        "rounded-xl p-3",
        variant === "card" && "border",
        critical
          ? "border-destructive/40 bg-destructive/5"
          : "border-warn/40 bg-warn/10"
      )}
    >
      <div
        className={cn(
          "mb-3 flex items-center gap-2 text-sm font-semibold",
          critical && "text-destructive"
        )}
      >
        {critical ? (
          <Flame className="size-4 shrink-0" />
        ) : (
          <AlertTriangle className="size-4 shrink-0 text-warn" />
        )}
        {critical ? "Ada yang bocor (lewat 100%)!" : "Mendekati limit 80–100%"}
      </div>

      <div className="space-y-3.5">
        {attention.map((b) => {
          const isBocor = b.status === "bocor";
          const pctLabel = Math.round(b.pct * 100);
          const barPct = Math.min(pctLabel, 100);
          return (
            <div key={b.category_name}>
              {/* Baris 1: nama kategori + badge status */}
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {b.category_name}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide",
                    isBocor
                      ? "bg-destructive/10 text-destructive"
                      : "bg-warn/15 text-warn"
                  )}
                >
                  {b.status === "bocor" ? "Bocor" : "Mendekati"}
                </span>
              </div>

              {/* Baris 2: angka pakai vs limit, % di kanan */}
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-semibold tabular-nums">
                  {formatIDR(b.used)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  dari {formatIDR(b.limit_amount)}
                </span>
                <span
                  className={cn(
                    "ml-auto font-semibold tabular-nums",
                    isBocor ? "text-destructive" : "text-warn"
                  )}
                >
                  {pctLabel}%
                </span>
              </div>

              {/* Baris 3: progress tipis */}
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
                <div
                  className={cn(
                    "h-full rounded-full",
                    isBocor ? "bg-destructive" : "bg-warn"
                  )}
                  style={{ width: `${barPct}%` }}
                />
              </div>

              {/* Baris 4: petunjuk */}
              <p className="mt-1 text-xs text-muted-foreground">
                {isBocor
                  ? `Sudah lewat batas ${Math.max(
                      0,
                      pctLabel - 100
                    )}%. Ngerem dikit, Kak 🙏`
                  : `Tersisa ${formatIDRPlain(
                      b.limit_amount - b.used
                    )} sebelum limit.`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}