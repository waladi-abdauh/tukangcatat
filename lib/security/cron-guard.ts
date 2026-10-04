// Guard endpoint cron: hanya scheduler dengan Authorization: Bearer <CRON_SECRET>
// yang boleh memicu. Dipakai semua route /api/cron/* supaya endpoint publik
// tidak bisa dipakai pihak luar untuk spam WA/Gemini.
import { NextResponse, type NextRequest } from "next/server";

// Balasan penolakan bila request tidak sah; null bila lolos guard.
export function guardCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET belum diset di environment" },
      { status: 503 }
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}