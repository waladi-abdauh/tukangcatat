"use server";

// Server Actions dashboard: mutasi budget bulanan & limit kategori.
// Setiap action DULUAN memverifikasi sesi, lalu membatasi pengaruh ke akun
// milik nomor yang terautentikasi (tidak menerima userId dari client).
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { serviceRoleClient } from "../../lib/supabase/service-role";
import { getSessionPhone } from "../../lib/auth";
import { SESSION_COOKIE } from "../../lib/security/jwt-token";
import { DEFAULT_CATEGORY_LIMIT } from "../../lib/constants";
import { currentMonthKey, nextMonthKey, resolveCategoryBudgets, resolveMonthlyBudget } from "../../lib/dash/budgets";
import { recentMonthKeys, todayID } from "../../lib/utils";

const budgetSchema = z.number().int("Budget harus bilangan bulat").min(10_000).max(1_000_000_000);
const categoryLimitSchema = z
  .number()
  .int("Limit harus bilangan bulat")
  .min(0)
  .max(1_000_000_000);
const categoryNameSchema = z.string().trim().min(1).max(40);
const transactionIdSchema = z.string().uuid("ID transaksi tidak valid");
const itemNameSchema = z
  .string()
  .trim()
  .min(1, "Nama item kosong")
  .max(120, "Nama item kepanjangan");
const amountSchema = z
  .number()
  .int("Nominal harus bilangan bulat")
  .positive("Nominal harus lebih dari 0")
  .max(1_000_000_000, "Nominal terlalu besar");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD");
const fullNameSchema = z
  .string()
  .trim()
  .min(4, "Nama minimal 4 huruf, Kak.")
  .max(10, "Nama maksimal 10 huruf, Kak.");
const reminderTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam pengingat harus HH:MM (mis. 20:00).");
const pushEndpointSchema = z
  .string()
  .url()
  .max(600)
  .refine((v) => v.startsWith("https://"), "Endpoint push wajib https.");
const pushKeySchema = z.string().min(1).max(300);

export interface ActionResult {
  ok: boolean;
  error?: string;
  limit?: number;
}

// Id profil dari cookie sesi saat ini; null bila tidak login.
async function currentProfileId(): Promise<string | null> {
  const phone = await getSessionPhone();
  if (!phone) return null;
  const { data } = await serviceRoleClient
    .from("profiles")
    .select("id")
    .eq("phone_number", phone)
    .maybeSingle();
  return data?.id ?? null;
}

// Format angka ribuan (mis. 3500000 -> "3.500.000") tanpa prefiks "Rp".
const formatted = (n: number) => n.toLocaleString("id-ID");

// Budget bulanan periode berjalan (fallback default bila belum pernah diset).
async function getMonthlyBudget(userId: string): Promise<number> {
  const { amount } = await resolveMonthlyBudget(userId, currentMonthKey());
  return amount;
}

// Jumlah semua limit kategori periode berjalan (opsional mengecualikan satu
// kategori saat menghitung sisa kemampuan kategori itu).
async function sumCategoryLimits(
  userId: string,
  excludeName?: string
): Promise<number> {
  const rows = await resolveCategoryBudgets(userId, currentMonthKey());
  let total = 0;
  for (const row of rows) {
    if (excludeName && row.category_name === excludeName) continue;
    total += row.limit_amount;
  }
  return total;
}

// Simpan nama panggilan user (kartu "Nama kamu" di Settings).
export async function updateFullName(name: unknown): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const parsed = fullNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const { error } = await serviceRoleClient
    .from("profiles")
    .update({ full_name: parsed.data })
    .eq("id", userId);
  if (error) {
    console.error("[dash] update name:", error.message);
    return { ok: false, error: "Gagal nyimpen nama, coba lagi ya." };
  }

  revalidatePath("/dash");
  revalidatePath("/dash/settings");
  return { ok: true };
}

// Simpan budget bulanan (slider di Settings) — mengisi baris bulan BERJALAN
// saja; bulan berikutnya otomatis mewarisi, bulan lalu tetap membeku.
export async function updateMonthlyBudget(amount: unknown): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const parsed = budgetSchema.safeParse(amount);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  // Jumlah limit kategori tidak boleh melebihi budget (sinkronisasi).
  const totalLimits = await sumCategoryLimits(userId);
  if (parsed.data < totalLimits) {
    return {
      ok: false,
      error: `Budget Rp${formatted(parsed.data)} lebih kecil dari total plafon kategori Rp${formatted(
        totalLimits
      )}. Kecilin dulu limit kategorinya, ya.`,
    };
  }

  const { error } = await serviceRoleClient
    .from("monthly_budgets")
    .upsert(
      { user_id: userId, month: currentMonthKey(), amount: parsed.data },
      { onConflict: "user_id,month" }
    );
  if (error) {
    console.error("[dash] update budget:", error.message);
    return { ok: false, error: "Nggak kebagian nyimpen budget, coba lagi ya." };
  }

  revalidatePath("/dash");
  revalidatePath("/dash/settings");
  return { ok: true };
}

// Simpan limit satu kategori (baris editor di Settings).
export async function updateCategoryBudget(
  categoryName: unknown,
  limitAmount: unknown
): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const name = categoryNameSchema.safeParse(categoryName);
  const limit = categoryLimitSchema.safeParse(limitAmount);
  if (!name.success || !limit.success) {
    return { ok: false, error: "Nilai kategori/limit tidak valid." };
  }

  // Limit 0 = hapus pembatas kategori ini (tidak bocor); mengurangi total,
  // jadi selalu diizinkan. Hanya baris bulan berjalan (bulan lalu membeku).
  if (limit.data === 0) {
    const { error } = await serviceRoleClient
      .from("category_budgets")
      .delete()
      .eq("user_id", userId)
      .eq("category_name", name.data)
      .eq("month", currentMonthKey());
    if (error) {
      console.error("[dash] delete budget:", error.message);
      return { ok: false, error: "Gagal hapus plafon kategori, coba lagi ya." };
    }
  } else {
    // Sinkronisasi: total limit tidak boleh melebihi budget bulanan.
    // Sisa budget (di luar kategori lain) adalah batas maksimal kategori ini.
    const budget = await getMonthlyBudget(userId);
    const totalOthers = await sumCategoryLimits(userId, name.data);
    const remaining = budget - totalOthers;
    if (limit.data > remaining) {
      return {
        ok: false,
        error: `Plafon Rp${formatted(limit.data)} lebih besar dari sisa budget Rp${formatted(
          Math.max(remaining, 0)
        )}. Kecilin limit kategori lain atau naikkan budget, Kak.`,
      };
    }

    const { error } = await serviceRoleClient
      .from("category_budgets")
      .upsert(
        {
          user_id: userId,
          category_name: name.data,
          limit_amount: limit.data,
          month: currentMonthKey(),
        },
        { onConflict: "user_id,category_name,month" }
      );
    if (error) {
      console.error("[dash] upsert budget:", error.message);
      return { ok: false, error: "Gagal simpan plafon kategori, coba lagi ya." };
    }
  }

  revalidatePath("/dash");
  revalidatePath("/dash/analytics");
  revalidatePath("/dash/settings");
  return { ok: true };
}

// Tambah kategori baru dari Settings. Limit awal mengikuti sisa budget
// (tidak pernah melebihi cadangan) supaya sinkron dengan budget bulanan.
export async function addCategory(categoryName: unknown): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const name = categoryNameSchema.safeParse(categoryName);
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message };

  // Kategori dengan nama yang sama tidak boleh dibuat dua kali (bulan berjalan).
  const { data: existing } = await serviceRoleClient
    .from("category_budgets")
    .select("id")
    .eq("user_id", userId)
    .eq("category_name", name.data)
    .eq("month", currentMonthKey())
    .maybeSingle();
  if (existing) {
    return { ok: false, error: "Kategori ini udah ada, Kak." };
  }

  const budget = await getMonthlyBudget(userId);
  const totalLimits = await sumCategoryLimits(userId);
  const remaining = budget - totalLimits;
  if (remaining <= 0) {
    return {
      ok: false,
      error:
        "Nggak ada sisa budget buat kategori baru. Kecilin limit kategori lain atau naikkan budget, ya.",
    };
  }
  const initialLimit = Math.min(DEFAULT_CATEGORY_LIMIT, remaining);

  const { error } = await serviceRoleClient
    .from("category_budgets")
    .insert({
      user_id: userId,
      category_name: name.data,
      limit_amount: initialLimit,
      month: currentMonthKey(),
    });
  if (error) {
    console.error("[dash] add category:", error.message);
    return { ok: false, error: "Gagal nambah kategori, coba lagi ya." };
  }

  revalidatePath("/dash");
  revalidatePath("/dash/analytics");
  revalidatePath("/dash/settings");
  return { ok: true };
}

// Mundur sebagian kalau rename gagal di tengah jalan: hapus baris limit nama
// baru yang sudah terlanjur di-insert, DAN kembalikan label transaksi ke nama
// lama. Tanpa langkah kedua, kondisi setengah jadi: transaksi sudah berlabel
// nama baru tapi tidak ada budget untuk nama itu — limit bulan ini terlihat
// hilang padahal uangnya sudah tercatat.
async function rollbackRename(
  userId: string,
  fromName: string,
  toName: string,
  month: string,
  monthStart: string,
  nextMonthStart: string
): Promise<void> {
  await serviceRoleClient
    .from("category_budgets")
    .delete()
    .eq("user_id", userId)
    .eq("category_name", toName)
    .eq("month", month);
  const { error } = await serviceRoleClient
    .from("transactions")
    .update({ category: fromName })
    .eq("user_id", userId)
    .eq("category", toName)
    .gte("transaction_date", monthStart)
    .lt("transaction_date", nextMonthStart);
  if (error) {
    // Tidak ada yang bisa dilakukan di sini selain	logger supaya tidak
    // hilang diam-diam; sisa perubahan tetap konsisten karena label lama
    // hanya mungkin sudah dipakai kategori lain di bulan berjalan.
    console.error(
      "[dash] rollback rename transaksi (periksa manual):",
      error.message
    );
  }
}

// Ganti nama kategori (rename) tanpa merusak laporan bulan-bulan sebelumnya.
//
// Sifat penting: ini PURE RENAME, bukan merge. Kategori lama dan baru
// dianggap hal yang sama, jadi:
//
// - LIMIT: baris bulan berjalan ikut ganti nama (limit & nilainya utuh).
//   Baris bulan lalu TIDAK disentuh sama sekali.
// - TRANSAKSI: HANYA yang bertanggal di bulan berjalan yang labelnya
//   diganti. Bulan lalu dibiarkan persis apa adanya, jadi angka, komposisi
//   per kategori, dan ringkasan piagamnya tetap sama. Ini beda dengan
//   deleteCategory yang memindahkan transaksi ke kategori tanpa filter bulan.
//
// Verifikasi: `verify/category-rename.mts`.
// Konsekuensi yang perlu disadari user: kalau nama lama dipakai lagi di
// bulan LAMPAU, laporan lama tetap memakai nama lama — itu memang tujuan
// fitur ini (history beku). Kalau butuh satu label berlaku retroaktif,
// itu fitur "gabung" yang terpisah, bukan rename.
export async function renameCategory(
  fromName: unknown,
  toName: unknown
): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const from = categoryNameSchema.safeParse(fromName);
  const to = categoryNameSchema.safeParse(toName);
  if (!from.success) return { ok: false, error: from.error.issues[0]?.message };
  if (!to.success) return { ok: false, error: to.error.issues[0]?.message };

  if (from.data === to.data) {
    return { ok: false, error: "Nama baru sama dengan yang lama." };
  }
  // Beda hanya huruf besar-kecil tetap ditolak: duplikat pada periode berjalan
  // akan menggandakan limit (dua baris dengan nama yang "hampir sama" bagi user).
  if (from.data.toLowerCase() === to.data.toLowerCase()) {
    return { ok: false, error: "Nama baru cuma beda huruf besar-kecil." };
  }

  const month = currentMonthKey();

  // Nama baru harus unik di bulan berjalan; kalau sudah ada, rename akan
  // menggabung dua baris limit dan membuat total budget tidak sengaja naik.
  const { data: clash } = await serviceRoleClient
    .from("category_budgets")
    .select("id")
    .eq("user_id", userId)
    .eq("category_name", to.data)
    .eq("month", month)
    .maybeSingle();
  if (clash) {
    return {
      ok: false,
      error: `Kategori "${to.data}" sudah ada. Gabung manual: set limit yang satu ke 0, lalu hapus.`,
    };
  }

  // 1) Salin limit bulan berjalan ke nama baru (nilai utuh).
  const { data: source } = await serviceRoleClient
    .from("category_budgets")
    .select("limit_amount")
    .eq("user_id", userId)
    .eq("category_name", from.data)
    .eq("month", month)
    .maybeSingle();

  const { error: insErr } = await serviceRoleClient
    .from("category_budgets")
    .insert({
      user_id: userId,
      category_name: to.data,
      // Kalau kategori lama tidak punya baris limit di bulan ini, JANGAN
      // fallback ke DEFAULT_CATEGORY_LIMIT (Rp500.000): itu berarti app
      // mengunci 500 ribu budget yang tidak pernah dipilih user, dan
      // sumCategoryLimits bisa membuat sisa bulanan negatif. 0 = "belum
      // ditentuin", dan user tinggal mengisinya di Settings.
      limit_amount: Number(source?.limit_amount ?? 0),
      month,
    });
  if (insErr) {
    console.error("[dash] rename insert:", insErr.message);
    return { ok: false, error: "Gagal ganti nama kategori, coba lagi ya." };
  }

  // 2) Transaksi bulan BERJALAN ikut ganti nama. Ini yang bikin bulan ini
  //    tetap koheren: satu kategori = satu label, jadi pie chart & limit
  //    tidak(split) jadi dua.
  //
  //    Batas bawah DAN atas wajib. `>= awal bulan` saja ikut menimpa
  //    transaksi yang tanggalnya di bulan depan — user bisa saja nyatet
  //    "gajian 5 November" hari ini, dan labelnya harus tetap konsisten
  //    dengan apa yang mereka tulis, bukan ikut berubah diam-diam.
  const monthStart = `${month}-01`;
  const nextMonthStart = nextMonthKey(month);
  const { error: txErr } = await serviceRoleClient
    .from("transactions")
    .update({ category: to.data })
    .eq("user_id", userId)
    .eq("category", from.data)
    .gte("transaction_date", monthStart)
    .lt("transaction_date", nextMonthStart);
  if (txErr) {
    await rollbackRename(userId, from.data, to.data, month, monthStart, nextMonthStart);
    console.error("[dash] rename transactions:", txErr.message);
    return { ok: false, error: "Gagal ganti nama kategori, coba lagi ya." };
  }

  // 3) Buang baris limit nama lama dari bulan berjalan. Baris bulan lalu
  //    dibiarkan (identik dengan deleteCategory). App hanya pernah menulis
  //    `month` = bulan berjalan, jadi ini setara dengan .eq("month", month).
  const { error: delErr } = await serviceRoleClient
    .from("category_budgets")
    .delete()
    .eq("user_id", userId)
    .eq("category_name", from.data)
    .eq("month", month);
  if (delErr) {
    await rollbackRename(userId, from.data, to.data, month, monthStart, nextMonthStart);
    console.error("[dash] rename delete:", delErr.message);
    return { ok: false, error: "Gagal ganti nama kategori, coba lagi ya." };
  }

  revalidatePath("/dash");
  revalidatePath("/dash/analytics");
  revalidatePath("/dash/settings");
  return { ok: true };
}

// Hapus kategori dari daftar pengelolaan.
// Bila kategori masih punya transaksi, wajib pilih `destinationCategory`
// untuk memindahkan datanya; baris limit kategori ikut dihapus.
export async function deleteCategory(
  categoryName: unknown,
  destinationCategory: unknown | null
): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const name = categoryNameSchema.safeParse(categoryName);
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message };

  let dest: string | null = null;
  if (destinationCategory != null && String(destinationCategory).trim() !== "") {
    const parsedDest = categoryNameSchema.safeParse(destinationCategory);
    if (!parsedDest.success) {
      return { ok: false, error: "Kategori tujuan tidak valid." };
    }
    dest = parsedDest.data;
  }
  if (dest && dest.toLowerCase() === name.data.toLowerCase()) {
    return { ok: false, error: "Data tidak bisa dipindah ke kategori yang sama." };
  }

  // Cek dulu apakah kategori punya transaksi (semua bulan, bukan cuma ini).
  const { count } = await serviceRoleClient
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("category", name.data);
  const hasData = (count ?? 0) > 0;
  if (hasData && !dest) {
    return {
      ok: false,
      error: `Kategori ini masih punya ${count} catatan. Pilih dulu kategori tujuannya, ya.`,
    };
  }

  // Pindahkan transaksi lama ke kategori tujuan (bila ada).
  if (dest) {
    const { error } = await serviceRoleClient
      .from("transactions")
      .update({ category: dest })
      .eq("user_id", userId)
      .eq("category", name.data);
    if (error) {
      console.error("[dash] reassign category:", error.message);
      return { ok: false, error: "Gagal memindahkan transaksi." };
    }
  }

  // Hapus limit kategori dari bulan BERJALAN ke depan — baris bulan-bulan
  // lalu dibiarkan membeku (sejarah periode itu tetap utuh).
  const { error: budgetErr } = await serviceRoleClient
    .from("category_budgets")
    .delete()
    .eq("user_id", userId)
    .eq("category_name", name.data)
    .gte("month", currentMonthKey());
  if (budgetErr) {
    console.error("[dash] delete category budget:", budgetErr.message);
    return { ok: false, error: "Gagal menghapus kategori." };
  }

  revalidatePath("/dash");
  revalidatePath("/dash/analytics");
  revalidatePath("/dash/settings");
  return { ok: true };
}

// Tambah catatan manual dari dashboard (tombol "Catat manual" di Ringkasan).
// Tanpa limit harian & tanpa kuota AI: keduanya menjaga kuota Fonnte/Gemini,
// sedangkan catatan manual tidak mengirim pesan & tidak memanggil AI.
export async function addTransaction(
  itemName: unknown,
  amount: unknown,
  category: unknown,
  transactionDate: unknown
): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const name = itemNameSchema.safeParse(itemName);
  const amt = amountSchema.safeParse(amount);
  const cat = categoryNameSchema.safeParse(category);
  const date = dateSchema.safeParse(transactionDate);
  if (!name.success || !amt.success || !cat.success || !date.success) {
    return {
      ok: false,
      error:
        name.error?.issues[0]?.message ??
        amt.error?.issues[0]?.message ??
        cat.error?.issues[0]?.message ??
        date.error?.issues[0]?.message ??
        "Nilai catatan tidak valid.",
    };
  }

  // Batas tanggal: dalam jendela 12 bulan terakhir & tidak melewati hari ini
  // (catatan bertanggal 1999/2100 tidak ada gunanya & bikin data kotor).
  const today = todayID();
  const minDate = `${recentMonthKeys(12)[0]}-01`;
  if (date.data > today || date.data < minDate) {
    return {
      ok: false,
      error: "Tanggal harus dalam 12 bulan terakhir dan tidak melewati hari ini.",
    };
  }

  const { error } = await serviceRoleClient.from("transactions").insert({
    user_id: userId,
    item_name: name.data,
    amount: amt.data,
    category: cat.data,
    input_type: "manual",
    transaction_date: date.data,
  });
  if (error) {
    console.error("[dash] add transaction:", error.message);
    return { ok: false, error: "Gagal nyimpen catatan, coba lagi ya." };
  }

  revalidatePath("/dash");
  revalidatePath("/dash/analytics");
  return { ok: true };
}

// Hapus satu transaksi milik user yang sedang login.
export async function deleteTransaction(id: unknown): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const parsed = transactionIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  // Ownership check: transaksi harus milik user ini (jangan percaya id dari client).
  const { data: existing } = await serviceRoleClient
    .from("transactions")
    .select("id")
    .eq("id", parsed.data)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "Catatan nggak ketemu, mungkin udah kehapus." };
  }

  const { error } = await serviceRoleClient
    .from("transactions")
    .delete()
    .eq("id", parsed.data)
    .eq("user_id", userId);
  if (error) {
    console.error("[dash] delete transaction:", error.message);
    return { ok: false, error: "Gagal hapus catatan, coba lagi ya." };
  }

  revalidatePath("/dash");
  revalidatePath("/dash/analytics");
  return { ok: true };
}

// Edit satu transaksi milik user yang sedang login.
export async function updateTransaction(
  id: unknown,
  itemName: unknown,
  amount: unknown,
  category: unknown,
  transactionDate: unknown
): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const idParsed = transactionIdSchema.safeParse(id);
  const name = itemNameSchema.safeParse(itemName);
  const amt = amountSchema.safeParse(amount);
  const cat = categoryNameSchema.safeParse(category);
  const date = dateSchema.safeParse(transactionDate);
  if (!idParsed.success || !name.success || !amt.success || !cat.success || !date.success) {
    return {
      ok: false,
      error:
        idParsed.error?.issues[0]?.message ??
        name.error?.issues[0]?.message ??
        amt.error?.issues[0]?.message ??
        cat.error?.issues[0]?.message ??
        date.error?.issues[0]?.message ??
        "Nilai transaksi tidak valid.",
    };
  }

  // Ownership check sebelum mutasi.
  const { data: existing } = await serviceRoleClient
    .from("transactions")
    .select("id")
    .eq("id", idParsed.data)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "Catatan nggak ketemu, mungkin udah kehapus." };
  }

  const { error } = await serviceRoleClient
    .from("transactions")
    .update({
      item_name: name.data,
      amount: amt.data,
      category: cat.data,
      transaction_date: date.data,
    })
    .eq("id", idParsed.data)
    .eq("user_id", userId);
  if (error) {
    console.error("[dash] update transaction:", error.message);
    return { ok: false, error: "Gagal menyimpan perubahan." };
  }

  revalidatePath("/dash");
  revalidatePath("/dash/analytics");
  return { ok: true };
}

// Simpan jam pengingat nyatet (null = nonaktif). Notifikasi dikirim via web
// push oleh cron pada jam WIB pilihan user (maksimal 1x per hari per user).
export async function updateReminderSetting(time: unknown): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  let reminderTime: string | null = null;
  if (time != null && String(time).trim() !== "") {
    const parsed = reminderTimeSchema.safeParse(String(time).trim());
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
    reminderTime = parsed.data;
  }

  const { error } = await serviceRoleClient
    .from("profiles")
    .update({ reminder_time: reminderTime })
    .eq("id", userId);
  if (error) {
    console.error("[dash] update reminder:", error.message);
    return { ok: false, error: "Gagal nyimpen pengingat, coba lagi ya." };
  }

  revalidatePath("/dash/settings");
  return { ok: true };
}

// Simpan langganan push notification browser (dipanggil kartu Pengingat saat
// diaktifkan). Upsert by endpoint: browser/device sama = baris yang sama.
export async function savePushSubscription(
  endpoint: unknown,
  p256dh: unknown,
  auth: unknown
): Promise<ActionResult> {
  const userId = await currentProfileId();
  if (!userId) return { ok: false, error: "Sesi selesai, Kak. Buka lagi lewat link WhatsApp ya." };

  const ep = pushEndpointSchema.safeParse(endpoint);
  const dh = pushKeySchema.safeParse(p256dh);
  const au = pushKeySchema.safeParse(auth);
  if (!ep.success || !dh.success || !au.success) {
    return { ok: false, error: "Data langganan notifikasi tidak valid." };
  }

  const { error } = await serviceRoleClient
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, endpoint: ep.data, p256dh: dh.data, auth: au.data },
      { onConflict: "endpoint" }
    );
  if (error) {
    console.error("[dash] save push subscription:", error.message);
    return { ok: false, error: "Gagal nyimpen langganan notifikasi." };
  }
  return { ok: true };
}

// Logout: hapus cookie sesi lalu ke landing + banner cara balik.
export async function logout(): Promise<never> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/?login=perlu");
}