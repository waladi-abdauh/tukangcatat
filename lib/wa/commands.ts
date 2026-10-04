// Parsing perintah WhatsApp singkat + pola referral (dipakai di webhook).
import { waCommandSchema, type WaCommand } from "../security/sanitization";

// Pola klaim kode referral: "REF CCAT-XXXXXX".
export const REFERAL_PATTERN = /^REF\s+(CCAT-[A-F0-9]{6})$/i;

// Near-miss: "REF CCAT-..." tapi format belum lengkap -> balas hint, bukan ke AI.
export const REFERAL_PREFIX = /^REF\s+CCAT-/i;

// Alias umum -> perintah kanonis. Nilai dijamin lolos waCommandSchema.
const ALIASES: Record<string, WaCommand> = {
  "!bantuan": "!bantuan",
  "!dashboard": "!dashboard",
  "!dash": "!dashboard",
  "!referal": "!referal",
  "!referral": "!referal",
  "!bayar": "!bayar",
};

// Mengembalikan perintah kanonis bila teks adalah perintah bot, selain null.
export function parseCommand(raw: string): WaCommand | null {
  const candidate = ALIASES[raw.trim().toLowerCase()];
  if (!candidate) return null;
  return waCommandSchema.safeParse(candidate).success ? candidate : null;
}