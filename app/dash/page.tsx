// Ringkasan: total pengeluaran + alert bocor (satu kartu), insight kategori
// & tren 12 bulan (satu kartu bertoggle), dan catatan terbaru — tiga seksi
// berjarak lega supaya mobile-first tetap lega, tidak seperti tumpukan box.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent } from "../../components/ui/card";
import BudgetProgress from "../../components/dash/budget-progress";
import InsightsCard from "../../components/dash/insights-card";
import ExpenseList from "../../components/dash/expense-list";
import LeakDetectorCard from "../../components/dash/leak-detector-card";
import TransactionAdd from "../../components/dash/transaction-add";
import PwaInstallerBanner from "../../components/pwa-installer-banner";
import {
  getAllUserCategoryNames,
  getDashboardData,
  getMonthlyTrend,
  normalizeMonthKey,
  requireProfile,
} from "../../lib/dash/data";
import { defaultDateInMonth, formatIDR, recentMonthKeys } from "../../lib/utils";
import MonthSelector from "../../components/dash/month-selector";
import { Marker } from "../../components/marker";

export default async function DashPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await requireProfile();
  if (!profile) redirect("/");

  const sp = await searchParams;
  const data = await getDashboardData(profile, normalizeMonthKey(sp?.month));
  // Daftar kategori untuk dialog "Catat manual": kategori bulan terpilih
  // (dari budget) + semua kategori yang pernah terpakai di catatan.
  const usedCategories = await getAllUserCategoryNames(profile.id);
  const addCategories = [
    ...new Set([...data.budgets.map((b) => b.category_name), ...usedCategories]),
  ];
  // Tren pengeluaran vs budget 12 bulan terakhir (mode "12 bulan" insight).
  const trend = await getMonthlyTrend(profile.id, 12);

  return (
    <div className="space-y-6">
      {/* Banner install PWA — cukup di Ringkasan (halaman utama) saja. */}
      <PwaInstallerBanner />

      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading font-script text-xl font-semibold">
            Halo, {profile.full_name.split(" ")[0] || "Kak"} 👋
          </h1>
          <p className="text-sm text-muted-foreground">
            Ini ringkasan {data.monthLabel}. Santai, gini aja udah rapi.
          </p>
          {!profile.full_name && (
            <p className="mt-1 text-xs text-muted-foreground">
              Isi namamu di{" "}
              <Link
                href="/dash/settings"
                className="font-medium text-primary underline underline-offset-2"
              >
                Pengaturan
              </Link>{" "}
              biar sapaannya personal ✍️
            </p>
          )}
        </div>
        <MonthSelector selected={data.month} basePath="/dash" options={recentMonthKeys(12)} />
      </div>

      {/* Seksi 1: bulan ini (total + progress + alert bocor, satu kartu) */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-end justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Total pengeluaran {data.monthLabel}
            </span>
            {data.isCurrentMonth && (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                Hari ini: {formatIDR(data.todaySpent)}
              </span>
            )}
          </div>
          <p className="font-heading text-3xl font-semibold tracking-tight">
            <Marker>{formatIDR(data.spent)}</Marker>
          </p>
          <p className="text-sm text-muted-foreground">
            Sisa {formatIDR(data.remaining)} bulan ini.
          </p>
          <BudgetProgress budget={data.budget} spent={data.spent} />
          <LeakDetectorCard budgets={data.budgets} variant="inline" />
        </CardContent>
      </Card>

      {/* Seksi 2: ke mana duitnya (pie bulan ini + tren 12 bulan, toggle) */}
      <Card>
        <CardContent>
          <InsightsCard categories={data.categories} trend={trend} />
        </CardContent>
      </Card>

      {/* Seksi 3: catatan terbaru + catat manual */}
      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-heading font-script text-base font-medium">
              Catatan terbaru
            </h2>
            <TransactionAdd
              categoryOptions={addCategories}
              defaultDate={defaultDateInMonth(data.month)}
            />
          </div>
          <ExpenseList
            key={data.month}
            transactions={data.transactions}
          />
        </CardContent>
      </Card>
    </div>
  );
}