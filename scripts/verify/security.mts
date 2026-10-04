// Verifikasi Step 3: JWT (magic/session/tamper/secret-salah/expired) + zod sanitization.
// Jalankan: node --env-file=.env.local scripts/verify/security.mts
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  createMagicToken,
  createSessionToken,
  verifyToken,
} from "../../lib/security/jwt-token.ts";
import {
  phoneNumberSchema,
  referralCodeSchema,
  positiveAmountSchema,
  waInboundSchema,
  parsedTransactionsSchema,
  midtransWebhookSchema,
} from "../../lib/security/sanitization.ts";

const getSecret = () => new TextEncoder().encode(process.env.JWT_SECRET_KEY!);
const PHONE = "6281234567890";

async function main() {
  // ---------- JWT ----------
  const magic = await createMagicToken(PHONE);
  assert.equal(await verifyToken(magic), PHONE);
  console.log("PASS JWT magic token -> verify menghasilkan nomor sama");

  const session = await createSessionToken(PHONE);
  assert.equal(await verifyToken(session), PHONE);
  console.log("PASS JWT session token -> verify menghasilkan nomor sama");

  const tampered = magic.slice(0, -4) + (magic.endsWith("aaaa") ? "bbbb" : "aaaa");
  assert.equal(await verifyToken(tampered), null);
  console.log("PASS JWT token di-tamper -> null (ditolak)");

  const wrongSecret = await new SignJWT({ type: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(PHONE)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode("secret-salah-untuk-tes-000000000000"));
  assert.equal(await verifyToken(wrongSecret), null);
  console.log("PASS JWT secret salah -> null (ditolak)");

  const expired = await new SignJWT({ type: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(PHONE)
    .setIssuedAt()
    .setExpirationTime("1s")
    .sign(getSecret());
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await verifyToken(expired), null);
  console.log("PASS JWT expired -> null (ditolak)");

  // ---------- Sanitization ----------
  assert.equal(phoneNumberSchema.safeParse("6281234567890").success, true);
  assert.equal(phoneNumberSchema.safeParse("0812456").success, false);
  assert.equal(phoneNumberSchema.safeParse("08124567890123456").success, false);
  assert.equal(phoneNumberSchema.safeParse("abc123").success, false);
  console.log("PASS sanitization phoneNumber");

  assert.equal(referralCodeSchema.safeParse("CCAT-5FC860").success, true);
  assert.equal(referralCodeSchema.safeParse("CCAT-12345").success, false);
  assert.equal(referralCodeSchema.safeParse("ccat-5fc860").success, false);
  console.log("PASS sanitization referralCode");

  assert.equal(positiveAmountSchema.safeParse(35000).success, true);
  assert.equal(positiveAmountSchema.safeParse(0).success, false);
  assert.equal(positiveAmountSchema.safeParse(-2000).success, false);
  assert.equal(positiveAmountSchema.safeParse(1200.5).success, false);
  console.log("PASS sanitization positiveAmount");

  const validTx = { item_name: "Bensin", amount: 35000, category: "Transport" };
  assert.equal(parsedTransactionsSchema.safeParse([validTx]).success, true);
  assert.equal(parsedTransactionsSchema.safeParse([]).success, false);
  assert.equal(
    parsedTransactionsSchema.safeParse(Array.from({ length: 21 }, () => validTx)).success,
    false
  );
  assert.equal(
    parsedTransactionsSchema.safeParse([{ ...validTx, amount: -1 }]).success,
    false
  );
  console.log("PASS sanitization parsedTransactions");

  assert.equal(
    waInboundSchema.safeParse({
      sender: "6281234567890",
      messageType: "text",
      text: "Bensin 35rb",
    }).success,
    true
  );
  assert.equal(
    waInboundSchema.safeParse({
      sender: "6281234567890",
      messageType: "text",
      mediaUrl: "not-a-url",
    }).success,
    false
  );
  assert.equal(
    waInboundSchema.safeParse({ sender: "081234", messageType: "text" }).success,
    false
  );
  console.log("PASS sanitization waInbound");

  const mkMid = (status: string, orderId = "CCAT-123") => ({
    order_id: orderId,
    status_code: "200",
    transaction_status: status,
    gross_amount: "19000.00",
    signature_key: "abc",
    payment_type: "qris",
  });
  assert.equal(midtransWebhookSchema.safeParse(mkMid("settlement")).success, true);
  assert.equal(midtransWebhookSchema.safeParse(mkMid("settlement", "")).success, false);
  assert.equal(midtransWebhookSchema.safeParse(mkMid("bogus")).success, false);
  console.log("PASS sanitization midtransWebhook");

  console.log("\nSECURITY OK: JWT + zod sanitization -- semua pass.");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});