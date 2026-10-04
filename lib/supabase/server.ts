// Supabase Server Client untuk Server Components / Route Handlers.
// Memakai cookie sesi ccat_session + anon key; RLS tetap aktif per-user.
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Membuat client Supabase di sisi server dengan konteks cookies request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Membaca semua cookie dari request masuk.
        getAll() {
          return cookieStore.getAll();
        },
        // Menulis cookie kembali pada respons (Route Handler / Server Action).
        // Pada Server Component biasa, cookies() read-only -> lewati; cookie sesi
        // utama tetap dikelola oleh proxy.ts (lib/security/jwt-token.ts).
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Dipanggil dari Server Component: pembaruan cookie tidak diizinkan.
          }
        },
      },
    }
  );
}