// Landing page resmi/homepage TukangCatat.
// Satu file (server component, tanpa JS client). Copy & harga mengikuti
// titik-titik bisnis di lib/constants.ts supaya selalu sinkron.
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Camera,
  Check,
  ChevronDown,
  Gift,
  Mail,
  Mic,
  NotebookPen,
  Rocket,
} from "lucide-react";
import Link from "next/link";
import { Marker } from "../components/marker";
import {
  APP_NAME,
  CREDIT_BALANCE_CAP,
  FREE_DAILY_TRANSACTION_LIMIT,
  PRO_DAILY_TRANSACTION_LIMIT,
  PRO_PRICE,
  REFERREE_DISCOUNT_PCT,
  REFERRER_REWARD_AMOUNT,
} from "../lib/constants";
import { getSessionPhone } from "../lib/auth";
import { serviceRoleClient } from "../lib/supabase/service-role";
import { formatIDR } from "../lib/utils";

// Nomor bot (onboarding) & kontak bantuan (dukungan/hapus data).
const BOT_WA = "6285773365200";
const SUPPORT_EMAIL = "catattukang@gmail.com";
const WA_START = `https://wa.me/${BOT_WA}?text=${encodeURIComponent(
  "Halo TukangCatat, mau mulai nyatet?"
)}`;
// Link pulih sesi: buka chat bot dengan pesan !dashboard sudah terisi.
const WA_DASH = `https://wa.me/${BOT_WA}?text=${encodeURIComponent("!dashboard")}`;
// Dukungan lewat email, bukan WhatsApp: nomor pribadi pemilik tidak lagi
// dipublikasikan di landing page.
const MAILTO_SUPPORT = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
  "Bantuan TukangCatat"
)}`;
// Subjek default per konteks (hapus data vs tanya 일반) supaya email masuk
// ke filter yang tepat.
const MAILTO_DELETE = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
  "Hapus data akun TukangCatat"
)}`;

const STEPS = [
  {
    title: "Chat",
    desc: "Tombol WhatsApp di atas — 30 detik, nggak perlu install.",
  },
  {
    title: "Ketik / bicara / foto",
    desc: 'Contoh: “Bensin 35rb sama parkir 2rb”, voice note, atau foto struk Indomaret.',
  },
  {
    title: "Lihat rekap",
    desc: "Kategori otomatis rapi, budget kejaga. Tinggal tambah ke layar utama.",
  },
];

const FEATURES = [
  {
    icon: NotebookPen,
    title: "Catat 2 detik",
    desc: "Teks bebas: “ojol 20rb”, “belanja dapur 150rb”. Langsung tercatat & dikategorikan.",
  },
  {
    icon: Mic,
    title: "Voice Note",
    pro: true,
    desc: "“Hari ini makan siang 25rb” — beres. Kirim voice note, aku yang rapikan.",
  },
  {
    icon: Camera,
    title: "Scan Struk",
    pro: true,
    desc: "Foto struk jadi angka. Kehitung otomatis tanpa ketik manual.",
  },
  {
    icon: BarChart3,
    title: "Rekap di layar",
    desc: "Grafik per kategori & sisa budget — tanpa install aplikasi. Tinggal Tambah ke Home Screen.",
  },
  {
    icon: BellRing,
    title: "Dibilangin sebelum bocor",
    desc: "Pas budget kategori kepakai 80%, kamu dikabari lebih dulu sebelum bengkak.",
  },
  {
    icon: Gift,
    title: "Ajak teman, sama-sama enak",
    desc: `Teman dapat potongan ${Math.round(REFERREE_DISCOUNT_PCT * 100)}%, kamu potongan ${formatIDR(
      REFERRER_REWARD_AMOUNT
    )} buat langganan berikutnya (maks ${Math.round(CREDIT_BALANCE_CAP / PRO_PRICE)} bulan).`,
  },
];

const FAQS: Array<{ q: string; a: string | null }> = [
  {
    q: "Perlu install aplikasi?",
    a: "Nggak. Buka rekap di browser, tinggal “Tambah ke Home Screen” biar kayak aplikasi.",
  },
  {
    q: "Data keuangan saya aman?",
    a: "Data kamu cuma dipakai buat nyatet & rekap buat kamu sendiri, nggak pernah dijual. Isi chat diproses Google Gemini (buat ngerjain catatan) & Fonnte (pintu WhatsApp), lalu tersimpan aman di Supabase. Catatan kecil: pas pakai paket GRATIS, isi chat bisa ikut dipakai Google buat perbaikan model AI — di paket PRO tidak. Rincian lengkap bisa kamu minta via nomor bantuan.",
  },
  {
    q: "Kalau nyesal gimana?",
    a: "Bayar per bulan, bebas berhenti kapan aja — nggak ada auto-debit.",
  },
  { q: "Mau hapus data?", a: null },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ login?: string }>;
}) {
  const sp = await searchParams;
  // Deteksi sesi dashboard (cookie ccat_session) supaya pengguna yang sudah
  // login langsung dikasih pintu ke /dash, bukan dead-end landing.
  const loggedIn = Boolean(await getSessionPhone());

  // Social proof: user yang benar-benar nyatet pengeluaran (punya minimal
  // satu transaksi tersimpan) — bukan sekadar pernah chat bot.
  let userCount = 0;
  try {
    const { count } = await serviceRoleClient
      .from("profiles")
      .select("id, transactions!inner(id)", { count: "exact", head: true });
    userCount = count ?? 0;
  } catch {
    userCount = 0;
  }
  const loginNotice =
    sp.login === "invalid"
      ? "Link login kedaluwarsa atau nggak valid."
      : sp.login === "perlu"
        ? "Sesi kamu selesai."
        : null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2 font-script font-semibold">
            {/* Logo via CSS background (bukan <img>) supaya tidak menjadi
                kandidat gambar preview WhatsApp saat link dibagikan. */}
            <span
              aria-hidden="true"
              className="relative -top-0.5 left-1 inline-block size-8 shrink-0 bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: "url(/logo-tc-64.png)" }}
            />
            {APP_NAME}
          </span>
          {loggedIn ? (
            <Link
              href="/dash"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Buka Dashboard
              <ArrowRight className="size-4" />
            </Link>
          ) : (
            <a
              href={WA_START}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Rocket className="size-4" />
              Mulai Gratis
            </a>
          )}
        </div>
      </header>

      <main>
        {/* Banner status login (link kedaluwarsa / sesi selesai) */}
        {loginNotice && (
          <div className="border-b bg-brand-soft/60">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <p className="text-foreground">
                <span className="font-semibold">Ups.</span> {loginNotice}
              </p>
              <a
                href={WA_DASH}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Rocket className="size-4" />
                Minta link baru
              </a>
            </div>
          </div>
        )}

        {/* 1. HERO */}
        <section className="mx-auto max-w-5xl px-4 pb-12 pt-16 text-center">
          <h1 className="mx-auto mt-5 max-w-3xl font-heading font-script text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Capek mikirin duit <Marker>habis ke mana?</Marker> Urusan catat,
            biar aku yang pegang.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
            Ketik “belanja dapur 150rb”, kirim voice note, atau foto struk. Dalam
            2 detik tercatat & rapi — semua lewat WhatsApp, tanpa install.
          </p>
          <a
            href={WA_START}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
          >
            <Rocket className="size-4" />
            Mulai Gratis via WhatsApp
            <ArrowRight className="size-4" />
          </a>
          {loggedIn && (
            <p className="mt-3 text-sm text-muted-foreground">
              Kamu sudah login —{" "}
              <Link
                href="/dash"
                className="font-medium text-primary underline underline-offset-2"
              >
                buka dashboard
              </Link>
              .
            </p>
          )}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm font-medium">
            <span className="inline-flex items-center gap-1.5">
              <NotebookPen className="size-4 text-primary" />
              2 detik per catatan
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="inline-flex items-center gap-1.5">
              <BarChart3 className="size-4 text-primary" />
              Rekap gratis
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="inline-flex items-center gap-1.5">
              <BellRing className="size-4 text-primary" />
              Dibilangin sebelum bocor
            </span>
          </div>
        </section>

        {/* 1b. SOCIAL PROOF — strip jumlah user */}
        {userCount > 0 && (
          <section className="border-b bg-card/50">
            <div className="mx-auto max-w-5xl px-4 py-6 text-center text-sm text-muted-foreground">
              Udah{" "}
              <Marker className="font-medium text-foreground">
                {userCount.toLocaleString("id-ID")} orang
              </Marker>{" "}
              yang nyatet duitnya lewat TukangCatat.
            </div>
          </section>
        )}

        {/* 2. POSITIONING */}
        <section className="border-b bg-card/50">
          <div className="mx-auto max-w-2xl px-4 py-14 text-center">
            <h2 className="font-heading font-script text-2xl font-semibold">
              Duit <Marker>abis ke mana</Marker> sih?
            </h2>
            <p className="mt-4 text-muted-foreground">
              Belanja ini-itu, akhir bulan malah bingung. Biasanya itu bukan
              karena kamu boros — cuma belum ada yang nyatet dengan rapi.
            </p>
            <p className="mt-3 text-muted-foreground">
              Aku <Marker>{APP_NAME}</Marker>, partner nyatet yang selalu
              standby di WhatsApp: kamu chat, aku catat, rekap dirapihin, dan
              diingetin pas budget mulai menipis.
            </p>
          </div>
        </section>

        {/* 3. CARA PAKAI */}
        <section className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-center font-heading font-script text-2xl font-semibold">
            Cara pakai
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
                <h3 className="font-heading font-medium">
                  <span className="mr-1.5 text-sm font-semibold text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {step.title}
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 4. FITUR */}
        <section className="border-y bg-card/50">
          <div className="mx-auto max-w-5xl px-4 py-14">
            <h2 className="text-center font-heading font-script text-2xl font-semibold">Fitur</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
                  <h3 className="flex flex-wrap items-center gap-2 font-heading font-medium">
                    <f.icon className="size-4 shrink-0 text-primary" />
                    {f.title}
                    {f.pro && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6rem] font-semibold text-primary">
                        PRO
                      </span>
                    )}
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. HARGA */}
        <section className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-center font-heading font-script text-2xl font-semibold">Harga</h2>
          <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
            {/* GRATIS */}
            <div className="flex flex-col rounded-xl bg-card p-6 ring-1 ring-foreground/10">
              <h3 className="font-heading text-lg font-semibold">GRATIS</h3>
              <p className="mt-1 text-3xl font-semibold tracking-tight">
                Rp0<span className="text-sm font-normal text-muted-foreground">/selamanya</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {[
                  `Nyatet via WhatsApp sampai ${FREE_DAILY_TRANSACTION_LIMIT}/hari — cukup buat dapur & jajan harian`,
                  "Catat manual di dashboard tanpa batas",
                  "Rekap & grafik per kategori",
                  "Dibilangin sebelum bocor",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href={WA_START}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl ring-1 ring-primary/30 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-brand-soft"
              >
                <Rocket className="size-4" />
                Mulai Gratis
              </a>
            </div>
            {/* PRO */}
            <div className="flex flex-col rounded-xl border border-primary/40 bg-brand-soft/50 p-6">
              <div className="flex items-center gap-2">
                <h3 className="font-heading text-lg font-semibold">PRO</h3>
                <span className="rounded-full bg-primary px-2 py-0.5 text-[0.6rem] font-semibold text-primary-foreground">
                  PRO
                </span>
              </div>
              <p className="mt-1 text-3xl font-semibold tracking-tight">
                {formatIDR(PRO_PRICE)}
                <span className="text-sm font-normal text-muted-foreground">/bulan</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {[
                  `Nyatet via WhatsApp sampai ${PRO_DAILY_TRANSACTION_LIMIT}/hari`,
                  "Voice note & scan struk tanpa batas",
                  "Catat manual di dashboard tanpa batas",
                  "Rekap malam harian",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href={WA_START}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
              >
                <Rocket className="size-4" />
                Upgrade via WhatsApp
              </a>
            </div>
          </div>
          <div className="mx-auto mt-7 max-w-2xl space-y-2 text-center text-sm text-muted-foreground">
            <p>
              Mulai gratis dulu. Bayar per bulan, bebas berhenti kapan aja —
              nggak ada auto-debit. Setelah periode berjalan selesai, kamu
              balik ke paket gratis.
            </p>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Akun & data kamu tetap milik kamu, dan kalau mau dihapus cukup
              hubungi{" "}
              <a
                href={MAILTO_DELETE}
                className="font-medium text-primary underline underline-offset-2"
              >
                email bantuan
              </a>
              .
            </p>
          </div>
        </section>

        {/* 6. FAQ */}
        <section className="border-t bg-card/50">
          <div className="mx-auto max-w-2xl px-4 py-14">
            <h2 className="text-center font-heading font-script text-2xl font-semibold">FAQ</h2>
            <div className="mt-8 space-y-2.5">
              {FAQS.map((f) =>
                f.a ? (
                  <details key={f.q} className="group rounded-xl border bg-card px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium">
                      {f.q}
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
                  </details>
                ) : (
                  <div key={f.q} className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
                    <span className="font-medium">{f.q}</span>
                    <a
                      href={MAILTO_SUPPORT}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
                    >
                      <Mail className="size-4" />
                      Email bantuan
                    </a>
                  </div>
                )
              )}
            </div>
          </div>
        </section>
      </main>

      {/* 7. FOOTER */}
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
          <span className="font-medium text-foreground">
            {APP_NAME}
          </span>
          <span className="text-center">
            Duit keliatan, hati tenang. ·{" "}
            <a
              href={MAILTO_SUPPORT}
              className="font-medium text-primary hover:underline"
            >
              Hubungi kami
            </a>
            {" · Dibuat di Indonesia · © 2026 TukangCatat"}
          </span>
        </div>
      </footer>
    </div>
  );
}