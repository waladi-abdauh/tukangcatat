# Cara Kerja TukangCatat (untuk owner)

Panduan singkat: apa yang jalan di mana, gimana alurnya, dan **kalau ada yang
salah, mulai cek dari mana**. Detail teknis panjang ada di `SOP.md`.

---

## 0. Dua nama = SATU aplikasi

Namanya berubah di tengah jalan. Yang **dilihat user** = TukangCatat; yang
**dipakai di command/server/repo** = cepatcatat (nama teknis warisan lama).

| Publik / brand | Teknis / internal |
|---|---|
| "TukangCatat" di landing, dashboard, bot WA, PWA | `package.json` → name: `cepatcatat` |
| Domain `tukangcatat.com` | Folder lokal: `D:\repos\cepatcatat` |
| Repo GitHub: `waladi-abdauh/tukangcatat` | Folder VPS: `/opt/cepatcatat` |
| Email: `catattukang@gmail.com` | Proses PM2: `cepatcatat` |

Aturan: yang **user lihat** → tulis "TukangCatat". Yang **kamu ketik** di
terminal/server/repo → "cepatcatat". **Jangan** rename yang teknis (bikin ribet,
tanpa manfaat).

---

## 1. Tiga lingkungan (jangan tertukar)

| Lingkungan | Di mana | Buat apa | Secret dari |
|---|---|---|---|
| **Dev** | laptop kamu, `npm run dev` | ngembangin / nyoba, bebas rusak | `.env.local` |
| **CI** | GitHub Actions (cloud) | cek `tsc`+`lint`+`build`, lalu deploy | Variables & Secrets GitHub |
| **Prod** | VPS `202.155.95.43` | bot + dashboard yang dipakai user | `/opt/cepatcatat/shared/.env` |

**Prod TIDAK pernah dibangun dari laptop.** Laptop hanya untuk ngoding; build &
deploy terjadi di CI lalu dikirim ke VPS.

---

## 2. Alur data (dari mana ke mana)

```
HP user ──chat──▶ WhatsApp ──▶ Wablas (device 6285...200) ──webhook──▶
Cloudflare (proxy oranye) ──▶ Caddy :443 ──▶ Next.js di 127.0.0.1:3000 ──▶ Supabase
                                                     │
                                          parse via Gemini, simpan transaksi,
                                          balas lewat API Wablas ──▶ HP user

Dashboard: HP user ──HTTPS──▶ tukangcatat.com ──▶ Caddy ──▶ Next :3000 (cookie sesi)
```

- Port `3000` **hanya** loopback; publik lewat Caddy (`:443`).
- Cloudflare + Caddy = TLS & proteksi. Kalau salah satu bermasalah, bot tetap
  "hidup" tapi pesan tak sampai — lihat section 11.

---

## 3. Database (Supabase)

- **Supabase = Postgres di cloud.** Bukan di laptop, bukan di VPS. Dev & prod
  **memakai database yang sama** — hati-hati saat tes yang menghapus data.
- Dua kunci berbeda:
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → publik, aman (dilindungi RLS).
  - `SUPABASE_SERVICE_ROLE_KEY` → **rahasia**, hanya di server. Bypass RLS.
- Tabel yang berguna untuk diagnosa: `wa_inbound_seen` (pesan WA masuk),
  `wa_outbound_usage` (pesan keluar/hari), `gateway_health` (status kill switch),
  `transactions` (catatan user).

---

## 4. Secret ada di 4 tempat

| Tempat | Isi | Boleh publik? |
|---|---|---|
| GitHub **Variables** | `NEXT_PUBLIC_*` (di-inline saat build) | Ya |
| GitHub **Secrets** | `VPS_HOST/USER/PORT/SSH_KEY/KNOWN_HOSTS` (alat deploy) | Tidak |
| VPS `/opt/cepatcatat/shared/.env` | semua secret runtime (Supabase service-role, Gemini, Wablas, JWT, VAPID, Midtrans, `CRON_SECRET`) | Tidak |
| Laptop `.env.local` | salinan lengkap untuk dev | Tidak (jangan commit) |

- **Jangan pernah** commit `.env`/secret ke git. Nilai yang pernah tampil di
  chat/output → rotasi (lihat `SOP.md` bagian "Rotasi secret").

---

## 5. Bikin fitur baru (dev dulu, prod aman)

```powershell
npm run dev                 # buka http://localhost:3000
# ...edit kode...
npx tsc --noEmit            # cek tipe
npm run lint                # cek gaya
npm run build               # pastikan build produksi tetap hijau
```

Tes manual: di laptop; kalau perlu lewat HP, jalankan tunnel Cloudflare
(SOP section 2). **Tidak ada** yang menyentuh prod dari langkah ini.

---

## 6. Commit & push

```powershell
git add -A
git commit -m "feat: deskripsi singkat"
git push origin master
```

- Push ke `master` **hanya** memicu job `verify` (tsc + lint + build). **Tidak**
  menyentuh VPS.
- Sebelum commit: pastikan `tsc`, `lint`, `build` sudah hijau di laptop.

---

## 7. Deploy ke produksi (manual, 2 klik)

1. GitHub → tab **Actions** → workflow **Deploy** → **Run workflow**.
2. **Centang** input `deploy` → **Run**.

Yang terjadi di job `deploy`: upload paket → `rsync` ke
`/opt/cepatcatat/releases/<sha>` → tukar symlink `current` (atomik) → `pm2
startOrRestart` → smoke test (landing + webhook 200, cek `.release-sha`).
**Hijau = live.** Merah = baca nama step yang gagal.

---

## 8. Ada bug di prod? Urutannya

1. **Diagnosa dulu** (jangan asal deploy):
   ```bash
   ssh deploy@202.155.95.43
   pm2 status
   pm2 logs cepatcatat --lines 80
   cat /opt/cepatcatat/current/.release-sha
   ```
2. **Kalau user terdampak & urgent** → rollback dulu (section 9) supaya cepat normal.
3. **Benerin di lokal** (section 5) → push → deploy lagi (section 7).

---

## 9. Rollback ke versi sebelumnya

```bash
ssh deploy@202.155.95.43
cd /opt/cepatcatat
ls -1dt releases/*/            # cari SHA target
ln -sfn releases/<sha-target> current.tmp && mv -T current.tmp current
pm2 startOrRestart ecosystem.config.js --update-env
```

- Hanya **5 release terakhir** disimpan; yang sudah dibuang tak bisa di-rollback.
- Rollback cuma menukar symlink, tak perlu upload ulang.

---

## 10. Setelah deploy, tes apa?

Otomatis (sudah dilakukan CI): landing & webhook balas 200, SHA cocok. Manual:

1. Buka `https://tukangcatat.com` → halaman landing muncul.
2. Kirim ke nomor bot: `Ketupat 15rb` → harus dibalas "tersimpan".
3. Cek catatannya muncul di dashboard (`!dashboard` → magic link).
4. Kalau ada fitur baru yang kamu ubah: tes fitur itu + hal yang berdekatan.

---

## 11. Kalau ada yang salah — mulai dari sini

| Gejala | Cek pertama |
|---|---|
| **Bot tidak membalas** | (a) Wablas: device `connected`? (b) masa paket `expired_date` belum lewat? (c) `webhook_url` terisi? (d) `gateway_health` = `blocked`? (e) jam tenang 22–06 WIB? (f) cap harian? |
| Device Wablas putus/expired | `curl "$WA_WABLAS_ENDPOINT/api/device/info?token=$WA_WABLAS_TOKEN"` → `status`, `expired_date`, `quota` |
| Dashboard buka tapi aksi (login/simpan) gagal 403 | domain benar & ada di `allowedOrigins` (`next.config.ts`) |
| Landing error 502/526 / tak bisa diakses | `journalctl -u caddy -n 50`; app :3000 hidup? (`pm2 status`) |
| Deploy merah di "Restart PM2 + smoke test" | baca pesan step: `.release-sha` cocok? port 3000? `pm2 logs` |
| Health-check `check_failed` | cek `lib/wa/device-status.ts` (pernah: body dipotong sebelum di-parse) |
| Data/angka aneh di dashboard | cek langsung Supabase (section 3) |

---

## 12. Perintah yang paling sering dipakai

**Laptop**
```powershell
npm run dev                 # jalankan dev
npx tsc --noEmit            # cek tipe
npm run lint                # cek gaya
npm run build               # build produksi
```

**VPS** (SSH dulu: `ssh deploy@202.155.95.43`; **bukan** `ssh deploy@...password` — user deploy tanpa password)
```bash
pm2 status                  # proses hidup?
pm2 logs cepatcatat --lines 80
cat /opt/cepatcatat/current/.release-sha     # versi yang jalan
crontab -l                                   # jadwal health-check
tail -n 20 /home/deploy/gateway-health.log   # heartbeat cek device (tiap 15 mnt)
. /opt/cepatcatat/shared/.env; curl -s "$WA_WABLAS_ENDPOINT/api/device/info?token=$WA_WABLAS_TOKEN"  # status device
```

**Health-check otomatis:** cron `*/15` memanggil `/api/cron/gateway-health`.
Kalau device WA putus/expired → kill switch otomatis aktif (berhenti kirim); saat
device `connected` lagi → otomatis pulih. Log-nya di
`/home/deploy/gateway-health.log`.
