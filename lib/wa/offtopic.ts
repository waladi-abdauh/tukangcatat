// Deteksi sapaan singkat (off-topic friendly) tanpa biaya token AI.
// Dipakai setelah Gemini menandai pesan non-finansial, agar balasan sapaan
// tetap hangat tanpa mengirim request tambahan.
export const GREETING_PATTERN =
  /^(halo|hii|hai|hei|hi|hello|halo\s*bot|p\b|kak|om|punten|permisi|salam|assalamualaikum|assalamu'alaikum|selamat\s+(pagi|siang|sore|malam)|apa\s+kabar|kamu\s+siapa|ini\s+bot|lagi\s+apa)/i;

// true bila teks berupa sapaan/kenalan, mis. "halo", "kamu siapa", "apa kabar kak?".
export function isGreetingMessage(text: string): boolean {
  return GREETING_PATTERN.test(text.trim());
}