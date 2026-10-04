// Auth Dashboard: membaca cookie sesi ccat_session untuk Server Component/Action.
// Sesi di-set oleh proxy.ts setelah verifikasi magic token dari link WhatsApp.
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./security/jwt-token";

// Mengambil nomor telepon dari cookie sesi, null bila tidak login / token tak valid.
export async function getSessionPhone(): Promise<string | null> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE);
  if (!session?.value) return null;
  return verifySessionToken(session.value);
}