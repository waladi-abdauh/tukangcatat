// Maintenance harian: pangkas tabel penanda webhook yang sudah tidak berguna.
//
// KAPAN JALANKAN: 1x/hari lewat cron sistem di server produksi, misal
//   17 3 * * * cd /var/www/cepatcatat && npm run maintain:cleanup
//
// Kenapa perlu: wa_inbound_seen menahan pesan demi dedupe retry gateway, tapi
// retry hanya berlangsung < 1 jam. Tanpa dipangkas, tabel tumbuh tanpa batas
// (satu baris per pesan, selamanya). Ambang 3 hari memberi timedelta jauh.
//
// Catatan: TIDAK memakai webhook/route Next.js karena dipindah ke Node+PM2
// di DigitalOcean (tidak ada Vercel Cron).
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[cleanup] ${name} belum diisi`);
    process.exit(1);
  }
  return value!;
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

// Tanggal batas per tabel: dedupe webhook & penghitung volume keluar hanya
// perlu retensi singkat, sedangkan histori kuota AI disimpan 90 hari.
const JOBS = [
  { table: "wa_inbound_seen", column: "created_at", days: 3, asTimestamp: true },
  { table: "wa_outbound_usage", column: "used_date", days: 3, asTimestamp: false },
  { table: "ai_usage_daily", column: "used_date", days: 90, asTimestamp: false },
] as const;

for (const job of JOBS) {
  const boundary = new Date(Date.now() - job.days * 24 * 60 * 60 * 1000)
    .toISOString();
  // Kolom DATE dibandingkan sebagai tanggal (tanpa jam), kolom TIMESTAMPTZ penuh.
  const value = job.asTimestamp ? boundary : boundary.slice(0, 10);

  const { error, count } = await supabase
    .from(job.table)
    .delete({ count: "exact" })
    .lt(job.column, value);

  if (error) {
    console.error(`[cleanup] ${job.table} gagal: ${error.message}`);
    process.exit(1);
  }
  console.log(
    `[cleanup] ${job.table}: ${count ?? 0} baris dihapus (< ${value})`
  );
}