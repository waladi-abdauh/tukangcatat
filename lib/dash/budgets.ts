// Resolusi budget per periode 'YYYY-MM' (SERVER ONLY, service role).
//
// Model: monthly_budgets & category_budgets punya kolom `month`.
// - Baca bulan M: pakai baris bulan M; kalau tidak ada, warisi set/nilai
//   terbaru pada bulan <= M (carryover); kalau tidak ada sama sekali,
//   pakai nilai terbaru manapun (fallback "asumsi nilai sekarang" untuk
//   bulan sebelum fitur ini dipasang).
// - Tulis (Settings): selalu mengisi baris bulan BERJALAN saja, jadi bulan
//   lalu membeku dengan setting zamannya tanpa perlu cron "tutup bulan".
import { serviceRoleClient } from "../supabase/service-role";
import { todayID } from "../utils";
import { DEFAULT_MONTHLY_BUDGET } from "../constants";

// Kunci bulan berjalan zona WIB (Asia/Jakarta), format YYYY-MM.
export function currentMonthKey(): string {
  return todayID().slice(0, 7);
}

// Awal bulan SEJAK `month` (format YYYY-MM -> YYYY-MM-01). Dipakai untuk
// membuat rentang tanggal setengah terbuka [start, end) saat memfilter
// transaksi per bulan. Zone-independent: transaksi disimpan sebagai string
// YYYY-MM-DD tanpa timezone, jadi cukup dihitung dari string.
export function nextMonthKey(month: string): string {
  const [year, mon] = month.split("-").map((n) => Number.parseInt(n, 10));
  return mon === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
}

export interface ResolvedMonthlyBudget {
  amount: number;
  // true bila ada baris khusus untuk bulan yang diminta (bukan warisan).
  explicit: boolean;
}

// Carryover murni dari kumpulan baris (tanpa query, urutan bebas): baris
// bulan itu ?? warisan terbaru pada bulan <= itu ?? baris terbaru manapun ??
// default. Dipakai resolver satu-bulan & tren 12 bulan sekali-fetch.
export function resolveMonthlyBudgetFromRows(
  rows: Array<{ month: string; amount: number }>,
  month: string
): ResolvedMonthlyBudget {
  if (rows.length === 0) {
    return { amount: DEFAULT_MONTHLY_BUDGET, explicit: false };
  }
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month)); // terbaru dulu
  const exact = sorted.find((r) => r.month === month);
  if (exact) return { amount: Number(exact.amount), explicit: true };
  const inherited = sorted.find((r) => r.month < month) ?? sorted[0];
  return { amount: Number(inherited.amount), explicit: false };
}

interface MonthlyBudgetRow {
  month: string;
  amount: number;
}

// Budget total bulan tertentu (satu fetch, resolusi via helper murni).
export async function resolveMonthlyBudget(
  userId: string,
  month: string
): Promise<ResolvedMonthlyBudget> {
  const { data } = await serviceRoleClient
    .from("monthly_budgets")
    .select("month, amount")
    .eq("user_id", userId);
  const rows = ((data ?? []) as unknown as MonthlyBudgetRow[])
    .map((r) => ({ month: r.month, amount: Number(r.amount) }))
    .sort((a, b) => b.month.localeCompare(a.month)); // terbaru dulu
  return resolveMonthlyBudgetFromRows(rows, month);
}

export interface ResolvedCategoryBudget {
  category_name: string;
  limit_amount: number;
}

// Set limit kategori bulan tertentu (set utuh per bulan, bukan per kategori
// terpisah, supaya daftar kategori zaman itu ikut membeku).
export async function resolveCategoryBudgets(
  userId: string,
  month: string
): Promise<ResolvedCategoryBudget[]> {
  const { data } = await serviceRoleClient
    .from("category_budgets")
    .select("category_name, limit_amount, month")
    .eq("user_id", userId);
  const rows = ((data ?? []) as unknown as Array<
    ResolvedCategoryBudget & { month: string }
  >).map((r) => ({
    category_name: r.category_name,
    limit_amount: Number(r.limit_amount),
    month: r.month,
  }));
  if (rows.length === 0) return [];
  const months = [...new Set(rows.map((r) => r.month))].sort((a, b) =>
    b.localeCompare(a)
  ); // terbaru dulu
  const target = months.includes(month)
    ? month
    : (months.find((m) => m < month) ?? months[0]);
  return rows
    .filter((r) => r.month === target)
    .map(({ category_name, limit_amount }) => ({ category_name, limit_amount }));
}

// Ringkasan harian + bulanan user (dipakai balasan WA & cron pengingat):
// total hari ini, total bulan-berjalan, dan sisa budget bulan itu.
export async function computeDailySummary(
  userId: string,
  today: string
): Promise<{
  dailyTotal: number;
  monthlySpent: number;
  monthlyRemaining: number;
}> {
  const monthStart = `${today.slice(0, 7)}-01`;
  const [dailyRes, monthlyRes, budgetRes] = await Promise.all([
    serviceRoleClient
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("transaction_date", today),
    serviceRoleClient
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .gte("transaction_date", monthStart)
      .lte("transaction_date", today),
    resolveMonthlyBudget(userId, today.slice(0, 7)),
  ]);

  const sum = (rows: Array<{ amount: number }> | null) =>
    (rows ?? []).reduce((acc: number, r) => acc + Number(r.amount), 0);

  const dailyTotal = sum(dailyRes.data);
  const monthlySpent = sum(monthlyRes.data);
  return {
    dailyTotal,
    monthlySpent,
    monthlyRemaining: Math.max(budgetRes.amount - monthlySpent, 0),
  };
}