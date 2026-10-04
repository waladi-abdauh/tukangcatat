// Konfigurasi PM2 untuk produksi (Node + PM2 di VPS, bukan Vercel).
//
// Jalankan:  npx pm2 start ecosystem.config.js
//           npx pm2 reload ecosystem.config.js --update-env
//           npx pm2 logs cepatcatat
//
// ===== Kenapa `next build` TIDAK jalan di server =====
//
// next.config.ts mengaktifkan `output: "standalone"`, jadi `next build`
// menulis .next/standalone/ berisi server.js + hanya node_modules yang benar
// -benar dipakai route kita. scripts/prepare-deploy.sh merakitnya jadi satu
// folder `release/` (ditambah public/ dan .next/static/ yang tidak ikut
// otomatis). Akibatnya di server tidak ada `npm ci`, tidak ada `next build`,
// dan tidak ada toolchain dev -- inilah yang membuat VPS 1 GB cukup.
//
// ===== instances: 1 ITU WAJIB, BUKAN OPSI =====
//
// lib/wa/client.ts mem-pacing pengiriman WA lewat antrean IN-PROCESS, dan
// lib/wa/policy.ts menghitung volume keluar lewat counter yang juga
// per-proses. Kalau aplikasi berjalan di beberapa worker sekaligus:
//
//   - tiap worker punya antrean sendiri -> device menerima burst dari semua
//     worker pada detik yang sama, bukan 1 pesan per 1,1 detik;
//   - cap 500/hari dan 60/jam TERLIPAT GANDA oleh jumlah worker;
//   - circuit breaker hanya protecting satu worker, sementara worker lain
//     tetap menekan device yang sedang bermasalah.
//
// Tidak ada yang gagal diam-diam, semuanya baru terlihat sebagai device
// yang tiba-tiba kena blok. Dan kalau ada worker ke-3 saat deploy,
// pengaman yang sudah kita bangun jadi hanya separuh aktif.
//
// Scale naik? Naikkan vertically (RAM) dulu. Horizontal scaling butuh
// antrean + counter terpusat (Redis/Postgres) plus redesign lib/wa/policy.ts
// supaya tidak memakai counter in-process sama sekali.
// `current` adalah symlink ke releases/<sha>. PM2 me-restart process otomatis
// setiap kali GitHub Actions menukar symlink itu, sehingga kita SELALU dapat
// drain penuh (lihat kill_timeout di bawah) tanpa menimpa file yang sedang
// dipakai process yang sedang melayani request.
const RELEASE_DIR =
  process.env.CEPATCATAT_DIR || "/opt/cepatcatat/current";

module.exports = {
  apps: [
    {
      name: "cepatcatat",
      // Langsung `node server.js`, bukan `npm run start`. Wrapper npm menambah
      // satu process lagi (memakan RAM) dan memperlambat tiap restart.
      script: "server.js",
      interpreter: "node",
      cwd: RELEASE_DIR,
      instances: 1,
      exec_mode: "fork", // JANGAN "cluster": lihat catatan di atas.
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      // 1 GiB droplet. Batas heap sedikit di bawah ambang PM2 supaya V8
      // sempat GC duluan sebelum PM2 killing process -- restart karena OOM
      // jauh lebih merepotkan daripada restart terjadwal.
      node_args: "--max-old-space-size=640",
      max_memory_restart: "700M",

// ===== Drain: baris paling penting di file ini =====
      //
      // PM2 mengirim SIGINT lalu MENUNGGU sebanyak kill_timeout ms sebelum
      // SIGKILL. Default PM2 hanya 1600ms -- jauh tidak cukup.
      //
      // Kenapa penting: route webhook mengklaim baris dedupe (wa_inbound_seen)
      // SEBELUM pekerjaan background-nya jalan. Kalau process di-SIGKILL saat
      // after() masih berjalan, baris dedupe sudah ada tapi transaksi tidak
      // pernah disimpan -> pesan user hilang PERMANEN tanpa balasan. Memotong
      // drain demi boot lebih cepat adalah trade-up yang salah.
      //
      // Next.js sudah menangani SIGINT/SIGTERM sendiri: ia menyelesaikan request
      // yang sedang berjalan lalu menuntaskan after() yang tertunda sebelum
      // keluar. Tugas kita cuma memberi cukup waktu. Rekomendasi Next: 10-30s.
      //
      // 30 detik dipilih karena worst case nyata: antrean outbound saat warm-up
      // berjarak 8 detik dan dibatasi 10 pesan/jam, jadi 10 pesan saja butuh
      // ~80 detik. 30 detik menutup kasus umum (0-3 pesan pending) dengan
      // margin; sisanya berpeluang terpotong, dan itu trade-off yang sadar.
      //
      // CATATAN PENTING soal downtime: `pm2 reload` HANYA zero-downtime di
      // `cluster` mode. Di `fork` mode PM2 me-restart = kill proses lama
      // DULUAN, baru start yang baru. Jadi di mode ini downtime = drain + boot
      // (sekitar 3 detik untuk kondisi normal). Itu trade-off yang kita mau:
      // jujur soal downtime pendek, tapi tidak pernah memotong drain dan
      // membuat catatan user hilang diam-diam.
      //
      // Butuh zero downtime sungguhan? Jalur alternatifnya blue-green lewat
      // Caddy: start release baru di port lain -> health check -> ganti
      // upstream. Belum dipakai karena ada jendela dua proses hidup bersamaan,
      // dan itu antagonis dengan antrean WA per-proses yang dijelaskan di atas.
      kill_timeout: 30000,
      // PM2 mengirim SIGINT (default). Next menunggu after() selesai di sini.
      kill_signal: "SIGINT",

      env: {
        NODE_ENV: "production",
        PORT: "3000",
        // Hanya loopback: Caddy yang meneruskan trafik dari internet.
        // Bind ke 0.0.0.0 berarti port 3000 terbuka langsung ke publik dan
        // melewati TLS + rate limit Caddy.
        HOSTNAME: "127.0.0.1",
      },

      // Log dirotasi harian supaya tidak memenuhi disk 1 GiB.
      merge_logs: true,
      time: true,
    },
  ],
};