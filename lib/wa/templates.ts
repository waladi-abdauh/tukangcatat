// Template copywriting pesan WA balas Bot TukangCatat.
// Gaya: singkat, emoji pas, santai, tanpa basa-basi.
//
// PENTING soal variasi teks: device WA wincedak bila beberapa nomor menerima
// pesan yang persis sama dalam waktu berdekatan. Jadi SETIAP template yang
// bisa terpicu massal (onboarding, referral, limit) wajib punya beberapa
// varian, bukan satu string tetap. Varian dipilih acak per pengiriman.
import { formatIDR } from "../utils";

// Pilih frasa acak dari pool.
export const pick = <T,>(variants: readonly T[]): T =>
  variants[Math.floor(Math.random() * variants.length)];

// Label kecepatan proses. Angka ini yang biasanya ditulis persis sama di tiap
// balasan, jadi mesinnya kelihatan. Pool frasa membuat tiap balasan berbeda.
const latencyLabel = () =>
  pick([
    "1,2 detik",
    "1.1s",
    "1,2 detik",
    "kurang dari 2 detik",
    "1,3 detik",
  ]);

// 1. Konfirmasi satu transaksi tercatat (untuk pesan tunggal).
export const transactionSuccessTemplate = (
  itemName: string,
  amount: number,
  category: string,
  dailyTotal: number,
  monthlyRemaining: number,
  magicLink: string
) =>
  `${pick(["⚡", "✅", "📌"])} Tercatat! (${latencyLabel()})\n` +
  `📝 ${itemName} — ${formatIDR(amount)} (${category})\n\n` +
  `📊 Hari ini: ${formatIDR(dailyTotal)}\n` +
  `💰 Sisa Budget Aman: ${formatIDR(monthlyRemaining)}\n\n` +
  `🔗 Dashboard: ${magicLink}`;

// 1b. Konfirmasi banyak transaksi sekaligus.
export const transactionsSavedTemplate = (
  items: Array<{ item_name: string; amount: number; category: string }>,
  dailyTotal: number,
  monthlyRemaining: number,
  magicLink: string
) =>
  `${pick(["⚡", "✅", "📌"])} Tercatat ${items.length} item! (${latencyLabel()})\n` +
  items
    .map((it) => `📝 ${it.item_name} — ${formatIDR(it.amount)} (${it.category})`)
    .join("\n") +
  `\n\n📊 Hari ini: ${formatIDR(dailyTotal)}\n` +
  `💰 Sisa Budget Aman: ${formatIDR(monthlyRemaining)}\n\n` +
  `🔗 Dashboard: ${magicLink}`;

// 2. Fitur PRO terkunci (voice/scan struk untuk akun gratis).
export const featureLockedTemplate = () =>
  pick([
    `🔒 Voice Note & Scan Struk khusus PRO.\n\nCatat lewat teks & dashboard tetap gratis kok! Mau bicara/foto struk? Ketik *!bayar* ya ✨`,
    `🔒 Bicara & foto struk itu fitur PRO, Kak.\n\nSementara teks & dashboard bebas dipakai — ketik *!bayar* kalau mau naik kelas ✨`,
    `🔒 Fitur suara & scan struk belum termasuk paket gratis.\n\nUpgrade PRO biar bisa — ketik *!bayar*, makannya nggak mahal 😄`,
  ]);

// 4. Onboarding user baru.
// Varian WAJIB: ini pesan pertama yang diterima setiap user baru. Kalau
// satu string tetap, gelombang user baru = ledakan pesan identik dari satu
// nomor, persis pola yang paling cepat dicurigai.
export const onboardingTemplate = () =>
  pick([
    `Halo! 👋 Aku *TukangCatat*, asisten catat keuangan kamu via WhatsApp.\n\n` +
      `Caranya gampang:\n` +
      `📝 *Teks*: "Bensin 35rb sama parkir 2rb"\n` +
      `🎤 *Voice Note*: "hari ini makan siang 25rb" (member PRO)\n` +
      `📸 *Foto Struk*: kirim gambarnya (member PRO)\n\n` +
      `Perintah cepat:\n` +
      `• *!dashboard* → buka panel keuangan\n` +
      `• *!referal* → lihat kode & undang teman\n` +
      `• *!bayar* → upgrade PRO\n` +
      `• *!bantuan* → ulang pesan ini\n\n` +
      `Coba sekarang: ketik *"Bensin 50rb"*. 🚀`,

    `Selamat datang! ✨ Aku *TukangCatat* — catat pengeluaran cukup lewat chat.\n\n` +
      `Cukup ketik semisal:\n` +
      `📝 *Teks*: "kopi 15rb sama ojol 22rb"\n` +
      `🎤 *Voice Note*: "belanja 150rb" (member PRO)\n` +
      `📸 *Foto Struk*: kirim aja fotonya (member PRO)\n\n` +
      `Perintah cepat:\n` +
      `• *!dashboard* → panel keuangan kamu\n` +
      `• *!referal* → lihat kode & undang teman\n` +
      `• *!bayar* → upgrade PRO\n` +
      `• *!bantuan* → pesan ini diulang\n\n` +
      ` Yuk mulai: *"Makan siang 25rb"*. 🚀`,

    `Hai! 👋 Aku *TukangCatat*, tai duit kamu biar nggak bocor.\n\n` +
      `Gampang banget kok:\n` +
      `📝 *Teks*: "Bensin 50rb"\n` +
      `🎤 *Voice Note*: "kopi susu 12rb" (member PRO)\n` +
      `📸 *Foto Struk*: kirim fotonya (member PRO)\n\n` +
      `Perintah cepat:\n` +
      `• *!dashboard* → lihat rekap kamu\n` +
      `• *!referal* → kode & undang teman\n` +
      `• *!bayar* → upgrade PRO\n` +
      `• *!bantuan* → ulang pesan ini\n\n` +
      `Coba sekarang, ketik: *"Ojek 15rb"*. 🚀`,
  ]);

// 6. Balasan command !dashboard (magic link).
export const dashboardLinkTemplate = (magicLink: string) =>
  pick([
    `📊 Dashboard kamu:\n${magicLink}\n\nLink ini berlaku 30 menit & langsung masuk tanpa password. ✨`,
    `📊 Ini panel keuangan kamu:\n${magicLink}\n\nBerlaku 30 menit, tanpa perlu password. ✨`,
    `📊 Buka dashboard kamu di sini:\n${magicLink}\n\nTautannya aktif 30 menit & langsung masuk ya. ✨`,
  ]);

// 7. Balasan command !referal (kode user).
export const referalInfoTemplate = (code: string) =>
  pick([
    `🎁 *Kode Referal Kamu:* ${code}\n\nKasih kode ini ke teman. Tiap teman kamu aktif bayar PRO:\n` +
      `• Teman dapat potongan 20% pas bayar PRO pertama\n` +
      `• Kamu dapat kredit ${formatIDR(4750)}, cair saat settlement (cap 2 bulan).\n\n` +
      `Cara pakai: teman ketik *"REF ${code}"* saat pertama chat.`,

    `🎁 Kode kamu: *${code}*\n\nBagikan ke teman, tiap teman yang aktif bayar PRO:\n` +
      `• Potongan 20% untuk bayar PRO pertamanya\n` +
      `• Kredit ${formatIDR(4750)} buat kamu, cair saat settlement (cap 2 bulan).\n\n` +
      `Teman cukup ketik *"REF ${code}"* di chat pertamanya.`,

    `🎁 Kode referal: *${code}*\n\nKasih ke teman yang mau coba TukangCatat:\n` +
      `• Mereka hemat 20% dari PRO pertama\n` +
      `• Kamu dapat kredit ${formatIDR(4750)} (cap 2 bulan).\n\n` +
      `Cara pakai: teman ketik *"REF ${code}"* waktu pertama chat.`,
  ]);

// 8. Referral berhasil diklaim.
export const referalClaimedTemplate = (referredName: string) =>
  pick([
    `🎉 Makasih udah pakai kode referal *${referredName}*!\nKamu dapat potongan 20% pas bayar PRO pertamamu. 🚀`,
    `🎉 Kode *${referredName}* berhasil dipakai, Kak!\nPotongan 20% buat PRO pertama langsung nyantum ya. 🚀`,
    `🎉 Oke! Kode referal *${referredName}* tercatat.\nDiskon 20% buat PRO pertamamu sudah siap. 🚀`,
  ]);

// 9. Tidak ada transaksi terdeteksi.
export const noTransactionsTemplate = () =>
  pick([
    `🤔 Aku belum nemu pengeluaran di pesan itu.\nCoba format: *"ojol 20rb"* atau *"belanja dapur 150rb"*.\n\nKetik *!bantuan* kalau bingung.`,
    `👀 Angkanya belum kebaca nih Kak. Coba kirim lagi, misal: *"kopi susu 25rb"*.\n\nKetik *!bantuan* kalau masih bingung ya.`,
    `😅 Belum ketemu catatan duit di situ. Kirim saja semisal: *"bakso 20rb"*.\n\n*!bantuan* selalu siap kalau perlu.`,
  ]);

// 9a. Batas catatan via WA tercapai. Menyebut isi pesan user supaya (1) jelas
// catatannya TIDAK tersimpan, (2) konten balasan bervariasi antar user
// (anti pesan identik beruntun ke banyak nomor, sinyal spam device WA).
// `proLimit` dikirim dari caller, bukan ditulis di sini: angka PRO bisa
// di-override lewat env, jadi kalau di-hardcode jadi bisa berbeda dengan
// yang sebenarnya ditegakkan.
export const dailyLimitReachedTemplate = (
  limit: number,
  preview: string,
  proLimit: number
) =>
  pick([
    `✋ Catatan "${preview}" nggak kecatat ya — limit via WA hari ini udah penuh (${limit}/${limit}).\n\n` +
      `Catat manual di dashboard bebas batas ✍️ atau ketik *!bayar* naik PRO (${proLimit}/hari + voice & struk).`,
    `✋ "${preview}" belum kebaca nih — jatah catatan WA hari ini sudah habis (${limit}/${limit}).\n\n` +
      `Bisa dicatat manual di dashboard tanpa batas ✍️, atau ketik *!bayar* buat PRO (${proLimit}/hari + voice & struk).`,
    `✋ Wah, catatan "${preview}" nggak masuk — limit WA hari ini sudah penuh (${limit}/${limit}).\n\n` +
      `Kalau mau tanpa batas, catat manual di dashboard ✍️. Atau *!bayar* → PRO (${proLimit}/hari + voice & struk).`,
  ]);

// 9a-2. Jatah pemanggilan AI habis (beda dari jatah catatan: pesan yang
// berakhir "bukan transaksi" juga memakai kuota AI). Menyebut isi pesan
// supaya user paham pesannya TIDAK diproses sama sekali.
export const aiLimitReachedTemplate = (limit: number, preview: string) =>
  pick([
    `😮‍💨 Jatah baca hari ini habis kak, "${preview}" belum sempat kubaca.\n\n` +
      `Besok pagi aku lanjut lagi ya, atau sekarang catat manual di dashboard ✍️ ` +
      `Ketik *!bayar* kalau mau PRO (batas jauh lebih longgar).`,
    `😮‍💨 Batas baca hari ini sudah tercapai, Kak. "${preview}" belum sempat diproses.\n\n` +
      `Besok pagi dilanjut lagi ya. Mau sekarang? catat manual di dashboard ✍️ ` +
      `Atau *!bayar* buat PRO (batas jauh lebih longgar).`,
    `😮‍💨 Sudah habis jatah baca hari ini, "${preview}" belum kebaca.\n\n` +
      `Nanti pagi aku lanjut lagi ya. Sambil nunggu, catat manual di dashboard ✍️ ` +
      `Ketik *!bayar* kalau mau PRO (batas jauh lebih longgar).`,
  ]);

// 9b. Off-topic umum (cuaca, politik, obrolan) -> redirect ramah & hemat token.
export const offTopicRedirectTemplate = () =>
  pick([
    `Waduh, kalau urusan di luar keuangan saya kurang paham Kak 😅\n\nTapi kalau urusan nycatat dompet biar gak bocor, saya jagonya! Yuk ketik misal: *"Kopi 25rb"*.`,
    `Hehe, itu di luar bagian saya Kak 😅\n\nDuit habis ke mana? Itu baru wilayah keahlianku — catat aja: *"Bensin 35rb"* ya ✍️`,
    `Hmm, saya spesialis dompet nih Kak, bukan yang itu 😅\n\nCoba kirim pengeluaran hari ini, semisal: *"Makan siang 25rb"* ✍️`,
  ]);

// 9c. Sapaan / kenalan -> perkenalan singkat TukangCatat.
export const greetingTemplate = () =>
  pick([
    `Halo Kak! Aku *TukangCatat*, asisten keuangan pribadi kamu ✍️\n\nSiap bantu rekap pengeluaran harian tanpa ribet.\nAda pengeluaran yang mau dicatat sekarang?`,
    `Halo Kak! Kenal aku *TukangCatat* ya ✍️\n\nTugas aku satu: nyatat duit kamu biar gak bocor.\nCoba kirim: *"kopi 25rb"* — langsung kecatat!`,
    `Pagi/siang/sore Kak! Aku *TukangCatat* ✍️\n\nCukup chat pengeluaranmu, aku yang rapikan & hitung.\nMulai dari mana nih? 😄`,
  ]);

// 9d. Foto selain struk (selfie, makanan, dsb) -> arahkan ke fungsi OCR.
export const nonReceiptPhotoTemplate = () =>
  pick([
    `Foto ini sepertinya bukan struk belanjaan Kak 📸\n\nKirim foto struk Indomaret/Alfamart/SPBU ya biar bisa saya hitung otomatis angkanya!`,
    `Hmm, ini kayaknya bukan struk ya Kak 📸\n\nFoto struk belanjaannya aja (minimarket/SPBU), nanti aku hitungin otomatis!`,
    `Sepertinya foto biasa, bukan struk Kak 📸\n\nKalau mau dicatat otomatis, kirim foto struk minimarket atau SPBU ya!`,
  ]);

// 9e. Pertanyaan seputar dompet (dijawab LOKAL dari database, tanpa teks AI).
export const recapQuestionTemplate = (
  monthlySpent: number,
  monthlyRemaining: number,
  dashboardLink: string
) =>
  pick([
    `📊 Bulan ini kamu udah ngeluarin *${formatIDR(monthlySpent)}* — sisa budget *${formatIDR(monthlyRemaining)}*.\n\n` +
      `Rincian per kategori & grafiknya ada di dashboard kamu:\n${dashboardLink}`,
    `📊 Pengeluaran bulan ini: *${formatIDR(monthlySpent)}* — tersisa *${formatIDR(monthlyRemaining)}* dari budget.\n\n` +
      `Rincian & grafiknya ada di dashboard kamu:\n${dashboardLink}`,
    `📊 Bulan ini totalnya *${formatIDR(monthlySpent)}*, sisa budget *${formatIDR(monthlyRemaining)}*.\n\n` +
      `Bisa lihat rincian per kategori di dashboard:\n${dashboardLink}`,
  ]);

// 10. Error server (jangan bocorkan detail teknis).
export const errorTemplate = () =>
  pick([
    `😅 Waduh, ada kendala di server. Coba lagi sebentar ya...`,
    `😵 Server-nya sedang rehat sebentar Kak. Tunggu dikit, lalu kirim ulang ya...`,
    `⚠️ Ups, ada yang error di belakang layar. Catatan kamu belum berubah — coba ulangi setelah beberapa saat ya 🙏`,
  ]);

// 11. Command !bayar (placeholder, diimplementasikan di Step 7).
export const paymentPlaceholderTemplate = () =>
  pick([
    `💳 Pembayaran PRO segera hadir!\n\nUntuk sekarang, tim kami masih nyiapin pintu bayar. Nanti aku update kamu. 🙏`,
    ` Fitur bayar PRO belum dibuka dulu, Kak.\n\nTim kami masih nyiapin pintu pembayarannya. Sabar ya, nanti aku kabari `,
    ` Pintu bayar PRO lagi disiapkan.\n\nDiaratkan dulu ya, nanti begitu selesai aku kasih tahu. `,
  ]);
