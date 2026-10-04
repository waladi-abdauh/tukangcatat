// Prime chat: kirim pesan dari bot ke tester agar chat jadi mutual
// (chat 1:1 baru kadang tak tersinkron penuh sampai bot pernah membalas).
// Jalankan: npx tsx --env-file=.env.local scripts/verify/prime-bot.mts
//
// Nomor tujuan dibaca dari DEV_TEST_PHONE — tidak ada nomor pribadi yang
// disimpan di repo ini.
import { createWAOutboundAdapter } from "../../lib/wa/client";

const TO = process.env.DEV_TEST_PHONE;
if (!TO) {
  console.error("DEV_TEST_PHONE belum diisi di .env.local");
  process.exit(1);
}
const MSG =
  '"Halo! Ini CepatCatat. Kami sedang tes fungsi bot; mohon balas "halo" di chat ini ya."';

const adapter = createWAOutboundAdapter();
await adapter.sendText(TO, MSG);
console.log(`Terkirim ke ${TO}`);