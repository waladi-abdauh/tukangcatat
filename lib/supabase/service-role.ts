// Supabase Service Role Client (PROSES SERVER ONLY - JANGAN diimpor ke klien).
// Menggunakan service_role key yang melewati RLS.
// Dipakai oleh: webhook WA, cron job, pembayaran, dsb.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Memastikan key service role tidak bocor ke proses klien.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/service-role.ts hanya boleh dijalankan di server."
  );
}

// Client dibuat LAZY, bukan di module scope.
//
// Kenapa: `next build` mengevaluasi module route ("collect configuration")
// untuk mengekstrak runtime/dynamic/maxDuration. Runner CI sengaja TIDAK
// punya SUPABASE_SERVICE_ROLE_KEY (secret runtime hidup hanya di
// /opt/cepatcatat/shared/.env di VPS, lihat deploy.yml). Kalau createClient
// dipanggil di top-level, evaluasi module di runner langsung mati dengan
// "supabaseKey is required." Client baru dibuat saat sifat pertama kali
// diakses oleh pemakaian sungguhan, jadi import/build/prerender aman.
let client: SupabaseClient | null = null;

function buildClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL belum terisi saat runtime."
    );
  }
  return createClient(url, key);
}

// Singleton admin client Supabase untuk operasi trusted (bypass RLS).
// Proxy ini hanya jembatan: panggilan method diteruskan ke client asli dengan
// `this` yang benar (metode di-bind) supaya supabase-js tidak kehilangan state.
export const serviceRoleClient: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    client ??= buildClient();
    const value = client[prop as keyof SupabaseClient];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});