// Supabase Browser Client untuk komponen klien (Dashboard PWA).
// Dipakai Client Components: membaca data via RLS dengan session anon.
import { createBrowserClient } from "@supabase/ssr";

// Membuat client Supabase di sisi browser memakai anon key (aman untuk publik).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}