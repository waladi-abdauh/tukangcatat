// Vercel Cron Job: downgrade/expired user PRO (is_pro = false).
// TODO Step 8: jadwal 00:01 WIB (CRON: 17 17 * * * UTC).
// Data transaksi lama tetap utuh; hanya fitur premium yang dikunci.
import { NextResponse, type NextRequest } from "next/server";
import { guardCron } from "../../../../lib/security/cron-guard";

// Handler GET yang dipicu scheduler Vercel Cron.
export async function GET(request: NextRequest) {
  const denied = guardCron(request);
  if (denied) return denied;
  // TODO Step 8: update profiles yang pro_until < NOW().
  return NextResponse.json({ status: "ok" });
}