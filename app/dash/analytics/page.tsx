// Analisis: komposisi kategori (pie), top kategori (bar), dan Leak Detector.
import { redirect } from "next/navigation";
import { Card, CardContent } from "../../../components/ui/card";
import CategoryPieChart from "../../../components/dash/category-pie-chart";
import LeakDetectorCard from "../../../components/dash/leak-detector-card";
import { getDashboardData, normalizeMonthKey, requireProfile } from "../../../lib/dash/data";
import { formatIDR, recentMonthKeys } from "../../../lib/utils";
import MonthSelector from "../../../components/dash/month-selector";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await requireProfile();
  if (!profile) redirect("/");

  const sp = await searchParams;
  const data = await getDashboardData(profile, normalizeMonthKey(sp?.month));
  const maxAmount = data.categories[0]?.amount ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading font-script text-xl font-semibold">Analisis</h1>
          <p className="text-sm text-muted-foreground">
            Komposisi pengeluaran {data.monthLabel}.
          </p>
        </div>
          <MonthSelector selected={data.month} basePath="/dash/analytics" options={recentMonthKeys(12)} />
      </div>

      <Card>
        <CardContent className="space-y-2">
          <h2 className="font-heading font-script text-base font-medium">Per kategori</h2>
          <CategoryPieChart data={data.categories} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-heading font-script text-base font-medium">
            Kategori paling boros bulan ini
          </h2>
          {data.categories.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Belum ada catatan. Yuk mulai chat ke WhatsApp-ku.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.categories.map((c, index) => {
                const pct = maxAmount > 0 ? c.amount / maxAmount : 0;
                return (
                  <li key={c.category}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-medium">
                        {index + 1}. {c.category}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatIDR(c.amount)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(pct * 100, 3)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <LeakDetectorCard budgets={data.budgets} />
    </div>
  );
}