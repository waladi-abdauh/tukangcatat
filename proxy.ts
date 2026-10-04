// Proxy: proteksi /dash & tukar magic token (dari link WhatsApp) menjadi cookie sesi.
//
// Alur:
// 1. User tap link /dash?token=<magic> dari chat bot.
// 2. Proxy verifikasi magic token (berlaku 30 menit).
// 3. Bila valid -> set cookie ccat_session (30 hari) lalu redirect ke /dash.
// 4. Bila token cacat/expired -> redirect ke landing.
// - Tanpa token & tanpa sesi: biarkan masuk, layout /dash yang mengalihkan ke landing.
import { NextResponse } from "next/server";
import type { NextProxy } from "next/server";
import { createSessionToken, verifyMagicToken, SESSION_COOKIE } from "./lib/security/jwt-token";

const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 hari

export const proxy: NextProxy = async (request) => {
  const { pathname } = request.nextUrl;
  const isDash = pathname === "/dash" || pathname.startsWith("/dash/");
  if (!isDash) {
    return NextResponse.next();
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.next();
  }

  const phone = await verifyMagicToken(token);
  const landing = new URL("/", request.url);

  if (!phone) {
    // Magic link tidak valid / kedaluwarsa -> landing + penanda untuk banner.
    landing.searchParams.set("login", "invalid");
    console.warn("[proxy] magic token tidak valid/kedaluwarsa, arahkan ke landing");
    return NextResponse.redirect(landing);
  }

  const sessionToken = await createSessionToken(phone);
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol;
  const secure = proto.replace(/:$/, "") === "https";

  const url = new URL("/dash", request.url);
  const response = NextResponse.redirect(url);
  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
};

// Proxy berjalan hanya untuk area dashboard.
export const config = {
  matcher: ["/dash", "/dash/:path*"],
};