"use client";

// Aksi per-transaksi di daftar pengeluaran: edit & hapus (dialog).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import type { TransactionRow } from "../../lib/dash/data";
import { deleteTransaction, updateTransaction } from "../../app/dash/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Button } from "../ui/button";

interface TransactionActionsProps {
  transaction: TransactionRow;
  categoryOptions: string[];
}

export default function TransactionActions({
  transaction,
  categoryOptions,
}: TransactionActionsProps) {
  const router = useRouter();
  const t = transaction;

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [itemName, setItemName] = useState(t.item_name);
  const [amount, setAmount] = useState(String(t.amount));
  const [category, setCategory] = useState(() =>
    categoryOptions.includes(t.category) ? t.category : "Lainnya"
  );
  const [date, setDate] = useState(t.transaction_date);

  const [isDeleting, startDelete] = useTransition();
  const [isSaving, startSave] = useTransition();

  // Pastikan kategori aktif selalu ada di pilihan dropdown edit.
  const options = categoryOptions.includes(t.category)
    ? categoryOptions
    : [t.category, ...categoryOptions];

  const handleSave = () =>
    startSave(async () => {
      setError(null);
      const result = await updateTransaction(
        t.id,
        itemName,
        Number(amount),
        category,
        date
      );
      if (result.ok) {
        setEditOpen(false);
        router.refresh();
      } else {
        setError(result.error ?? "Gagal menyimpan.");
      }
    });

  const handleDelete = () =>
    startDelete(async () => {
      setError(null);
      const result = await deleteTransaction(t.id);
      if (result.ok) {
        setDeleteOpen(false);
        router.refresh();
      } else {
        setError(result.error ?? "Gagal menghapus.");
      }
    });

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {/* Edit */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Edit transaksi"
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-4" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit catatan</DialogTitle>
            <DialogDescription>
              Perbaiki nama, nominal, kategori, atau tanggal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Nama item
              </span>
              <input
                type="text"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Nominal (Rp)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Tanggal
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Kategori
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {options.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hapus */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Hapus transaksi"
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus catatan ini?</DialogTitle>
            <DialogDescription>
              &ldquo;{t.item_name}&rdquo; — {t.category} akan dihapus permanen.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="size-4 animate-spin" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}