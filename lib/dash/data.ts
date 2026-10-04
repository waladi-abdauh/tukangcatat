// Lapisan data Dashboard PWA (SERVER ONLY - memakai service role + token sesi).
//
// RLS Supabase Auth tidak berlaku di sini: login TukangCatat memakai JWT kustom
// (cookie ccat_session). Karena itu semua query memakai serviceRoleClient dan
// SELALU diverifikasi kepemilikan dari nomor telepon hasil verifikasi token.
import { serviceRoleClient } from "../supabase/service-role";
import { getSessionPhone } from "../auth";
import { monthLabelFromKey, monthShortLabel, recentMonthKeys, todayID } from "../utils";
import { resolveCategoryBudgets, resolveMonthlyBudget, resolveMonthlyBudgetFromRows } from "./budgets";

// Profil kebutuhan dashboard (subset kolom profiles yang dipakai di UI).
export interface DashProfile {
  id: string;
  phone_number: string;
  full_name: string;
  is_pro: boolean;
  pro_until: string | null;
  referral_code: string | null;
  credit_balance: number;
  reminder_time: string | null;
}

// Ambil profil dari token sesi; null bila belum login.
export async function requireProfile(): Promise<DashProfile | null> {
  const phone = await getSessionPhone();
  if (!phone) return null;
  return getProfileByPhone(phone);
}

// Nama default lama dari auto-register (sebelum ada fitur ubah nama).
// Dianggap "belum diisi" supaya sapaan fallback ke "Kak".
const LEGACY_DEFAULT_NAME = "Sobat Cepatcatat";

// Ambil profil berdasarkan nomor telepon (dipakai layout & halaman).
export async function getProfileByPhone(
  phone: string
): Promise<DashProfile | null> {
  const { data } = await serviceRoleClient
    .from("profiles")
    .select(
      "id, phone_number, full_name, is_pro, pro_until, referral_code, credit_balance, reminder_time"
    )
    .eq("phone_number", phone)
    .maybeSingle();
  if (!data) return null;
  const profile = data as unknown as DashProfile;
  if (!profile.full_name || profile.full_name === LEGACY_DEFAULT_NAME) {
    profile.full_name = "";
  }
  return profile;
}

// Ambil semua nama kategori yang pernah dipakai user (untuk daftar
// pengelolaan di Settings, biar kategori lama tanpa limit tetap bisa di-hapus).
export async function getAllUserCategoryNames(
  userId: string
): Promise<string[]> {
  const { data } = await serviceRoleClient
    .from("transactions")
    .select("category")
    .eq("user_id", userId)
    .limit(2000);
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ category: string }>) {
    if (row.category) set.add(row.category);
  }
  return [...set];
}

export interface CategoryBudget {
  category_name: string;
  limit_amount: number;
  used: number;
  pct: number;
  status: "aman" | "mendekati" | "bocor";
}

export interface TransactionRow {
  id: string;
  item_name: string;
  amount: number;
  category: string;
  transaction_date: string;
  created_at: string;
}

export interface DashboardData {
  month: string;
  monthLabel: string;
  isCurrentMonth: boolean;
  budget: number;
  // true bila ada baris budget khusus bulan ini (bukan warisan/default).
  budgetExplicit: boolean;
  spent: number;
  remaining: number;
  todaySpent: number;
  categories: Array<{ category: string; amount: number }>;
  budgets: CategoryBudget[];
  transactions: TransactionRow[];
}

// Kunci bulan "YYYY-MM" yang valid; null bila format salah atau di luar jangkauan.
export function normalizeMonthKey(maybe: string | undefined, count = 12): string {
  const now = new Date();
  const current = `${
    now.getFullYear()
  }-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!maybe || !/^\d{4}-\d{2}$/.test(maybe)) return current;
  const keys = recentMonthKeys(count);
  return keys.includes(maybe) ? maybe : current;
}

// Semua data satu halaman: ringkasan bulanan + kategori + histori terbaru.
// Satu kali query bulan untuk konsistensi angka di tiap kartu.
export async function getDashboardData(
  profile: DashProfile,
  monthKey = normalizeMonthKey(undefined)
): Promise<DashboardData> {
  const now = new Date();
  const current = `${
    now.getFullYear()
  }-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const target = normalizeMonthKey(monthKey);

  const [yearStr, monthStr] = target.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr); // 1..12
  const lastDay = new Date(year, monthIndex, 0).getDate();
  const monthStart = `${target}-01`;
  const monthEnd = `${target}-${String(lastDay).padStart(2, "0")}`;

  const [txRes, budgetsRaw, monthlyBudget] = await Promise.all([
    serviceRoleClient
      .from("transactions")
      .select("id, item_name, amount, category, transaction_date, created_at")
      .eq("user_id", profile.id)
      .gte("transaction_date", monthStart)
      .lte("transaction_date", monthEnd)
      .order("created_at", { ascending: false })
      .limit(500),
    resolveCategoryBudgets(profile.id, target),
    resolveMonthlyBudget(profile.id, target),
  ]);

  const rows = (txRes.data ?? []) as unknown as TransactionRow[];
  const budgets = budgetsRaw;

  const sum = (items: TransactionRow[]) =>
    items.reduce((acc, r) => acc + Number(r.amount), 0);

  const spent = sum(rows);
  const isCurrentMonth = target === current;
  const today = todayID();
  const todaySpent = isCurrentMonth
    ? sum(rows.filter((r) => r.transaction_date === today))
    : 0;
  const budget = monthlyBudget.amount;

  // Total per kategori (untuk pie chart & penggunaan budget).
  const totalByCategory = new Map<string, number>();
  for (const row of rows) {
    totalByCategory.set(
      row.category,
      (totalByCategory.get(row.category) ?? 0) + Number(row.amount)
    );
  }

  const categories = [...totalByCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const budgetData: CategoryBudget[] = budgets.map((b) => {
    const used = totalByCategory.get(b.category_name) ?? 0;
    const limit = Number(b.limit_amount);
    const pct = limit > 0 ? used / limit : 0;
    const status =
      pct >= 1 ? "bocor" : pct >= 0.8 ? "mendekati" : "aman";
    return {
      category_name: b.category_name,
      limit_amount: limit,
      used,
      pct,
      status,
    };
  });

  return {
    month: target,
    monthLabel: monthLabelFromKey(target),
    isCurrentMonth,
    budget,
    budgetExplicit: monthlyBudget.explicit,
    spent,
    remaining: Math.max(budget - spent, 0),
    todaySpent,
    categories,
    budgets: budgetData,
    transactions: rows,
  };
}

// ===== Tren 12 bulan: pengeluaran vs "berhasil dijaga" =====

export interface MonthlyTrendPoint {
  month: string; // YYYY-MM
  label: string; // "Sep 26"
  spent: number;
  budget: number;
  kept: number; // max(budget - spent, 0)
}

// Tren pengeluaran vs budget beberapa bulan terakhir (untuk chart Ringkasan).
// Dua query saja (transaksi jendela + semua baris monthly_budgets), sisanya
// agregasi di JS. Bulan-bulan kosong SEBELUM transaksi pertama dibuang supaya
// chart tidak mengklaim "berhasil dijaga" pada bulan yang belum dipakai.
export async function getMonthlyTrend(
  userId: string,
  count = 12
): Promise<MonthlyTrendPoint[]> {
  const months = recentMonthKeys(count); // naik, berakhir bulan berjalan
  const last = months[months.length - 1];

  const [txRes, budgetRes] = await Promise.all([
    serviceRoleClient
      .from("transactions")
      .select("transaction_date, amount")
      .eq("user_id", userId)
      .gte("transaction_date", `${months[0]}-01`)
      .lte("transaction_date", todayID())
      .limit(5000),
    serviceRoleClient
      .from("monthly_budgets")
      .select("month, amount")
      .eq("user_id", userId),
  ]);

  const spentByMonth = new Map<string, number>();
  for (const row of (txRes.data ?? []) as Array<{
    transaction_date: string;
    amount: number;
  }>) {
    const m = String(row.transaction_date).slice(0, 7);
    spentByMonth.set(m, (spentByMonth.get(m) ?? 0) + Number(row.amount));
  }

  // Mulai dari bulan pertama yang punya transaksi (fallback: bulan berjalan).
  const firstActive =
    months.find((m) => (spentByMonth.get(m) ?? 0) > 0) ?? last;
  const active = months.filter((m) => m >= firstActive);

  const budgetRows = ((budgetRes.data ?? []) as unknown as Array<{
    month: string;
    amount: number;
  }>).map((r) => ({ month: r.month, amount: Number(r.amount) }));

  return active.map((m) => {
    const spent = spentByMonth.get(m) ?? 0;
    const budget = resolveMonthlyBudgetFromRows(budgetRows, m).amount;
    return {
      month: m,
      label: monthShortLabel(m),
      spent,
      budget,
      kept: Math.max(budget - spent, 0),
    };
  });
}