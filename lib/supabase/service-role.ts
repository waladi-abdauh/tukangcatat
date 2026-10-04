// Supabase Service Role Client (PROSES SERVER ONLY - JANGAN diimpor ke klien).
// Menggunakan service_role key yang melewati RLS.
// Dipakai oleh: webhook WA, cron job, pembayaran, dsb.
import { createClient } from "@supabase/supabase-js";

// Memastikan key service role tidak bocor ke proses klien.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/service-role.ts hanya boleh dijalankan di server."
  );
}

// Singleton admin client Supabase untuk operasi trusted (bypass RLS).
export const serviceRoleClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);