#!/usr/bin/env node
// Smoke test end-to-end Wablas: kirim pesan via gateway yang sedang aktif.
// Dipakai setelah cutover Fonnte -> Wablas untuk memastikan outbound jalan.
//
//   npm run smoke:gateway
import { createWAOutboundAdapter } from "../../lib/wa/client.ts";

const TO = process.env.DEV_TEST_PHONE;
if (!TO) {
  console.error("DEV_TEST_PHONE belum diisi di .env.local");
  process.exit(1);
}

const gateway = process.env.WA_GATEWAY ?? "fonnte";
const token =
  gateway === "wablas"
    ? process.env.WA_WABLAS_TOKEN
    : (process.env.WA_FONNTE_TOKEN ?? process.env.WA_GATEWAY_TOKEN);

console.log(`Gateway aktif : ${gateway}`);
console.log(`Token         : ${token?.length ?? 0} karakter`);
if (gateway === "wablas") {
  console.log(`Endpoint      : ${process.env.WA_WABLAS_ENDPOINT ?? "(KOSONG!)"}`);
}
console.log(`Tujuan        : ${TO}\n`);

try {
  await createWAOutboundAdapter().sendText(
    TO,
    '"Tes TukangCatat: kalau pesan ini masuk, gateway outbound sudah jalan ya."'
  );
  console.log("OK — pesan terkirim. Cek HP tujuan, harusnya sudah masuk.");
} catch (err) {
  console.error("GAGAL:", err instanceof Error ? err.message : err);
  process.exit(1);
}