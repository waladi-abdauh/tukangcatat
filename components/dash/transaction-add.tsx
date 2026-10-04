"use client";

// Dialog tambah catatan manual dari dashboard (tanpa lewat WhatsApp).
// Pola sama dengan dialog edit transaksi; tanggal default datang dari
// server (props) supaya bebas hydration mismatch.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { addTransaction } from "../../app/dash/actions";
import type { ActionResult } from "../../app/dash/actions";
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

interface TransactionAddProps {
  categoryOptions: string[];
  defaultDate: string;
}

export default function TransactionAdd({
  categoryOptions,
  defaultDate,
}: TransactionAddProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categoryOptions[0] ?? "");
  const [date, setDate] = useState(defaultDate);

  const [isSaving, startSave] = useTransition();

  const handleSave = () =>
    startSave(async () => {
      setError(null);
      const result: ActionResult = await addTransaction(
        itemName,
        Number(amount),
        category,
        date
      );
      if (result.ok) {
        setOpen(false);
        setItemName("");
        setAmount("");
        router.refresh();
      } else {
        setError(result.error ?? "Gagal menyimpan.");
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          Catat manual
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat manual</DialogTitle>
          <DialogDescription>
            Tambah pengeluaran langsung dari dashboard — tanpa lewat WhatsApp.
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
              placeholder="mis. Pastel"
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
                placeholder="mis. 5000"
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
              {categoryOptions.map((c) => (
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
          <Button variant="outline" onClick={() => setOpen(false)}>
            Batal
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !itemName.trim() || !(Number(amount) > 0)}
          >
            {isSaving && <Loader2 className="size-4 animate-spin" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}