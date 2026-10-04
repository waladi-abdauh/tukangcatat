"use client";

// Bar progress budget bulanan (emerald -> amber >=80% -> coklat pas habis).
import { cn } from "../../lib/utils";
import { formatIDR, formatIDRPlain } from "../../lib/utils";

interface BudgetProgressProps {
  budget: number;
  spent: number;
}

export default function BudgetProgress({ budget, spent }: BudgetProgressProps) {
  const pct = budget > 0 ? Math.min(spent / budget, 1) : 0;
  const percentLabel = Math.round(pct * 100);
  const tone =
    pct >= 1
      ? "bg-warn"
      : pct >= 0.8
        ? "bg-warn"
        : "bg-primary";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">Budget bulanan</span>
        <span className="text-sm font-medium tabular-nums">
          <span className={cn(pct >= 0.8 && "text-warn")}>
            {formatIDR(spent)}
          </span>{" "}
          / {formatIDR(budget)} · {percentLabel}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", tone)}
          style={{ width: `${Math.max(percentLabel, 2)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {bufferText(pct)}
      </p>
    </div>
  );
}

function bufferText(pct: number): string {
  if (pct >= 1) return "Budget abis bulan ini. Ngerem dikit, Kak 😅";
  if (pct >= 0.8)
    return `Tinggal ${formatIDRPlain(Math.round(pct * 100))}% menuju zona bahaya.`;
  if (pct >= 0.5) return "Baru setengah jalan, masih aman. Santai aja 💪";
  return "Masih lega. Terus catat ya ✅";
}