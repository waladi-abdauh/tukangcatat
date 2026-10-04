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
  // Akses dashboard lewat tunnel Cloudflare (dev) harus diizinkan, skor
  // Origin berbeda dari localhost.
  allowedDevOrigins: ["*.trycloudflare.com"],
  experimental: {
    serverActions: {
      allowedOrigins: ["*.trycloudflare.com"],
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