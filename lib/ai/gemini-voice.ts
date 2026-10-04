// AI Engine: transcribe Voice Note menjadi JSON transaksi.
//
// TAMBAHAN KEAMANAN & EFISIENSI:
// - Audio dikirim sebagai buffer in-memory (base64) ke Gemini.
// - BUFFER TIDAK PERNAH disimpan ke disk/server; setelah request selesai, variabel dilepas.
// - Pemakaian WAJIB dicek kuota trial (akun gratis) atau status PRO di pemanggil.
import type { Part } from "@google/genai";
import { requestTransactions, type FinancialResult } from "./gemini-text";

// Mengubah buffer audio (voice note) menjadi daftar transaksi terstruktur.
// `categories` = daftar kategori aktif milik user (dari dashboard).
export async function parseTransactionsFromVoice(
  audioBuffer: Uint8Array,
  mimeType: string,
  categories: string[]
): Promise<FinancialResult> {
  const base64Audio = Buffer.from(audioBuffer).toString("base64");
  const parts: Part[] = [
    { text: `Transkripsi lalu catat pengeluaran pada voice note berikut:` },
    { inlineData: { mimeType, data: base64Audio } },
  ];
  return requestTransactions(
    parts,
    "Ubah isi voice note menjadi daftar transaksi pengeluaran.",
    categories
  );
}