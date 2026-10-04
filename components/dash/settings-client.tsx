"use client";

// Pengaturan: slider budget bulanan, limit per kategori, dan kartu referral.
import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Gift,
  Loader2,
  Pencil,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import {
  addCategory,
  deleteCategory,
  renameCategory,
  updateCategoryBudget,
  updateFullName,
  updateMonthlyBudget,
} from "../../app/dash/actions";
import type { ActionResult } from "../../app/dash/actions";
import { Slider } from "../ui/slider";
import { Card, CardContent } from "../ui/card";
import ReminderSettings from "./reminder-settings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { formatIDR } from "../../lib/utils";
import {
  FREE_DAILY_TRANSACTION_LIMIT,
  PRO_DAILY_TRANSACTION_LIMIT,
  REFERREE_DISCOUNT_PCT,
  REFERRER_REWARD_AMOUNT,
} from "../../lib/constants";

const MIN_BUDGET = 100_000;
const MAX_BUDGET = 10_000_000;
const BUDGET_STEP = 100_000;

interface ExistingLimit {
  category_name: string;
  limit_amount: number;
}

interface SettingsClientProps {
  fullName: string;
  reminderTime: string | null;
  monthlyBudget: number;
  budgetSet: boolean;
  usedCategories: string[];
  existingLimits: ExistingLimit[];
  isPro: boolean;
  creditBalance: number;
  referralCode: string;
}

export default function SettingsClient({
  fullName,
  reminderTime,
  monthlyBudget,
  budgetSet,
  usedCategories,
  existingLimits,
  isPro,
  creditBalance,
  referralCode,
}: SettingsClientProps) {
  // Nama panggilan (dipakai sapaan "Halo" di Ringkasan).
  const [name, setName] = useState(fullName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [isSavingName, startNameSave] = useTransition();

  const commitName = () =>
    startNameSave(async () => {
      setNameError(null);
      const trimmed = name.trim();
      if (!trimmed) return;
      const result: ActionResult = await updateFullName(trimmed);
      if (result.ok) {
        setName(trimmed);
        setNameSaved(true);
        setTimeout(() => setNameSaved(false), 2500);
      } else {
        setNameError(result.error ?? "Gagal menyimpan nama.");
      }
    });
  const [budget, setBudget] = useState(
    monthlyBudget ? Math.min(monthlyBudget, MAX_BUDGET) : MIN_BUDGET
  );
  const [savedBudget, setSavedBudget] = useState(
    monthlyBudget ? Math.min(monthlyBudget, MAX_BUDGET) : MIN_BUDGET
  );
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetSaved, setBudgetSaved] = useState(budgetSet);
  const [isSavingBudget, startBudgetSave] = useTransition();

  // Nama kategori: kategori yang pernah dipakai bulan ini + yang sudah punya
  // limit (biar tetap tampil walau bulan ini kosong). Tidak ada daftar default
  // yang di-hardcode supaya kategori yang dihapus tidak muncul lagi.
  const categories = useMemo(() => {
    const set = new Set<string>(usedCategories);
    for (const e of existingLimits) set.add(e.category_name);
    return [...set];
  }, [usedCategories, existingLimits]);

  // Kategori yang ditambahkan user di halaman ini (persisten lewat limit).
  const [addedCategories, setAddedCategories] = useState<string[]>([]);
  const allCategories = useMemo(
    () => [...categories, ...addedCategories.filter((c) => !categories.includes(c))],
    [categories, addedCategories]
  );

  const [newCategory, setNewCategory] = useState("");
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);
  const [isAddingCategory, startAddCategory] = useTransition();

  // Dialog hapus kategori + pindahkan datanya.
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);
  const [destinationCategory, setDestinationCategory] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteCategory] = useTransition();

  const openDeleteDialog = (category: string) => {
    setCategoryToDelete(category);
    setDestinationCategory(
      allCategories.find((c) => c !== category) ?? ""
    );
    setDeleteError(null);
  };

  // Dialog ganti nama kategori. Riwayat bulan lalu dibekukan: hanya limit
  // dan transaksi bulan BERJALAN yang ikut ganti nama.
  const [categoryToRename, setCategoryToRename] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, startRename] = useTransition();

  const openRenameDialog = (category: string) => {
    setCategoryToRename(category);
    setRenameValue(category);
    setRenameError(null);
  };

  const confirmRename = () =>
    startRename(async () => {
      if (!categoryToRename) return;
      setRenameError(null);
      const next = renameValue.trim();
      if (!next) {
        setRenameError("Nama baru tidak boleh kosong.");
        return;
      }
      const result: ActionResult = await renameCategory(categoryToRename, next);
      if (result.ok) {
        // Limit ikut ke nama baru; state lokal harus menggandreng baris lama.
        setAddedCategories((a) =>
          a.map((c) => (c === categoryToRename ? next : c))
        );
        setLimits((l) => {
          const value = l[categoryToRename] ?? 0;
          const copy = { ...l };
          delete copy[categoryToRename];
          copy[next] = value;
          return copy;
        });
        setSaving((s) => {
          const copy = { ...s };
          delete copy[categoryToRename];
          return copy;
        });
        setCategoryToRename(null);
      } else {
        setRenameError(result.error ?? "Gagal ganti nama kategori.");
      }
    });

  const confirmDelete = () =>
    startDeleteCategory(async () => {
      if (!categoryToDelete) return;
      setDeleteError(null);
      const result: ActionResult = await deleteCategory(
        categoryToDelete,
        destinationCategory || null
      );
      if (result.ok) {
        setCategoryToDelete(null);
        setAddedCategories((a) => a.filter((c) => c !== categoryToDelete));
        setLimits((l) => {
          const next = { ...l };
          delete next[categoryToDelete];
          return next;
        });
        setSaving((s) => {
          const next = { ...s };
          delete next[categoryToDelete];
          return next;
        });
      } else {
        setDeleteError(result.error ?? "Gagal menghapus kategori.");
      }
    });

  // Nilai limit per kategori (0 = tanpa limit).
  const [limits, setLimits] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const e of existingLimits) map[e.category_name] = e.limit_amount;
    for (const c of categories) if (!(c in map)) map[c] = 0;
    return map;
  });

  // Konsumsi budget oleh limit (ringkasan "Terpakai / Cadangan").
  const { limitsUsed, cadangan } = useMemo(() => {
    const used = allCategories.reduce(
      (acc, c) => acc + Math.max(Number(limits[c] ?? 0), 0),
      0
    );
    return { limitsUsed: used, cadangan: savedBudget - used };
  }, [allCategories, limits, savedBudget]);

  // Sisa budget di luar kategori tertentu = batas maksimal kategori itu.
  const maxLimitFor = (category: string) =>
    savedBudget -
    allCategories
      .filter((c) => c !== category)
      .reduce((acc, c) => acc + Math.max(Number(limits[c] ?? 0), 0), 0);

  // Status simpan per kategori.
  const [saving, setSaving] = useState<Record<string, "saving" | "saved">>({});
  const [isPending, startSave] = useTransition();

  const commitBudget = (amount: number) =>
    startBudgetSave(async () => {
      setBudgetError(null);
      const result = await updateMonthlyBudget(amount);
      if (result.ok) {
        setSavedBudget(amount);
        setBudgetSaved(true);
      } else {
        setBudget(savedBudget);
        setBudgetError(result.error ?? "Kurangi limit kategori dulu.");
      }
    });

  const commitLimit = (category: string) =>
    startSave(async () => {
      const limit = limits[category] ?? 0;
      setSaving((s) => ({ ...s, [category]: "saving" }));
      const result: ActionResult = await updateCategoryBudget(category, limit);
      if (result.ok) {
        setSaving((s) => ({ ...s, [category]: "saved" }));
        if (limit === 0) {
          setAddedCategories((a) => a.filter((c) => c !== category));
        }
      } else {
        setSaving((s) => {
          const next = { ...s };
          delete next[category];
          return next;
        });
      }
    });

  const handleAddCategory = () =>
    startAddCategory(async () => {
      const name = newCategory.trim();
      setNewCategoryError(null);
      if (!name) return;
      if (allCategories.includes(name)) {
        setNewCategoryError("Kategori ini sudah ada.");
        return;
      }
      const result: ActionResult = await addCategory(name);
      if (result.ok) {
        setAddedCategories((a) => [...a, name]);
        setLimits((l) => ({ ...l, [name]: 0 }));
        setNewCategory("");
      } else {
        setNewCategoryError(result.error ?? "Gagal menambah kategori.");
      }
    });

  const [copied, setCopied] = useState(false);
  const copyCode = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const status = (category: string) => {
    const s = saving[category];
    if (isPending && s === "saving") return <Loader2 className="size-4 animate-spin" />;
    if (s === "saved") return <Check className="size-4 text-primary" />;
    return null;
  };

  return (
    <div className="space-y-7">
      <div>
        <h1 className="font-heading font-script text-xl font-semibold">Pengaturan</h1>
        <p className="text-sm text-muted-foreground">
          Jaga irama biar dompet aman tiap bulan.
        </p>
      </div>

      {/* Grup: Kamu (nama + pengingat) */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Kamu
        </h2>

      {/* Nama panggilan */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-heading font-script text-base font-medium">
              Nama kamu
            </h2>
            {isSavingName ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : nameSaved ? (
              <Check className="size-4 text-primary" />
            ) : null}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              maxLength={10}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              placeholder="mis. Budi"
              aria-label="Nama kamu"
              className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm shadow-none outline-none transition-shadow focus:ring-2 focus:ring-ring/50"
            />
            <Button
              type="button"
              onClick={commitName}
              disabled={isSavingName || name.trim().length === 0 || name.trim() === fullName}
            >
              Simpan
            </Button>
          </div>
          {nameError ? (
            <p className="flex items-start gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {nameError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              4–10 huruf. Dipakai buat sapaan “Halo” di Ringkasan.
            </p>
          )}
        </CardContent>
        </Card>

        {/* Pengingat nyatet (web push) */}
        <Card>
          <CardContent>
            <ReminderSettings reminderTime={reminderTime} />
          </CardContent>
        </Card>
      </section>

      {/* Grup: Duit (budget + limit kategori) */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Duit
        </h2>

      {/* Budget bulanan */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-heading font-script text-base font-medium">
              Budget bulanan (berlaku bulan ini)
            </h2>
            <span className="font-heading text-lg font-semibold tabular-nums">
              {formatIDR(budget)}
            </span>
          </div>
          <Slider
            value={[budget]}
            min={MIN_BUDGET}
            max={MAX_BUDGET}
            step={BUDGET_STEP}
            onValueChange={([value]) => {
              const v = Number(value ?? budget);
              if (Number.isFinite(v)) setBudget(v);
            }}
            onValueCommit={([value]) => {
              const v = Number(value ?? budget);
              setBudget(v);
              commitBudget(v);
            }}
            aria-label="Budget bulanan"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatIDR(MIN_BUDGET)}</span>
            <span>{formatIDR(MAX_BUDGET)}</span>
          </div>
          {budgetError ? (
            <p className="flex items-start gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {budgetError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {budgetSaved
                ? "✓ Tersimpan. Progress muncul di Ringkasan."
                : isSavingBudget
                  ? "Menyimpan…"
                  : "Geser lalu lepas untuk menyimpan."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Limit per kategori */}
      <Card>
        <CardContent className="space-y-3">
          <div>
            <h2 className="font-heading font-script text-base font-medium">
              Limit per kategori
            </h2>
            <p className="text-xs text-muted-foreground">
              Isi plafon tiap kategori (0 = tanpa batas). Kamu bakal dibilangin
              duluan pas mau bengkak.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <span className="font-medium">
              Terpakai {formatIDR(limitsUsed)}
            </span>
            <span className="text-muted-foreground">•</span>
            <span>Budget {formatIDR(savedBudget)}</span>
            <span className="text-muted-foreground">•</span>
            <span
              className={
                cadangan <= 0
                  ? "font-medium text-destructive"
                  : "font-medium text-muted-foreground"
              }
            >
              Cadangan {formatIDR(Math.max(cadangan, 0))}
            </span>
          </div>
          <ul className="divide-y">
            {allCategories.map((category) => (
              <li key={category} className="py-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {category}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">Rp</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={10000}
                    value={limits[category] ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      setLimits((l) => ({ ...l, [category]: v }));
                    }}
                    onBlur={() => commitLimit(category)}
                    className="w-20 shrink-0 rounded-lg border bg-background px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring sm:w-28"
                    aria-label={`Limit ${category}`}
                  />
                  <button
                    type="button"
                    onClick={() => openRenameDialog(category)}
                    aria-label={`Ganti nama kategori ${category}`}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary sm:size-9"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteDialog(category)}
                    aria-label={`Hapus kategori ${category}`}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive sm:size-9"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <div className="w-4 shrink-0">{status(category)}</div>
                </div>
                {(() => {
                  const value = Math.max(Number(limits[category] ?? 0), 0);
                  const max = maxLimitFor(category);
                  if (value > 0 && value > max) {
                    return (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-destructive">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        Melebihi cadangan. Maksimal {formatIDR(
                          Math.max(max, 0)
                        )} — kecilkan limit ini, kurangi kategori lain, atau
                        naikkan budget.
                      </p>
                    );
                  }
                  return null;
                })()}
              </li>
            ))}
          </ul>

          {/* Tambah kategori baru */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => {
                  setNewCategory(e.target.value);
                  setNewCategoryError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCategory();
                }}
                maxLength={40}
                placeholder="Nama kategori baru, mis. Kopi"
                aria-label="Nama kategori baru"
                className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="button"
                size="sm"
                disabled={isAddingCategory || !newCategory.trim()}
                onClick={handleAddCategory}
              >
                {isAddingCategory ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Tambah
              </Button>
            </div>
            {newCategoryError && (
              <p className="text-xs text-destructive">{newCategoryError}</p>
            )}
          </div>
        </CardContent>
        </Card>
      </section>

      {/* Grup: Ajak teman (referral) */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ajak teman
        </h2>

      {/* Referral & kuota */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Gift className="size-4 text-primary" />
            <h2 className="font-heading font-script text-base font-medium">
              Ajak teman, sama-sama enak
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Teman dapat potongan {Math.round(REFERREE_DISCOUNT_PCT * 100)}% pas bayar PRO pertama. Kamu: potongan {formatIDR(REFERRER_REWARD_AMOUNT)} buat PRO berikutnya.
          </p>

          <button
            type="button"
            onClick={() => {
              if (referralCode) copyCode(referralCode);
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 font-mono text-base tracking-wider transition-colors hover:bg-muted"
          >
            <span className="truncate text-primary">{referralCode || "—"}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {copied ? (
                <>
                  <Check className="size-3 text-primary" /> Tersalin
                </>
              ) : (
                <>
                  <Copy className="size-3" /> Salin
                </>
              )}
            </span>
          </button>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              `Yuk nyatet duit via WhatsApp ✍️\n` +
                `Pakai kodeku REF ${referralCode} — dapat potongan ${Math.round(
                  REFERREE_DISCOUNT_PCT * 100
                )}% pas bayar PRO`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Share2 className="size-4" />
            Bagikan via WhatsApp
          </a>

          <details className="rounded-lg bg-muted/50 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-foreground">
              Cara pakai
            </summary>
            <ol className="list-decimal space-y-1 px-6 pb-3">
              <li>Kirim kode ke teman.</li>
              <li>
                Teman ketik{" "}
                <code className="rounded bg-background px-1 font-mono">
                  REF {referralCode}
                </code>{" "}
                di chat TukangCatat.
              </li>
              <li>
                Teman bayar PRO pertama → kamu dapat{" "}
                {formatIDR(REFERRER_REWARD_AMOUNT)} buat PRO berikutnya.
              </li>
            </ol>
          </details>

          {creditBalance > 0 && (
            <p className="text-xs text-muted-foreground">
              Potongan undangan: {formatIDR(creditBalance)} — otomatis dipakai
              buat PRO berikutnya.
            </p>
          )}
        </CardContent>
      </Card>
      </section>

      {/* Grup: Paket */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Paket
        </h2>

      {/* Status paket akun */}
      <Card>
        <CardContent className="space-y-1">
          <h2 className="font-heading font-script text-base font-medium">
            Paket kamu
          </h2>
          <p className="text-sm text-muted-foreground">
            {isPro
              ? `PRO — ${PRO_DAILY_TRANSACTION_LIMIT} catatan via WA/hari · Voice & Struk tanpa batas · catat manual di dashboard tanpa batas. 🎉`
              : `GRATIS — ${FREE_DAILY_TRANSACTION_LIMIT} catatan via WA/hari · catat manual di dashboard tanpa batas.`}
          </p>
        </CardContent>
      </Card>
      </section>

      {/* Dialog ganti nama kategori */}
      <Dialog
        open={categoryToRename !== null}
        onOpenChange={(open) => {
          if (!open) setCategoryToRename(null);
        }}
      >
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Ganti nama kategori</DialogTitle>
            <DialogDescription>
              Limit dan catatan bulan ini ikut ke nama baru. Laporan
              bulan-bulan sebelumnya TIDAK berubah — catatan lama tetap
              memakai nama lama, jadi angkanya tetap utuh.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="rename-category"
              className="text-xs font-medium text-muted-foreground"
            >
              Nama baru
            </label>
            <input
              id="rename-category"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={40}
              autoFocus
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {renameError && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {renameError}
            </p>
          )}

          <DialogFooter className="sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCategoryToRename(null)}
            >
              Batal
            </Button>
            <Button type="button" onClick={confirmRename} disabled={isRenaming}>
              {isRenaming && <Loader2 className="size-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog hapus kategori + pindahkan datanya */}
      <Dialog
        open={categoryToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setCategoryToDelete(null);
        }}
      >
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>
              {categoryToDelete ? (
                <>
                  Hapus kategori{" "}
                  <span className="font-mono">{categoryToDelete}</span>?
                </>
              ) : (
                "Hapus kategori"
              )}
            </DialogTitle>
            <DialogDescription>
              {allCategories.length > 1
                ? "Data yang sudah tercatat akan dipindah ke kategori lain."
                : "Tidak ada kategori lain. Pastikan tidak ada transaksi di kategori ini agar aman dihapus."}
            </DialogDescription>
          </DialogHeader>

          {allCategories.length > 1 && (
            <div className="space-y-2">
              <label
                htmlFor="dest-category"
                className="text-xs font-medium text-muted-foreground"
              >
                Pindahkan data ke
              </label>
              <select
                id="dest-category"
                value={destinationCategory}
                onChange={(e) => setDestinationCategory(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {allCategories
                  .filter((c) => c !== categoryToDelete)
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {deleteError && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {deleteError}
            </p>
          )}

          <DialogFooter className="sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCategoryToDelete(null)}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={confirmDelete}
            >
              {isDeleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}