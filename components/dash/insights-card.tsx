"use client";

// Kartu insight gabungan Ringkasan: komposisi kategori bulan terpilih (pie)
// dan tren 12 bulan (bar) dalam SATU kartu dengan toggle kecil — dulu dua
// kartu chart bertumpuk yang membuat halaman terasa padat/berat.
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn, formatIDR } from "../../lib/utils";
import type { MonthlyTrendPoint } from "../../lib/dash/data";
import CategoryPieChart from "./category-pie-chart";
import MonthlyTrendChart from "./monthly-trend-chart";
import { Marker } from "../marker";

interface InsightsCardProps {
  categories: Array<{ category: string; amount: number }>;
  trend: MonthlyTrendPoint[];
}

type Mode = "month" | "year";

export default function InsightsCard({ categories, trend }: InsightsCardProps) {
  const [mode, setMode] = useState<Mode>("month");
  const totalKept = trend.reduce((acc, p) => acc + p.kept, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading font-script text-base font-medium">
          Duitnya <Marker>ke mana aja</Marker>
        </h2>
        <Link
          href="/dash/analytics"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary"
        >
          Analisis <ArrowRight className="size-3" />
        </Link>
      </div>

      {/* Toggle: Bulan ini | 12 bulan */}
      <div className="mt-3 flex rounded-lg bg-muted p-0.5 text-xs font-medium">
        <button
          type="button"
          onClick={() => setMode("month")}
          aria-pressed={mode === "month"}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 transition-colors",
            mode === "month"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
        >
          Bulan ini
        </button>
        <button
          type="button"
          onClick={() => setMode("year")}
          aria-pressed={mode === "year"}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 transition-colors",
            mode === "year"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
        >
          12 bulan
        </button>
      </div>

      <div className="mt-2">
        {mode === "month" ? (
          <CategoryPieChart data={categories} />
        ) : (
          <>
            <MonthlyTrendChart data={trend} />
            {trend.length > 0 && (
              <p className="mt-2 text-center text-xs font-medium text-muted-foreground">
                Total berhasil dijaga: {formatIDR(totalKept)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}