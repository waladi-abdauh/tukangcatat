// WA Inbound: normalisasi payload mentah gateway menjadi InboundWAMessage.
// Mendukung Fonnte & Wablas; struktur output disamakan lintas gateway
// (Fonnte/Wablas/Meta Cloud API) agar pipeline bisnis tidak berubah.
//
// Perbedaan penting antar gateway yang ditangani di sini:
// - Fonnte: `sender` = nomor USER, `device` = nomor bot, `extension` = tipe.
// - Wablas: `phone`   = nomor USER, `sender` = nomor BOT (!), `messageType` = tipe.
// Field dibalik; kalau tertukar, bot akan membalas ke dirinya sendiri.
import type { InboundWAMessage } from "../security/sanitization";

// Payload mentah webhook Fonnte (subset yang dipakai).
export interface FonnteWebhookPayload {
  device?: unknown;
  sender?: unknown;
  name?: unknown;
  message?: unknown;
  member?: unknown;
  url?: unknown;
  filename?: unknown;
  extension?: unknown;
  secret?: unknown;
  // Id pesan dari Fonnte; dipakai sebagai kunci dedupe inbound (anti retry).
  rrn?: unknown;
}

// Payload mentah webhook Wablas (subset yang dipakai).
// Dokumentasi: `phone` = pengirim pesan, `sender` = nomor device.
export interface WablasWebhookPayload {
  id?: unknown;
  pushName?: unknown;
  isGroup?: unknown;
  group?: unknown;
  message?: unknown;
  phone?: unknown;
  messageType?: unknown;
  file?: unknown;
  url?: unknown;
  mimeType?: unknown;
  deviceId?: unknown;
  sender?: unknown;
  isFromMe?: unknown;
  timestamp?: unknown;
}

// Hasil normalisasi lintas gateway + konteks envelope yang dibutuhkan webhook.
export interface NormalizedWebhook {
  // Id pesan gateway untuk dedupe. Null = gateway tidak mengirim id, maka
  // pesan diproses tanpa dedupe (lebih baik proses ulang daripada membuang
  // transaksi sah dari user yang mengirim pesan identik dua kali).
  messageId: string | null;
  inbound: InboundWAMessage;
  // Nomor device/bot pengirim ("" bila gateway tidak mengirimnya).
  devicePhone: string;
  isFromMe: boolean;
  isGroup: boolean;
}

// Ekstensi -> MIME. Fonnte memberi `extension` tanpa titik.
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  amr: "audio/amr",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  aac: "audio/aac",
  mp4: "video/mp4",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Buang parameter MIME ("audio/ogg; codecs=opus" -> "audio/ogg").
function baseMime(raw: unknown): string | undefined {
  const mime = String(raw ?? "").split(";")[0]!.trim().toLowerCase();
  return mime !== "" ? mime : undefined;
}

// Klasifikasi tipe pesan WA berdasarkan MIME.
function classifyMessageType(
  mime: string | undefined
): InboundWAMessage["messageType"] {
  if (!mime) return "text";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "unknown";
}

// Nomor telepon bersih (hanya digit) + normalisasi format lokal 08.. -> 628..
export function normalizePhoneDigits(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return d;
}

// URL media hanya dipakai bila string berawalan http(s):// yang valid.
function mediaUrlOf(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  return /^https?:\/\//.test(raw) ? raw : undefined;
}

// ===== Fonnte =====

export function normalizeFonntePayload(
  payload: FonnteWebhookPayload
): InboundWAMessage {
  const extension = String(payload.extension ?? "")
    .replace(/^\./, "")
    .toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  const mediaUrl = mediaUrlOf(payload.url);
  const messageType = classifyMessageType(
    mimeType ?? (mediaUrl ? extension : undefined)
  );
  const rawText =
    typeof payload.message === "string" && payload.message.trim() !== ""
      ? payload.message
      : undefined;

  return {
    sender: normalizePhoneDigits(payload.sender),
    messageType,
    // Untuk media, `message` berisi nama file/bukan teks user — jangan
    // diteruskan sebagai teks atau isinya akan ikut diparse AI.
    text: messageType === "text" ? rawText : undefined,
    mediaUrl,
    mediaMimeType: mimeType,
  };
}

// ===== Wablas =====

// messageType Wablas sudah otoritatif; selain 3 tipe yang didukung app
// (text/audio/image) dipetakan ke "unknown" agar tidak salah parsing.
function classifyWablasType(raw: unknown): InboundWAMessage["messageType"] {
  switch (String(raw ?? "").trim().toLowerCase()) {
    case "text":
      return "text";
    case "audio":
    case "ptt":
      return "audio";
    case "image":
      return "image";
    default:
      return "unknown";
  }
}

export function normalizeWablasPayload(
  payload: WablasWebhookPayload
): InboundWAMessage {
  const messageType = classifyWablasType(payload.messageType);
  const mediaUrl = mediaUrlOf(payload.url);
  // Fallback mime: dari nama file bila Wablas tidak mengirim mimeType.
  const mimeType =
    baseMime(payload.mimeType) ??
    MIME_BY_EXTENSION[extensionOf(payload)];
  const rawText =
    typeof payload.message === "string" && payload.message.trim() !== ""
      ? payload.message
      : undefined;

  return {
    // `phone` = user. `sender` di Wablas adalah nomor device.
    sender: normalizePhoneDigits(payload.phone),
    messageType,
    // Pesan media bernilai "File" pada field `message` — bukan teks user.
    text: messageType === "text" ? rawText : undefined,
    mediaUrl,
    mediaMimeType: mimeType,
  };
}

// Ekstensi tanpa titik dari nama file Wablas ("" bila tidak ada).
function extensionOf(payload: WablasWebhookPayload): string {
  const file = String(payload.file ?? "").trim().toLowerCase();
  const dot = file.lastIndexOf(".");
  return dot > -1 ? file.slice(dot + 1) : "";
}

// ===== Dispatcher =====

// Normalisasi payload mentah menjadi envelope lintas-gateway.
export function normalizeInboundWebhook(payload: unknown): NormalizedWebhook {
  const gateway = process.env.WA_GATEWAY ?? "fonnte";
  const raw = (payload ?? {}) as Record<string, unknown>;

  if (gateway === "wablas") {
    const p = raw as WablasWebhookPayload;
    const group = (p.group ?? {}) as Record<string, unknown>;
    const isGroup =
      p.isGroup === true || p.isGroup === "true" || String(group.subject ?? "") !== "";
    return {
      messageId:
        typeof p.id === "string" && p.id.trim() !== "" ? p.id.trim() : null,
      inbound: normalizeWablasPayload(p),
      devicePhone: normalizePhoneDigits(p.sender),
      isFromMe: p.isFromMe === true || p.isFromMe === "true",
      isGroup,
    };
  }

  const p = raw as FonnteWebhookPayload;
  return {
    messageId: typeof p.rrn === "string" && p.rrn.trim() !== "" ? p.rrn.trim() : null,
    inbound: normalizeFonntePayload(p),
    devicePhone: normalizePhoneDigits(p.device),
    // Fonnte menandai pesan milik device sendiri lewat `from_me`; `member`
    // menandai pesan grup (diabaikan karena bot personal).
    isFromMe: raw.from_me === true || raw.from_me === "true",
    isGroup: p.member != null && String(p.member).trim() !== "",
  };
}