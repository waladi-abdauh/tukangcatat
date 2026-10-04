"use client";

// Daftar pengeluaran bulan terpilih dengan filter kategori quick-chip
// (chip dibangun dari SEMUA kategori bulan itu — konsisten dgn pie chart),
// tampil maks 8 baris + tombol lihat semua, & aksi edit/hapus.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn, formatDateShort } from "../../lib/utils";
import type { TransactionRow } from "../../lib/dash/data";
import TransactionActions from "./transaction-actions";

const INITIAL_VISIBLE = 8;

interface ExpenseListProps {
  transactions: TransactionRow[];
}

export default function ExpenseList({ transactions }: ExpenseListProps) {
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) set.add(t.category);
    return ["Semua", ...set];
  }, [transactions]);

  const [active, setActive] = useState("Semua");
  const [expanded, setExpanded] = useState(false);

  const categoryOptions = useMemo(
    () => categories.filter((c) => c !== "Semua"),
    [categories]
  );

  const filtered =
    active === "Semua"
      ? transactions
      : transactions.filter((t) => t.category === active);

  const visible = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE);

  if (transactions.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Belum ada catatan. Santai, tinggal chat aku di WhatsApp ya ✍️
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(c)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active === c
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Nggak ada catatan di kategori ini.
        </p>
      )}

      <ul className="divide-y">
        {visible.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2.5">
            <div
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor(t.category) }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.item_name}</p>
              <p className="text-xs text-muted-foreground">
                {t.category} · {formatDateShort(t.transaction_date)}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatMoney(t.amount)}
            </span>
            <TransactionActions
              transaction={t}
              categoryOptions={categoryOptions}
            />
          </li>
        ))}
      </ul>

      {filtered.length > INITIAL_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          {expanded ? (
            <>
              Ciutkan
              <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              Lihat semua ({filtered.length})
              <ChevronDown className="size-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function formatMoney(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

const CATEGORY_COLORS: Record<string, string> = {
  Makan: "var(--chart-1)",
  Transport: "var(--chart-2)",
  Belanja: "var(--chart-3)",
  Tagihan: "var(--chart-4)",
  Kesehatan: "var(--chart-5)",
  Hiburan: "#94a3b8",
};

function categoryColor(name: string): string {
  return CATEGORY_COLORS[name] ?? "#94a3b8";
}