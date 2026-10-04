// Layout area Dashboard: verifikasi sesi ccat_session lalu render shell navigasi.
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getProfileByPhone } from "../../lib/dash/data";
import { getSessionPhone } from "../../lib/auth";
import DashShell from "../../components/dash/dash-shell";

export default async function DashLayout({ children }: { children: ReactNode }) {
  const phone = await getSessionPhone();
  if (!phone) redirect("/?login=perlu");

  // Ambil profil dari nomor yang terverifikasi (bukan dari input client).
  const profile = await getProfileByPhone(phone);
  if (!profile) redirect("/?login=perlu");

  return (
    <DashShell
      fullName={profile.full_name || "Kak"}
      isPro={profile.is_pro}
      phoneNumber={profile.phone_number}
    >
      {children}
    </DashShell>
  );
}