// Handler command & referral untuk alur webhook WA (dipisah agar mudah dites).
import type { WaCommand } from "../security/sanitization";
import { referralCodeSchema } from "../security/sanitization";
import { createMagicToken } from "../security/jwt-token";
import { serviceRoleClient } from "../supabase/service-role";
import {
  onboardingTemplate,
  dashboardLinkTemplate,
  referalInfoTemplate,
  referalClaimedTemplate,
  paymentPlaceholderTemplate,
  errorTemplate,
  pick,
} from "./templates";

type DBC = typeof serviceRoleClient;

// Bentuk profil yang dibutuhkan handler (sesuai kolom profiles).
export interface ProfileRow {
  id: string;
  phone_number: string;
  referral_code: string | null;
  is_pro: boolean;
  referred_by: string | null;
}

// Membuat magic link dashboard: /dash?token=<jwt>.
export async function buildMagicLink(sender: string): Promise<string> {
  const token = await createMagicToken(sender);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/dash?token=${token}`;
}

// Balasan untuk perintah cepat (tidak memakai AI).
export async function handleCommand(
  db: DBC,
  profile: ProfileRow,
  command: WaCommand,
  sender: string
): Promise<string> {
  switch (command) {
    case "!bantuan":
      return onboardingTemplate();
    case "!dashboard":
      return dashboardLinkTemplate(await buildMagicLink(sender));
    case "!referal":
      if (!profile.referral_code) return errorTemplate();
      return referalInfoTemplate(profile.referral_code);
    case "!bayar":
      return paymentPlaceholderTemplate();
    default:
      return onboardingTemplate();
  }
}

// Hint format kode referral (dipakai di klaim & near-miss di route).
// Pool frasa: jalur ini gampang dipicu massal (salah ketik, atau scraper yang
// menginput "REF " terus), dan pesan identik beruntun ke banyak nomor adalah
// sinyal spam bagi device WA.
export function referalFormatHint(): string {
  return pick([
    `Format kode salah. Contoh: *REF CCAT-5FC860*`,
    `Formatnya belum tepat Kak. Contoh: *REF CCAT-5FC860*`,
    `Kodenya belum kebaca. Yang benar kira-kira begini: *REF CCAT-5FC860*`,
  ]);
}

export function referalAlreadyUsedTemplate(): string {
  return pick([
    `Kamu udah pernah pakai kode referal. Kode cuma bisa dipakai sekali. 😉`,
    `Kode referal ini sudah pernah dipakai akun kamu, Kak. Sekali saja ya 😉`,
    `Wah, akun kamu sudah pernah pakai kode referal. Cuma bisa satu kali 😉`,
  ]);
}

export function referalNotFoundTemplate(): string {
  return pick([
    `Kode referal tidak ditemukan. Cek lagi ya.`,
    `Hmm, kode itu nggak ketemu di sini. Coba cek ulang ya.`,
    `Kodenya nggak ada di daftar kami, Kak. Double-check dulu ya.`,
  ]);
}

export function referalClaimFailedTemplate(): string {
  return pick([
    `Kode ini sudah pernah dipakai. 😉`,
    `Kode tersebut sudah pernah dipakai, Kak. 😉`,
    `Wah, kodenya pernah dipakai sebelumnya. 😉`,
  ]);
}

// Klaim kode referral oleh referee (satu kali per akun).
export async function handleReferalClaim(
  db: DBC,
  profile: ProfileRow,
  code: string
): Promise<string> {
  const parsed = referralCodeSchema.safeParse(code.trim().toUpperCase());
  if (!parsed.success) {
    return referalFormatHint();
  }
  if (profile.referred_by) {
    return referalAlreadyUsedTemplate();
  }

  const { data: referrer } = await db
    .from("profiles")
    .select("id, full_name")
    .eq("referral_code", parsed.data)
    .neq("id", profile.id)
    .maybeSingle();
  if (!referrer) {
    return referalNotFoundTemplate();
  }

  // Tandai referred_by + catat di tabel referrals (unique per pasangan).
  const { error: relErr } = await db.from("referrals").insert({
    referrer_id: referrer.id,
    referee_id: profile.id,
    referral_code: parsed.data,
  });
  if (relErr) {
    // Unique violation -> sudah pernah diklaim pasangan ini.
    console.error("[referal] insert referral:", relErr.message);
    return referalClaimFailedTemplate();
  }

  await db
    .from("profiles")
    .update({ referred_by: referrer.id })
    .eq("id", profile.id);

  return referalClaimedTemplate(referrer.full_name ?? referrer.id.slice(0, 8));
}