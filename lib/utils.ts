// Utility: classname merger (shadcn) + formatter mata uang & tanggal Indonesia.
export { cn } from "cn";

// Memformat angka menjadi mata uang Rupiah, contoh: 35000 -> "Rp35.000".
export function formatIDR(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

// Memformat Rupiah tanpa prefiks "Rp" untuk penggunaan parsial.
export function formatIDRPlain(amount: number): string {
  return amount.toLocaleString("id-ID");
}

// Nama bulan dalam Bahasa Indonesia dipakai untuk judul rekap.
export const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

// Menampilkan label bulan-tahun, contoh: "September 2026".
export function monthYearLabel(date: Date = new Date()): string {
  return `${MONTH_NAMES_ID[date.getMonth()]} ${date.getFullYear()}`;
}

// Label bulan pendek untuk sumbu chart, contoh: "2026-09" -> "Sep 26".
export function monthShortLabel(key: string): string {
  const [y, m] = key.split("-");
  const name = MONTH_NAMES_ID[(Number(m) ?? 1) - 1] ?? "";
  return `${name.slice(0, 3)} ${String(y ?? "").slice(2)}`;
}

// Format ringkas untuk sumbu chart: 7500000 -> "7,5jt", 350000 -> "350rb".
export function formatIDRCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString("id-ID", {
      maximumFractionDigits: 1,
    })}jt`;
  }
  if (Math.abs(n) >= 1_000) {
    return `${Math.round(n / 1_000)}rb`;
  }
  return String(n);
}

// Label bulan dari kunci "YYYY-MM", contoh: "2026-09" -> "September 2026".
export function monthLabelFromKey(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const name = MONTH_NAMES_ID[(month ?? 1) - 1] ?? "";
  return `${name} ${year ?? ""}`.trim();
}

// Daftar kunci bulan "YYYY-MM" (naik), berakhir di bulan sekarang.
// Dipakai untuk dropdown pemilih bulan dashboard (default 12 bulan terakhir).
export function recentMonthKeys(count = 12): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return keys;
}

// Tanggal hari ini zona WIB (Asia/Jakarta) dalam format YYYY-MM-DD.
// Dipakai untuk transaksi & ringkasan harian agar tidak bergeser ke tanggal UTC.
export function todayID(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(new Date());
}

// Tanggal default untuk catatan manual pada bulan tertentu: hari ini bila
// bulan berjalan; bila sedang melihat bulan lalu, tanggal hari ini di-clamp
// ke akhir bulan itu — biar catatan nempel di bulan yang sedang dilihat.
export function defaultDateInMonth(month: string): string {
  const today = todayID();
  if (month === today.slice(0, 7)) return today;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Number(today.slice(8, 10)), lastDay);
  return `${month}-${String(day).padStart(2, "0")}`;
}

// Menampilkan tanggal pendek Indonesia, contoh: "14 Sep 2026".
export function formatDateShort(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}