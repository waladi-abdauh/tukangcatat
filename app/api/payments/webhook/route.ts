// Webhook Callback Midtrans untuk settlement pembayaran.
// TODO Step 7: verifikasi signature_key, status 'settlement' -> aktifkan PRO 30 hari,
// reward referral (referrer) + bonus kuota AI (referee), kirim ucapan via WA.

// Handler POST callback dari Midtrans.
export async function POST() {
  // TODO Step 7: verifikasi signature & update database.
  return Response.json({ status: "ok" });
}