// Modul keamanan: Zod schema validasi untuk seluruh payload webhook & input.
// Setiap payload yang masuk WAJIB melewati skema di bawah sebelum diproses.
import { z } from "zod";

// ===== Primitif bersama =====

// Nomor telepon WhatsApp internasional, tanpa "+", contoh: 6281234567890.
export const phoneNumberSchema = z
  .string()
  .regex(/^[0-9]{8,15}$/, "Nomor telepon tidak valid");

// Kode referral TukangCatat, contoh: CCAT-5FC860.
export const referralCodeSchema = z
  .string()
  .regex(/^CCAT-[A-F0-9]{6}$/, "Format kode referral tidak valid");

// Angka rupiah harus bilangan bulat positif (amount selalu integer).
export const positiveAmountSchema = z
  .number()
  .int("Angka harus bilangan bulat")
  .positive("Amount harus lebih dari 0");

// ===== WhatsApp Inbound (hasil normalisasi lintas gateway) =====

export const waMessageTypeSchema = z.enum([
  "text",
  "audio",
  "image",
  "unknown",
]);

// Skema pesan WA yang sudah dinormalisasi (sumber: Fonnte/Wablas/Meta Cloud API).
// Adapter gateway akan mengubah format mentahnya menjadi bentuk ini.
export const waInboundSchema = z.object({
  sender: phoneNumberSchema,
  messageType: waMessageTypeSchema,
  text: z.string().trim().max(4000).optional(),
  mediaUrl: z.string().url().optional(),
  mediaMimeType: z.string().trim().optional(),
});

// Tipe pesan WA ter-normalisasi yang dipakai seluruh pipeline bisnis.
export type InboundWAMessage = z.infer<typeof waInboundSchema>;

// ===== Hasil parse AI (validasi sebelum disimpan ke database) =====

// Satu transaksi hasil ekstraksi Gemini.
export const parsedTransactionSchema = z.object({
  item_name: z.string().trim().min(1, "Nama item kosong").max(120),
  amount: positiveAmountSchema,
  category: z.string().trim().min(1, "Kategori kosong").max(40),
});

// Daftar transaksi hasil ekstraksi (maks 20 item per pesan - anti spam).
export const parsedTransactionsSchema = z
  .array(parsedTransactionSchema)
  .min(1, "Tidak ada transaksi terdeteksi")
  .max(20, "Terlalu banyak item dalam satu pesan");

export type ParsedTransactions = z.infer<typeof parsedTransactionsSchema>;

// ===== Hasil klasifikasi + parse AI (Guardrail) =====
// Gemini diwajibkan mengembalikan label klasifikasi agar pesan off-topic
// (obrolan umum, cuaca, politik, dsb) bisa ditolak ramah tanpa token API
// berlebih. Pertanyaan seputar dompet dijawab LOKAL dari database (tanpa
// teks AI), jadi label "question" cukup — AI dilarang menulis jawaban.
export const aiParseResultSchema = z.object({
  is_financial: z.boolean(),
  reply_type: z.enum(["transactions", "question", "off_topic"]),
  transactions: z.array(parsedTransactionSchema).default([]),
});

export type AIParseResult = z.infer<typeof aiParseResultSchema>;

// ===== Webhook Midtrans (dipakai di Step 7) =====

export const midtransTransactionStatusSchema = z.enum([
  "capture",
  "settlement",
  "pending",
  "deny",
  "cancel",
  "expire",
  "refund",
]);

// Payload callback Midtrans yang WAJIB divalidasi & diverifikasi signature-nya.
export const midtransWebhookSchema = z.object({
  order_id: z.string().min(1),
  status_code: z.string().min(1),
  transaction_status: midtransTransactionStatusSchema,
  fraud_status: z.string().optional(),
  gross_amount: z.string().min(1),
  signature_key: z.string().min(1),
  payment_type: z.string().optional(),
});

export type MidtransWebhook = z.infer<typeof midtransWebhookSchema>;

// ===== Command WhatsApp (parsing cepat di Step 5) =====
// Pola perintah bot: !bayar, !dashboard, !referal, set budget, dst.
export const waCommandSchema = z.union([
  z.literal("!bayar"),
  z.literal("!dashboard"),
  z.literal("!referal"),
  z.literal("!bantuan"),
]);

export type WaCommand = z.infer<typeof waCommandSchema>;