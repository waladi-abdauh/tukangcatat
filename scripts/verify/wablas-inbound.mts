// Verifikasi parsing payload inbound Wablas -> InboundWAMessage.
//
// Dijalankan TANPA network & tanpa database: murni unit test mapper. Ini yang
// paling rawan salah di migrasi gateway karena Fonnte & Wablas memakai nama
// field yang BERTOLAK (phone/sender terbalik), dan salah baca = bot membalas
// ke dirinya sendiri atau mengabaikan semua pesan user.
//
//   npm run verify:wablas
import assert from "node:assert/strict";

// Set env sebelum import modul yang membaca env saat dipanggil.
process.env.WA_GATEWAY = "wablas";
const { normalizeInboundWebhook, normalizeWablasPayload } = await import(
  "../../lib/wa/inbound.js"
);

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const DEVICE = "6281234567890";
const USER = "6289876543210";

console.log("\n[1] Pemetaan field inti (field paling rawan tertukar)");

check("phone = user, sender = device", () => {
  const r = normalizeInboundWebhook({
    id: "MSG1",
    phone: USER,
    sender: DEVICE,
    message: "kopi 25rb",
    messageType: "text",
    isFromMe: false,
  });
  assert.equal(r.inbound.sender, USER, "phone harus jadi nomor user");
  assert.equal(r.devicePhone, DEVICE, "sender harus jadi nomor device");
  assert.equal(r.inbound.text, "kopi 25rb");
  assert.equal(r.inbound.messageType, "text");
  assert.equal(r.messageId, "MSG1");
  assert.equal(r.isFromMe, false);
  assert.equal(r.isGroup, false);
});

check("nomor format lokal 08.. dinormalisasi ke 62..", () => {
  const r = normalizeInboundWebhook({
    id: "MSG2",
    phone: "089876543210",
    sender: "081234567890",
    message: "bensin 35rb",
    messageType: "text",
  });
  assert.equal(r.inbound.sender, USER);
  assert.equal(r.devicePhone, DEVICE);
});

check("pesan dari device sendiri ditandai isFromMe", () => {
  const r = normalizeInboundWebhook({
    id: "MSG3",
    phone: DEVICE,
    sender: DEVICE,
    message: "!status",
    messageType: "text",
    isFromMe: true,
  });
  assert.equal(r.isFromMe, true);
});

check("grup terdeteksi lewat flag maupun group.subject", () => {
  assert.equal(
    normalizeInboundWebhook({ id: "a", isGroup: true, messageType: "text" })
      .isGroup,
    true
  );
  assert.equal(
    normalizeInboundWebhook({
      id: "b",
      messageType: "text",
      group: { subject: "Keluarga" },
    }).isGroup,
    true
  );
});

console.log("\n[2] Teks & pesan tanpa message id");

check("tanpa id -> messageId null (diproses, tidak didupe)", () => {
  const r = normalizeInboundWebhook({ phone: USER, messageType: "text" });
  assert.equal(r.messageId, null);
});

check("id whitespace diperlakukan kosong", () => {
  assert.equal(
    normalizeInboundWebhook({ id: "   ", phone: USER }).messageId,
    null
  );
});

console.log("\n[3] Media (voice note & foto struk)");

check("ptt -> audio, mime dibersihkan dari parameter", () => {
  const r = normalizeInboundWebhook({
    id: "A1",
    phone: USER,
    sender: DEVICE,
    messageType: "ptt",
    file: "opusp2media_123.ogg",
    url: "https://cdn.wablas.com/media/opusp2media_123.ogg",
    mimeType: "audio/ogg; codecs=opus",
  });
  assert.equal(r.inbound.messageType, "audio");
  assert.equal(r.inbound.mediaMimeType, "audio/ogg");
  assert.equal(r.inbound.mediaUrl, "https://cdn.wablas.com/media/opusp2media_123.ogg");
});

check("image -> image", () => {
  const r = normalizeInboundWebhook({
    id: "I1",
    phone: USER,
    messageType: "image",
    file: "photo.jpg",
    url: "https://cdn.wablas.com/media/photo.jpg",
    mimeType: "image/jpeg",
  });
  assert.equal(r.inbound.messageType, "image");
  assert.equal(r.inbound.mediaMimeType, "image/jpeg");
});

check("media tanpa mimeType ditebak dari ekstensi file", () => {
  assert.equal(
    normalizeWablasPayload({
      phone: USER,
      messageType: "image",
      file: "receipt.png",
      url: "https://cdn.wablas.com/x/receipt.png",
    }).mediaMimeType,
    "image/png"
  );
});

check('field message "File" pada media TIDAK jadi teks', () => {
  // Wablas mengisi message="File" untuk media. Kalau diteruskan, isi struk
  // jadi ikut ter-parse AI dan menyesatkan user.
  const r = normalizeInboundWebhook({
    id: "I2",
    phone: USER,
    messageType: "image",
    message: "File",
    url: "https://cdn.wablas.com/media/receipt.jpg",
  });
  assert.equal(r.inbound.text, undefined);
});

check("URL non-http ditolak (anti SSRF di hulu)", () => {
  assert.equal(
    normalizeWablasPayload({
      phone: USER,
      messageType: "image",
      url: "file:///etc/passwd",
    }).mediaUrl,
    undefined
  );
});

console.log("\n[4] Tipe yang tidak didukung");

check("document/video -> unknown, bukan audio", () => {
  assert.equal(
    normalizeInboundWebhook({ id: "D1", phone: USER, messageType: "document" })
      .inbound.messageType,
    "unknown"
  );
  assert.equal(
    normalizeInboundWebhook({ id: "V1", phone: USER, messageType: "video" })
      .inbound.messageType,
    "unknown"
  );
});

check("messageType kosong -> unknown", () => {
  assert.equal(
    normalizeInboundWebhook({ id: "X1", phone: USER }).inbound.messageType,
    "unknown"
  );
});

console.log(
  `\nSelesai: ${passed} pemeriksaan, exit code ${process.exitCode ?? 0}\n`
);