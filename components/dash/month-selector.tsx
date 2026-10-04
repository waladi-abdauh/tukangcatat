"use client";

// Pemilih bulan untuk Ringkasan & Analisis: navigasi ?month=YYYY-MM.
// Daftar bulan diterima via props (dihitung server-side) supaya render
// server & client identik — new Date() di client component bisa beda
// timezone server (UTC) vs browser (WIB) -> hydration mismatch.
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { monthLabelFromKey } from "../../lib/utils";

interface MonthSelectorProps {
  selected: string;
  basePath: string;
  options: string[];
}

export default function MonthSelector({ selected, basePath, options }: MonthSelectorProps) {
  const router = useRouter();

  return (
    <div className="relative inline-block shrink-0">
      <select
        value={selected}
        onChange={(e) => {
          const value = e.target.value;
          // Bulan berjalan cukup tanpa query param agar URL tetap bersih.
          const isCurrent = value === options[options.length - 1];
          router.push(isCurrent ? basePath : `${basePath}?month=${value}`);
        }}
        className="h-9 max-w-[48vw] appearance-none truncate rounded-lg border bg-background pl-3 pr-8 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
        aria-label="Pilih bulan"
      >
        {options.map((key) => (
          <option key={key} value={key}>
            {monthLabelFromKey(key)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}