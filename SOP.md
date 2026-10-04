# SOP CepatCatat — Start & Resume

Panduan menghidupkan kembali project dari nol (setelah laptop restart, atau lama tidak dibuka), lengkap dengan peta hubungan antar komponen.

---

## 1. Peta sistem (siapa ngapain)

CepatCatat terdiri dari **2 sisi** yang saling terhubung:

| Komponen | Dimana | Hidup sendiri? | Butuh di-start? |
|---|---|---|---|
| App Next.js | Laptop (localhost:3000) | ❌ mati saat laptop off / terminal ditutup | ✅ `npm run dev` |
| Tunnel Cloudflare | Laptop (cloudflared) | ❌ mati saat laptop off | ✅ jalankan lagi (URL **berubah tiap kali**) |
| Supabase (database) | Cloud | ✅ selalu hidup | ❌ cukup `.env.local` benar |
| Google Gemini (AI) | Cloud | ✅ selalu hidup | ❌ cukup `GEMINI_API_KEY` |
| Fonnte (WA gateway) | Cloud | ✅ hidup, tapi **device** = nomormu di HP | ⚠️ pastikan device online, webhook URL sesuai tunnel |
| Midtrans (bayar) | Cloud sandbox | ✅ | ❌ tidak perlu utk dev/test |

Arus pesan WA → aplikasi:

```
HP kamu
  │  kirim "bensin 35rb" (WhatsApp)
  ▼
Fonnte device (nomor 6285773365200, online di HP)
  │  POST webhook
  ▼
https://<URL-tunnel>/api/webhook/whatsapp?key=...  ← Cloudflare tunnel
  │  diteruskan ke laptop
  ▼
localhost:3000 (npm run dev)
  │  ├─ simpan transaksi ke Supabase
  │  ├─ panggil Gemini untuk parse (kalau perlu)
  │  └─ balas via API Fonnte (pakai WA_GATEWAY_TOKEN)
  ▼
kamu dapat balasan di WhatsApp
```

Dashboard:
```
HP kamu → buka link https://<URL-tunnel>/dash?token=... (magic link dari bot)
        → tunnel → localhost:3000 → cookie ccat_session → dashboard
```

**Kenapa tiap restart ribet?** Tunnel nggak pakai domain permanen — Cloudflare kasih URL acak yang **ganti tiap kali**. Padahal URL itu dipakai di 2 tempat: `.env.local` (buat magic link) dan **Fonnte Device → Edit** (webhook). Jadi urutan SOP di bawah mengikuti: tunnel dulu → catat URL → baru update yang lain.

---

## 2. SOP Start (setelah laptop restart) — urutan wajib

### Terminal A — tunnel
```powershell
cloudflared tunnel --url http://localhost:3000
```
- Outputnya seperti `https://xxxx-yyy.trycloudflare.com`. **Catat URL-nya.**
- **Biarkan terminal ini terus terbuka** — kalau ditutup, webhook & dashboard mati.
- Kalau command tidak ketemu: install dulu `winget install cloudflared`.

### Edit `.env.local`
- Ubah baris `NEXT_PUBLIC_APP_URL=https://<URL-BARU>` (URL dari Terminal A).
- Jangan diisi `http://localhost:3000` kalau mau diakses dari HP/bot — magic link bot & dashboard link memakai nilai ini.

### Terminal B — app
```powershell
npm run dev
```
- Tunggu muncul "Ready".
- **Catatan**: kalau dev server sudah jalan lebih dulu, `npm run dev` **harus direstart** setelah edit `.env.local` (nilai `NEXT_PUBLIC_` di-reload saat start).

### Cek landing
- Buka `https://<URL-BARU>` di browser → halaman landing CepatCatat muncul. Kalau muncul, app + tunnel oke.

### Fonnte — update webhook & cek device
1. Buka dashboard Fonnte → buka **Device** (yang berisi nomor 6285773365200).
2. **Edit** → isi **Webhook URL** (tanpa enter kedua, cukup satu baris):
   ```
   https://<URL-BARU>/api/webhook/whatsapp?key=<WA_WEBHOOK_SECRET_TOKEN>
   ```
   Nilai `key` ambil dari `.env.local` (var `WA_WEBHOOK_SECRET_TOKEN`).
   ⚠️ **Jangan pernah menempel nilai secret asli ke dokumen ini.** Secret pernah
   bocor ke versi lama file ini dan sudah ada di riwayat git — kalau dipakai,
   **rotasi** `WA_WEBHOOK_SECRET_TOKEN` lalu tempel ulang URL di dashboard device.
3. **Save** (halaman route-nya otomatis balas 200 saat validasi).
4. Pastikan status device **terhubung**. Kalau offline: scan QR / reconnect lewat dashboard Fonnte (butuh HP dengan WA yang sama online).

### Tes end-to-end
1. Dari HP, chat nomor bot: `halo` → harus dibalas onboarding.
2. Kirim `bensin 35rb` → balasan "tersimpan".
3. Kirim `!dashboard` → bot kirim link `https://<URL-BARU>/dash?token=...` → buka → dashboard muncul.

✅ Selesai. Data lama di Supabase tetap ada (cloud, nggak kena restart).

---

## 3. Mode "kerja lokal aja" (no bot / no HP)

Tanpa tunnel, asal server jalan di laptop sama saja:

```powershell
# 1. (opsional) jadikan magic link nunjuk ke localhost — kalau semisal NEXT_PUBLIC_APP_URL masih URL tunnel lama, biarkan saja; link lokal untuk tes di laptop.
npm run dev
```

Login ke dashboard butuh token. Cara paling gampang tanpa bot:
```powershell
npm run seed:dummy
```
- Mencetak **magic link login** langsung ke `/dash`.
- ⚠️ **Sekaligus menghapus** transaksi nomor `DEV_TEST_PHONE` lalu menanam dummy (21 transaksi + 7 budget). **Jangan** jalankan kalau mau data lewat bot tetap utuh di nomor itu.
- Nomor uji diatur di `.env.local` (`DEV_TEST_PHONE`). **Jangan pernah** diisi nomor bot (`WA_DEVICE_NUMBER`) — script ini akan menghapus semua datanya.

Alternatif aman kalau nggak mau kehapus: hidupkan tunnel + Fonnte, lalu minta link via bot (`!dashboard`).

---

## 4. Kalau lama nggak dibuka / muncul error

| Gejala | Penyebab | Solusi |
|---|---|---|
| `Cannot find module` saat `npm run dev` | `node_modules` hilang | `npm install` lalu start lagi |
| Landing jalan tapi webhook nggak masuk | URL tunnel berubah / tunnel mati | Start ulang SOP section 2 (Terminal A + update Fonnte) |
| Fonnte device "offline" | HP penampung WA mati / WA keluar | Reconnect QR di Fonnte, pastikan HP online |
| Webhook 401 | `?key=` di URL Fonnte salah/kedaluwarsa | Cek `WA_WEBHOOK_SECRET_TOKEN` di `.env.local`, tempel ulang |
| Dashboard error 403 / server action gagal | Hostname tunnel belum diizinkan | Sudah diatur di `next.config.ts` (`allowedDevOrigins` + `serverActions.allowedOrigins`) — pastikan pakai pipa `*.trycloudflare.com` |
| AI nggak jalan | Quota trial habis / `GEMINI_API_KEY` | Tambah `TRIAL_AI_QUOTA` (default 3) di `.env.local`, atau jadi PRO |
| Masih bingung | — | Cek `webhook.log` (debug, di folder temp opencode) + log terminal `npm run dev` |

---

## 5. Perintah yang sering dipakai

```powershell
npm run dev             # jalankan app (di terminal sendiri)
npm run lint            # cek style
npx tsc --noEmit        # cek tipe TS
npm run build           # build production
npm run seed:dummy      # pasang dummy data + cetak magic link (HATI-HATI: hapus transaksi DEV_TEST_PHONE)
npm run verify:wablas   # tes mapper payload Wablas (tanpa network/db)
npm run verify:guards   # tes dedupe inbound + kuota AI (butuh migration 20260102)
npm run verify:rename   # tes rename kategori: laporan bulan lalu tidak boleh berubah
npm run verify:guard    # tes cap global + kill switch (butuh migration 20260103)
npm run maintain:cleanup  # pangkas wa_inbound_seen (3 hari), wa_outbound_usage (3 hari) & ai_usage_daily (90 hari)
cloudflared tunnel --url http://localhost:3000   # tunnel publik (URL baru tiap run)
```

---

## 5b. Cutover gateway Fonnte → Wablas

PENTING: satu nomor WhatsApp **tidak boleh terhubung ke dua gateway
sekaligus**. Kalau Fonnte masih aktif saat Wablas di-scan, session saling
melempar dan hasil tidak bisa dipercaya.

**Tahap 1 — siapkan (tanpa menyentuh nomor)**
1. Jalankan `npm run verify:wablas` → harus 13/13 lulus.
2. Di dashboard Wablas, buat device & salin **token** + **secret key**.
3. Edit `.env.local`:

   ```ini
   WA_GATEWAY=wablas
   WA_WABLAS_TOKEN=<token Wablas>
   WA_WABLAS_SECRET=<secret key Wablas>
   WA_DEVICE_NUMBER=6285773365200
   WA_WEBHOOK_SECRET_TOKEN=<string acak panjang>
   ```

   - `token` ada di menu **Device → Settings**; `secret_key` dikirim ke WhatsApp
     admin saat dibuat.
   - Auth Wablas = `Authorization: {token}.{secret_key}` (tanpa "Bearer") —
     bukan seperti Fonnte.
   - Kredensial Fonnte tetap tersimpan sebagai `WA_FONNTE_TOKEN`, jadi rollback
     cukup ganti `WA_GATEWAY=fonnte` tanpa downtime.
   - `WA_DEVICE_NUMBER` = nomor **device** Wablas. Di Wablas inbound, `phone` =
     nomor **user** dan `sender` = nomor **device** (berlawanan dengan Fonnte).

   Kredensial Wablas sudah tersimpan di `.env.local` (`WA_WABLAS_TOKEN` /
   `WA_WABLAS_SECRET`).

**Tahap 2 — aktifkan (cuma setelah tahap 1 beres)**
1. Di Fonnte: **logout / disconnect** device, atau hapus device.
2. Restart app (`npm run dev`) supaya env baru terbaca.
3. Di Wablas: scan QR **dengan HP yang WA nomornya sama**.
4. Wablas → **Device → Settings → Webhook URL**:
   `https://<URL-TUNNEL>/api/webhook/whatsapp?key=<WA_WEBHOOK_SECRET_TOKEN>`
5. Tes end-to-end: `halo`, `bensin 35rb`, `!dashboard`, lalu voice note + foto struk.

**Kalau gagal & mau balik ke Fonnte**: set `WA_GATEWAY=fonnte` di `.env.local`,
restart, lalu sambungkan device Fonnte lagi. Token Fonnte masih tersimpan
(`WA_FONNTE_TOKEN`) jadi tidak perlu mencari-cari token lagi. Data user tidak
hilang (Supabase).

### Perbedaan yang sering jadi sumber bug
- Fonnte mengirim media sebagai `url` + `extension`; Wablas mengirim `url` +
  `mimeType` + `messageType`. `message` berisi `"File"` untuk media — kalau
  diteruskan jadi teks, isi struk ikut ter-parse.
- Wablas membalas HTTP 200 dengan body `{"status":false}` saat kuota habis, jadi
  status HTTP saja tidak cukup dianggap sukses.
- Batas media keluar Wablas **2 MB** (gambar jpg/jpeg/png, audio mp3/ogg/mpga).
- Wablas tidak menyediakan signature/HMAC webhook — `WA_WEBHOOK_SECRET_TOKEN`
  adalah satu-satunya auth, jadi pakai yang panjang dan jangan bocor.

---

## 5c. Pengaman anti-blokir nomor

Nomor terblokir = produk mati, jadi pengaman ini wajib aktif sebelum produksi.
Semua kontrolnya di `lib/wa/policy.ts` dan ditegakkan dari `lib/wa/client.ts`.

### Migration (WAJIB, satu kali)

```bash
# Supabase Dashboard → SQL Editor, jalankan isi file:
supabase/migrations/20260103_wa_outbound_guard.sql
```

Lalu buktikan:

```powershell
npm run verify:guard   # 10 pemeriksaan lulus
```

Kalau script berhenti dengan **MIGRASI BELUM JALAN**, berarti cap global dan kill
switch sedang fail-open: aplikasi tetap jalan, tapi tidak terlindungi. Jangan
abu-abukan, jalankan SQL-nya.

### Apa saja yang dijaga

| Kontrol | Default | Env override |
|---|---|---|
| Jam tenang (WIB) | 22:00–06:00, transaksi tetap disimpan tanpa balasan | `WA_QUIET_HOURS_START/END` |
| Cap volume global | 500/hari + 60/jam per user | `GLOBAL_DAILY_OUTBOUND_CAP/H` |
| Warm-up | 60 menit pertama, jeda 8 detik, maks 10/jam | `WA_WARMUP_*` |
| Circuit breaker | 3 gagal beruntun → jeda 10 menit, naik berlipat, plafon 40 menit | `WA_CIRCUIT_*` |
| Timeout HTTP gateway | 20 detik | `WA_GATEWAY_TIMEOUT_MS` |
| Kill switch device | otomatis aktif saat gateway balas `banned/blocked/disconnect` | — |
| Health check device | `/api/cron/gateway-health` tiap 15 menit | — |

### Kalau nomor kena blok

1. 
pm run verify:guard - pastikan kill switch benar-benar aktif.
2. Cek `gateway_health` di Supabase: `status`, `detail`, `blocked_at`.
3. **Jangan** langsung restart app untuk "mencoba lagi" — itu menambah
   tekanan ke device yang sedang bermasalah.
4. Kalau `detail` menunjuk kuota habis, itu kuota Wablas, bukan bug kita.
   Naikkan kuota paket dulu, baru reset kill switch lewat
   `clear_gateway_blocked()`.
5. Kalau `detail` menunjuk pola balasan, turunkan `GLOBAL_HOURLY_OUTBOUND_CAP`
   dan `WA_WARMUP_MINUTES` sebelum reset.

### Cron health check (produksi)

Jadwalkan tiap 15 menit dengan header `Authorization: Bearer CRON_SECRET`:

```
GET /api/cron/gateway-health
```

Sistem ini **khusus Fonnte/Wablas** - sudah ada endpoint device info
device info Wablas. Kalau pindah ke gateway lain, `checkDeviceHealth` perlu
diisi ulang.

### Produksi: PM2 `instances: 1` BUKAN OPSI

Pacing antrean dan circuit breaker dihitung **in-process**. Kalau app jalan
di beberapa worker, cap 500/hari terlipat ganda dan burst masuk ke device
dari semua worker sekaligus.

```bash
npx pm2 startOrRestart ecosystem.config.js --update-env
```

Naikkan kapasitas secara vertical (RAM) dulu. Scaling horizontal butuh
antrean + counter terpusat (Redis/Postgres) **dan** redesign
`lib/wa/policy.ts`.

> **Jangan pakai `pm2 reload`.** `reload` hanya zero-downtime di `cluster`
> mode. Di `fork` mode (yang kita pakai) `reload` jatuh ke perilaku restart:
> kill proses lama dulu, baru start yang baru. `startOrRestart` jujur soal
> downtime pendek itu (±3 detik) dan tidak pernah memotong drain.

---

## 6. Deploy produksi (CI + VPS)

Alurnya: push ke `master` → `verify` (tsc + lint + build + rakit paket) →
berhenti menunggu approval → rsync → symlink swap → `pm2 startOrRestart` →
smoke test.

### Build di GitHub, bukan di VPS

`next.config.ts` memakai `output: "standalone"`, jadi `next build`
menghasilkan folder berisi `server.js` + hanya `node_modules` yang dipakai
route kita. `scripts/prepare-deploy.sh` merakitnya jadi satu folder
`release/` (ditambah `public/` dan `.next/static/`, yang tidak ikut otomatis).

Akibatnya di server **tidak ada** `npm ci`, tidak ada `next build`, tidak ada
toolchain dev. Inilah alasan VPS 1 GB cukup.

### Layout di server

```
/opt/cepatcatat/
  current -> releases/<sha>   # symlink; ditukar tiap deploy (atomic rename)
  releases/<sha>/             # satu folder per commit, 5 terakhir disimpan
  shared/.env                 # secret runtime, TIDAK pernah masuk git
```

Next.js memuat `.env` dari `process.cwd()`, jadi `releases/<sha>/.env` adalah
symlink ke `shared/.env`. Secret ditulis sekali di `shared/`, tidak pernah
ikut berubah saat deploy.

### Deploy

```bash
git push origin master
```

Lalu buka tab **Actions** di GitHub, pilih run `Deploy`, klik job
`Deploy ke VPS`, tekan **Approve**. Job `verify` sudah harus hijau.

### Rollback

```bash
ssh deploy@<ip>
cd /opt/cepatcatat
ls -1dt releases/*/ | head            # cari SHA target
ln -sfn releases/<sha-target> current.tmp && mv -T current.tmp current
pm2 startOrRestart ecosystem.config.js --update-env
```

Rollback hanya menukar symlink; tidak perlu upload ulang apa pun. Release
lama yang sudah di-prune tidak tersedia lagi.

### Kalau smoke test gagal

Job deploy gagal **setelah** symlink sudah tertukar dan PM2 direstart. Jadi
`current` mungkin sudah menunjuk release rusak. Cek `pm2 logs cepatcatat --lines 80`
dan `journalctl -u caddy -n 50`, lalu rollback seperti di atas.

### Setelah reboot VPS

`pm2 save` sudah dijalankan tiap deploy, tapi daemon PM2 hanya hidup selama
sesi login. Supaya app hidup setelah reboot:

```bash
pm2 startup      # jalankan perintah yang dicetak, lalu pm2 save
```

### Rotasi secret

`WA_WEBHOOK_SECRET_TOKEN`, token Wablas, dan `GEMINI_API_KEY` pernah tampil
di chat. Rotasi **wajib** sebelum webhook publik aktif:

1. Tulis nilai baru di `/opt/cepatcatat/shared/.env`.
2. Update `?key=` di dashboard gateway (Wablas/Fonnte).
3. Kalau `NEXT_PUBLIC_APP_URL` berubah, itu **perlu rebuild** — nilainya
   di-inline saat build, restart tidak cukup.

Secret runtime di GitHub: **Settings > Secrets and variables > Actions**.
Variabel `NEXT_PUBLIC_*` pakai tab **Variables** (nilainya publik dan memang
di-inline ke bundle browser). Environment `production` + required reviewers
yang membuat workflow berhenti untuk approval.

---

## 7. Referensi `.env.local` (mana yang dipakai untuk apa)

Semua ada di `.env.local` (sudah terisi). Template lengkap di `.env.local.example`.

| Variable | Dipakai untuk | Perlu update tiap tunnel ganti? |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Basis magic link yang dikirim bot | **Ya** (diisi URL tunnel baru) |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Akses database | Tidak |
| `GEMINI_API_KEY` (+ `GEMINI_MODEL`) | Parse AI (teks/suara/foto) | Tidak |
| `WA_GATEWAY` | Gateway aktif: `fonnte` atau `wablas` | Ya (saat cutover) |
| `WA_FONNTE_TOKEN` | Token device Fonnte | Tidak |
| `WA_WABLAS_TOKEN` / `WA_WABLAS_SECRET` | Kredensial Wablas | Tidak |
| `WA_WEBHOOK_SECRET_TOKEN` | Verifikasi webhook (`?key=`) | Tidak (tapi tempel di URL webhook device) |
| `WA_DEVICE_NUMBER` | Allowlist device pengirim (nomor bot) | Tidak |
| `DEV_TEST_PHONE` | Nomor uji untuk script dev/seed/verify (bukan nomor bot!) | Tidak |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` / `MIDTRANS_SERVER_KEY` / `MIDTRANS_IS_PRODUCTION` | Pembayaran (belum aktif) | Tidak |
| `JWT_SECRET_KEY` | Token login (`ccat_session`) | Tidak (jangan diganti, semua sesi invalid) |
