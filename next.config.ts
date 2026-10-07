import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build produksi di/self-contained: `next build` menulis .next/standalone/
  // berisi server.js + hanya node_modules yang benar-benar dipakai route kita.
  // Berarti build Next.js TIDAK perlu dijalankan di VPS 1 GB, dan `npm ci`
  // tidak perlu ada di server sama sekali.
  output: "standalone",
  // Menandai root workspace proyek ini untuk Turbopack (mencegah deteksi keliru
  // karena ada package-lock.json lain di folder induk D:\repos).
  turbopack: {
    root: __dirname,
  },
  // Tracing file output juga dipatok ke root proyek. Tanpa ini Next memakai
  // layout monorepo dan file di luar app/ bisa ikut ter-trace atau terlewat.
  outputFileTracingRoot: path.join(__dirname),
  // Akses dashboard harus melewati pemeriksaan Origin pada Server Actions.
  // Kalau hostname produksi tidak ada di daftar ini, login / rename kategori /
  // hapus budget akan gagal dengan 403 padahal halaman dashboard-nya sendiri
  // terbuka normal - gejalanya sangat menyesatkan karena tidak ada hint sama
  // sekali bahwa masalahnya allowlist Origin.
  //
  // Entries produksi ditambahkan TANPA wildcard sengaja: hanya domain yang
  // benar-benar kita kendalikan boleh memanggil Server Actions kita. Wildcard
  // `*` di sini berarti situs mana pun bisa membuat browser user mengirim
  // request_actions ke server kita, dan cookie sesi ikut dibawa.
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "tukangcatat.com",
    "www.tukangcatat.com",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "tukangcatat.com",
        "www.tukangcatat.com",
        // Dipakai hanya saat pengembangan lokal lewat tunnel Cloudflare.
        "*.trycloudflare.com",
      ],
    },
  },
  // Service worker harus selalu dicek ulang browser (jangan kena HTTP cache)
  // supaya versi baru langsung aktif saat deploy.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
    ];
  },
};

export default nextConfig;