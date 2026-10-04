// AI Engine: OCR foto struk belanjaan (Gemini Vision).
//
// TAMBAHAN KEAMANAN & EFISIENSI (strict data isolation):
// - Gambar diproses dari buffer in-memory (base64) ke Gemini, TIDAK ditulis ke disk.
// - Hanya data teks JSON yang disimpan (tabel transactions). Gambar dibuang setelah proses.
import type { Part } from "@google/genai";
import { requestTransactions, type FinancialResult } from "./gemini-text";

// Mengekstrak transaksi dari buffer gambar struk.
// `categories` = daftar kategori aktif milik user (dari dashboard).
export async function parseTransactionsFromImage(
  imageBuffer: Uint8Array,
  mimeType: string,
  categories: string[]
): Promise<FinancialResult> {
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const parts: Part[] = [
    { text: "Baca struk belanja pada gambar ini." },
    {
      inlineData: { mimeType, data: base64Image },
    },
  ];
  return requestTransactions(
    parts,
    "Baca seluruh item pada foto struk dan catat sebagai transaksi pengeluaran. Jangan masukkan diskon potongan sebagai item terpisah; abaikan total akhir.",
    categories
  );
}