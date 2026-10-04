// Modul keamanan: JWT Magic Link (exp 30 menit) & token sesi (30 hari).
// Menggunakan library jose (Edge/Node compatible) dengan algoritma HS256.
//
// Alur:
// 1. Bot WA membuat Magic Link: /dash?token=<createMagicToken(phone)>
// 2. proxy.ts memverifikasi token -> tukar dengan cookie ccat_session
// 3. cookie berisi token sesi 30 hari untuk akses dashboard tanpa login ulang.
import { SignJWT, jwtVerify } from "jose";

const TOKEN_TYPE_MAGIC = "magic";
const TOKEN_TYPE_SESSION = "session";
const MAGIC_EXPIRY = "30m";
const SESSION_EXPIRY = "30d";

// Nama cookie sesi dashboard (dipakai proxy.ts & lib/auth.ts).
export const SESSION_COOKIE = "ccat_session";

// Mengambil kunci rahasia JWT dari environment (wajib terisi).
function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET_KEY;
  if (!secret) {
    throw new Error("JWT_SECRET_KEY belum diisi di .env.local");
  }
  return new TextEncoder().encode(secret);
}

// Membuat token bersama: set subject = nomor telepon user.
async function signToken(phoneNumber: string, type: string, expiry: string) {
  return new SignJWT({ type })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(phoneNumber)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(getSecret());
}

// Membuat Magic Link token: berlaku 30 menit, dipakai sekali lewat query ?token=.
export async function createMagicToken(phoneNumber: string): Promise<string> {
  return signToken(phoneNumber, TOKEN_TYPE_MAGIC, MAGIC_EXPIRY);
}

// Membuat token sesi untuk cookie ccat_session: berlaku 30 hari.
export async function createSessionToken(phoneNumber: string): Promise<string> {
  return signToken(phoneNumber, TOKEN_TYPE_SESSION, SESSION_EXPIRY);
}

// Alias nama sesuai spesifikasi awal.
export const generateMagicToken = createMagicToken;
export const generateSessionToken = createSessionToken;

// Memverifikasi token: mengembalikan nomor telepon bila valid, selain itu null.
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    // Signature tidak valid / expired / format salah.
    return null;
  }
}

// Memverifikasi magic link: HANYA menerima token bertipe "magic"
// (token sesi di ?token= ditolak supaya jenis kunci tidak tertukar).
export async function verifyMagicToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.type !== TOKEN_TYPE_MAGIC) {
      return null;
    }
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// Memverifikasi token sesi: hanya menerima token bertipe "session" (bukan magic).
export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.type !== TOKEN_TYPE_SESSION) {
      return null;
    }
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    // Signature tidak valid / expired / format salah.
    return null;
  }
}