// Settings: edit budget bulanan & kelola kategori (dikirim sebagai props klien).
import { redirect } from "next/navigation";
import SettingsClient from "../../../components/dash/settings-client";
import {
  getAllUserCategoryNames,
  getDashboardData,
  requireProfile,
} from "../../../lib/dash/data";

export default async function SettingsPage() {
  const profile = await requireProfile();
  if (!profile) redirect("/");

  const data = await getDashboardData(profile);
  const usedCategories = await getAllUserCategoryNames(profile.id);

  return (
    <SettingsClient
      fullName={profile.full_name}
      reminderTime={profile.reminder_time}
      monthlyBudget={data.budget}
      budgetSet={data.budgetExplicit}
      usedCategories={usedCategories}
      existingLimits={data.budgets.map((b) => ({
        category_name: b.category_name,
        limit_amount: b.limit_amount,
      }))}
      isPro={profile.is_pro}
      creditBalance={profile.credit_balance ?? 0}
      referralCode={profile.referral_code ?? ""}
    />
  );
}