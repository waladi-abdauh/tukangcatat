// API Generate QRIS Midtrans (upgrade PRO Rp19.000/bulan).
// TODO Step 7: buat order_id CCAT-PRO-{ts}-{userId}, potong credit_balance, Snap Token.

// Handler POST untuk membuat link pembayaran QRIS.
export async function POST() {
  // TODO Step 7: validasi auth user, hitung amount, request Snap Token.
  return Response.json({ order_id: "", snap_url: "", snap_token: "" });
}