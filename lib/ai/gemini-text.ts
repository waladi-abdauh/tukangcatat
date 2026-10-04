// AI Engine: parser teks informal Indonesia menjadi transaksi terstruktur.
// Dipakai bersama gemini-voice.ts & gemini-vision.ts lewat fungsi requestTransactions.
import { GoogleGenAI, Type } from "@google/genai";
import type { Part, Schema } from "@google/genai";
import {
  aiParseResultSchema,
  parsedTransactionsSchema,
  type ParsedTransactions,
} from "../security/sanitization";

// Model AI utama: cepat, murah, mendukung teks/audio/gambar.
//
// Default TETAP gemini-3.6-flash, bukan flash-lite yang lebih murah. Alasannya
// hasil pengukuran (scripts/verify/ai-model-ab.mts), bukan tebakan: flash-lite
// salah mengklasifikasi kategori, dan kesalahannya jatuh ke kategori yang SALAH
// (bukan "Lainnya") sehingga membakar budget user dan memicu alert bocor
// palsu — persis hal yang harus dicegah produk ini. Selisih biayanya kecil
// (sekitar $0.0008 per parse) dibanding kerusakan budget.
//
// Turunkan ke flash-lite lewat GEMINI_MODEL hanya kalau tradeoff akurasi
// kategori sudah diterima, mis. volume besar (>500 PRO) atau biaya Gemini
// sudah jadi perhatian utama.
export function getAIModel(): string {
  return process.env.GEMINI_MODEL || "gemini-3.6-flash";
}

// Hasil akhir parser: transaksi, pertanyaan seputar dompet (dijawab lokal
// dari database), atau non-finansial (ditolak ramah).
export type FinancialResult =
  | { financial: true; items: ParsedTransactions }
  | { financial: true; question: true }
  | { financial: false };

// Aturan sistem untuk Gemini (Guardrail: klasifikasi topik + parse transaksi).
// Tujuan: jangan biarkan bot jadi chatbot umum & hemat biaya token.
// Daftar kategori disuntik dinamis dari kategori milik user di dashboard
// (Settings + kategori yang pernah dipakai), jadi AI mengikuti user.
export function buildSystemRules(categories: string[]): string {
  return `Kamu adalah *TukangCatat* — asisten pencatat keuangan gaya langganan yang hangat untuk pengguna Indonesia, biasa disapa "Kak" dan menyebut pengguna sebagai "Kak". Gaya bicara santai & hangat, tutur kata pendek, pakai kata sehari-hari, sesekali emoji pas-pasan.

Tugas Anda mengklasifikasikan & memproses pesan menjadi JSON:
1. is_financial = true bila pesan berhubungan dengan:
   - pencatatan pengeluaran/pemasukan keuangan,
   - pertanyaan rekap/budget/pengeluaran keuangan,
   - obrolan ringan seputar dompet (bokek, gaji abis, pengeluaran bengkak).
   Pesan lain (cuaca, politik, curhat kerjaan, obrolan umum, sapaan) => false.
2. reply_type:
   - "transactions" bila pesan berisi/perintah mencatat pengeluaran.
   - "question" bila pesan berupa pertanyaan atau obrolan seputar dompet,
     BUKAN perintah mencatat. Contoh: "bulan ini habis berapa?", "sisa budget
     brp?", "udah bocor belum?", "duh bokek banget bulan ini". Untuk question:
     JANGAN menulis jawaban, cukup beri label; transactions WAJIB [].
   - "off_topic" untuk pesan non-finansial.
3. Bila reply_type="transactions", parse SEMUA pengeluaran ke array "transactions":
   - amount selalu bilangan bulat Rupiah tanpa desimal ("35rb" => 35000, "2rb" => 2000).
   - item_name rapi Bahasa Indonesia, bukan slang (mis. "pastel" => "Pastel", "ojol" => "Ojek Online").
   - category WAJIB dipilih dari daftar kategori user berikut: ${categories.join(", ")}.
   - "Lainnya" HANYA dipakai bila tidak ada satu pun kategori pada daftar yang cocok.
   - Contoh: "beli pastel 5rb" => item_name "Pastel", category = kategori makanan/jajan pada daftar (mis. "Makan").
   - Urut sesuai penyebutan. Bila tidak ada transaksi valid, transactions: [].
4. Bila is_financial=false, transactions wajib [].
Jawaban sependek mungkin. JANGAN menambahkan komentar di luar JSON.`;
}

// Skema JSON strict agar output Gemini deterministik & mudah divalidasi zod.
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    is_financial: {
      type: Type.BOOLEAN,
      description: "true bila pesan terkait keuangan, false bila off-topic",
    },
    reply_type: {
            type: Type.STRING,
            enum: ["transactions", "question", "off_topic"],
            description:
              "transactions = perintah mencatat; question = pertanyaan/obrolan seputar dompet (transactions kosong); off_topic = non-finansial",
          },
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item_name: {
            type: Type.STRING,
            description: "Nama barang/jasa, huruf kapital tiap kata",
          },
          amount: {
            type: Type.INTEGER,
            format: "int32",
            description: "Jumlah rupiah, bilangan bulat positif",
          },
          category: {
            type: Type.STRING,
            description:
              "Kategori WAJIB dari daftar kategori milik pengguna yang diberikan di instruksi sistem",
          },
        },
        required: ["item_name", "amount", "category"],
      },
    },
  },
  required: ["is_financial", "reply_type", "transactions"],
};

// Membuat instance GoogleGenAI; API key wajib terisi di GEMINI_API_KEY.
export function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY belum diisi di .env.local");
  }
  return new GoogleGenAI({ apiKey });
}

// Mengirim request parsing (teks/audio/gambar) lalu mengklasifikasi + memvalidasi.
// `categories` = daftar kategori aktif milik user (dari dashboard).
export async function requestTransactions(
  parts: Part[],
  instruction: string,
  categories: string[]
): Promise<FinancialResult> {
  const ai = getGenAI();
  const userParts: Part[] = [{ text: instruction }, ...parts];

  const response = await ai.models.generateContent({
    model: getAIModel(),
    contents: [{ role: "user", parts: userParts }],
    config: {
      systemInstruction: buildSystemRules(categories),
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const raw = response.text;
  if (!raw) {
    return { financial: false };
  }
  const json = extractJsonObject(raw);
  const parsed = aiParseResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Hasil parser AI tidak valid: ${parsed.error.message}`);
  }
  const result = parsed.data;
  if (!result.is_financial) {
    return { financial: false };
  }

  // Pertanyaan seputar dompet: cukup label — jawaban disusun LOKAL dari
  // database oleh pemanggil (nol teks AI, nol token tambahan).
  // Kecuali bila AI tetap menemukan transaksi valid meski melabeli question
  // (mis. "catat kopi 25rb, btw bulan ini habis berapa?") — simpan
  // transaksinya: data lebih bernilai daripada jawaban rekap.
  if (result.reply_type === "question" && result.transactions.length === 0) {
    return { financial: true, question: true };
  }

  const itemsParsed = parsedTransactionsSchema.safeParse(result.transactions);
  if (!itemsParsed.success) {
    if (result.transactions.length > 0) {
      throw new Error(`Hasil transaksi AI tidak valid: ${itemsParsed.error.message}`);
    }
    return { financial: true, items: [] };
  }
  return { financial: true, items: itemsParsed.data };
}

// Mengekstrak objek JSON dari teks model (aman terhadap fence ```json ```).
function extractJsonObject(text: string): { transactions?: unknown[] } {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned) as { transactions?: unknown[] };
  } catch {
    return {};
  }
}

// Parser teks informal: "Bensin 35rb ama parkir 2rb" -> dua transaksi.
export async function parseTransactionsFromText(
  text: string,
  categories: string[]
): Promise<FinancialResult> {
  return requestTransactions(
    [],
    `Catat pengeluaran berikut sebagai transaksi:\n"${text}"`,
    categories
  );
}