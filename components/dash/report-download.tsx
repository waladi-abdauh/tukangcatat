"use client";

// Tombol unduh laporan bulanan (PDF) yang dibuat di sisi browser.
// Alasan client-side: VPS cuma 1 GB — jangan bebani server untuk render PDF.
// jsPDF + jspdf-autotable di-import dinamis saat diklik supaya tidak ikut
// membengkakkan bundle awal dashboard.
import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { formatIDR } from "../../lib/utils";
import type { TransactionRow } from "../../lib/dash/data";

interface ReportDownloadProps {
  month: string; // YYYY-MM
  monthLabel: string;
  budget: number;
  spent: number;
  remaining: number;
  categories: Array<{ category: string; amount: number }>;
  transactions: TransactionRow[];
}

// jsPDF tidak mengekspos lastAutoTable di tipe publik; plugin menempelkannya
// di runtime. Bungkus readonly kecil ini daripada memakai `any`.
type DocWithTable = {
  lastAutoTable?: { finalY?: number };
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  getNumberOfPages(): number;
  setPage(page: number): void;
};

export default function ReportDownload({
  month,
  monthLabel,
  budget,
  spent,
  remaining,
  categories,
  transactions,
}: ReportDownloadProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const d = doc as unknown as DocWithTable;
      const pageW = d.internal.pageSize.getWidth();
      const pageH = d.internal.pageSize.getHeight();

      // Header
      doc.setFontSize(18);
      doc.setTextColor(194, 65, 12);
      doc.text("TukangCatat", 40, 46);
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 40);
      doc.text(`Laporan Pengeluaran — ${monthLabel}`, 40, 64);
      doc.setFontSize(9);
      doc.setTextColor(130, 130, 130);
      doc.text(
        `Dicetak: ${new Date().toLocaleString("id-ID")}`,
        pageW - 40,
        46,
        { align: "right" }
      );

      // Ringkasan
      autoTable(doc, {
        startY: 82,
        head: [["Total Pengeluaran", "Budget Bulan Ini", "Sisa"]],
        body: [[formatIDR(spent), formatIDR(budget), formatIDR(remaining)]],
        theme: "grid",
        headStyles: { fillColor: [194, 65, 12], halign: "center" },
        styles: { halign: "center", fontSize: 10 },
        margin: { left: 40, right: 40 },
      });

      // Per kategori
      let y = (d.lastAutoTable?.finalY ?? 120) + 22;
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text("Rincian per Kategori", 40, y);
      autoTable(doc, {
        startY: y + 6,
        head: [["Kategori", "Total"]],
        body:
          categories.length > 0
            ? categories.map((c) => [c.category, formatIDR(c.amount)])
            : [["Belum ada catatan bulan ini", "-"]],
        theme: "striped",
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 1: { halign: "right" } },
        styles: { fontSize: 10 },
        margin: { left: 40, right: 40 },
      });

      // Rincian transaksi
      y = (d.lastAutoTable?.finalY ?? 200) + 22;
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text("Rincian Transaksi", 40, y);
      autoTable(doc, {
        startY: y + 6,
        head: [["Tanggal", "Item", "Kategori", "Jumlah"]],
        body:
          transactions.length > 0
            ? transactions.map((t) => [
                t.transaction_date,
                t.item_name,
                t.category,
                formatIDR(t.amount),
              ])
            : [["-", "Belum ada catatan bulan ini", "-", "-"]],
        theme: "striped",
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 3: { halign: "right" } },
        styles: { fontSize: 9 },
        margin: { left: 40, right: 40 },
      });

      // Footer setiap halaman
      const pageCount = d.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Halaman ${i} dari ${pageCount} · Dibuat dengan TukangCatat`,
          pageW / 2,
          pageH - 18,
          { align: "center" }
        );
      }

      doc.save(`TukangCatat-${month}.pdf`);
    } catch {
      setError("Gagal membuat PDF. Coba lagi ya.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileDown className="size-4" />
        )}
        {busy ? "Menyiapkan..." : "Unduh PDF"}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
