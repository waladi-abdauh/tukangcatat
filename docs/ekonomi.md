# Simulasi Ekonomi — 85 PRO, tanpa upgrade fase awal

Semua angka bulanan dalam Rupiah kecuali yang ditandai USD. Sumber harga
dicatat di bagian bawah supaya bisa ditinjau ulang saat berubah.

## Asumsi

- Harga PRO: **Rp19.000**/bulan (`PRO_PRICE` di `lib/constants.ts`).
- Rasio FREE:PRO = **10:1** → 85 PRO + 850 FREE = 935 pengguna.
- Paket Wablas **10.000 pesan/bulan** (belum perlu upgrade).
- 1 pesan inbound = 1 outbound (setiap transaksi dibalas).
- Pemakaian per user:
  - PRO: 40 pesan/bulan (1,3/hari — konservatif untuk catat belanja).
  - FREE: 8 pesan/bulan (di bawah batas 5/hari yang baru ditetapkan).
- Domain `.id` Rp100.000/tahun → Rp8.333/bulan.
- Kurs dipakai: **Rp16.000/USD**.

## Kebutuhan kuota pesan

```
PRO   : 85 × 40 = 3.400
FREE  : 850 × 8 = 6.800
Total            = 10.200 pesan/bulan
```

Artinya paket 10.000 pesan **tidak cukup** untuk 85 PRO pada asumsi ini —
kurang ~200 pesan (2%). Tiga jalan keluar, tanpa menaikkan fixed cost:

| Opsi | Tambahan biaya | Catatan |
|---|---|---|
| Naikkan rasio FREE:PRO jadi 12:1 | Rp0 | 85 PRO + 1.020 FREE = 10.600 pesan (bentrok tipis) |
| Turunkan rata-rata FREE ke 7 pesan | Rp0 | 3.400 + 5.950 = 9.350 pesan (aman, ada sisa ~6%) |
| Naik ke paket lebih besar | Rp15.000–45.000/bulan | baru perlu kalau >120 PRO |

**Rekomendasi:** kuota tidak dinaikkan dulu. Batas FREE 5/hari yang baru
diterapkan di `lib/constants.ts` sudah membuat 8 pesan/bulan per FREE realistis
dan tidak manusiawi berlebihan. Kalau kuota 10.000 benar-benar habis, **pakai
Unlimited** (Rp76.000–107.000) — biaya tetapnya masih jauh di bawah pendapatan,
dan menghapus risiko kehabisan kuota yang jauh lebih merusak daripada biaya
tambahan.

## Fixed cost / bulan

| Komponen | Rp |
|---|---|
| Wablas 10.000 pesan | 47.000–62.000 |
| DomaiNesia Cloud VPS Lite 1GB | 48.000 |
| Domain (amortisasi 1 thn) | 8.333–16.667 |
| Supabase Free | 0 |
| **Total** | **103.333–126.667** |

Catatan VPS:Rp43.200/bulan itu harga **promo tahun pertama** (kode
`CLOUDVPSHEMAT`, hanya untuk siklus 1 tahun). Angka yang dipakai untuk
perencanaan adalah **Rp48.000/bulan** — harga perpanjangan resmi. Masih di
batas anggaran Rp50.000/bulan.

Alternatif kalau RAM 1 GB terasa sempit: Cloud VPS Lite 2GB Rp100.000/bulan
(renewal), atau AWS Lightsail Jakarta ~$5. 1 GB cukup selama `next build`
berjalan di GitHub Actions, bukan di VPS — lihat bagian deploy di `SOP.md`.

## Variable cost / bulan

### Gemini

Token per parse teks (prompt sistem + kategori + pesan user ≈ 1.200 input;
JSON output + thinking ≈ 300 output):

| Model | Input/1M | Output/1M | Biaya/parse |
|---|---|---|---|
| `gemini-3.6-flash` (dipakai) | $0.75 | $3.75 | ≈ $0.0020 |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | ≈ $0.0011 |

Faktor penting: `gemini-3.6-flash` **murah sampai 31 Des 2026**, lalu
mengalami kenaikan 2x menjadi $1.50/$7.50 mulai 1 Jan 2027.

```
10.200 parse × $0.0020 = $20,4/bulan ≈ Rp326.400/bulan
```

 Itu **Rp4.200 per parse**, bukan Rp900 seperti estimasi awal. Kenaikan inilah
 sebabnya flash-lite sempat dipertimbangkan, tapi selisihnya hanya ~$9/bulan
 (≈Rp144.000) — terlalu kecil untuk memblokir misklasifikasi kategori yang salah
 dan membakar budget user (lihat `scripts/verify/ai-flakiness.mts`).

Dengan parsial: 1.000 pesan voice + foto struk (PRO saja) cukup mahal karena
input multimodal — anggap 8x biaya parse teks (≈Rp33.400). Tambahkan
**≈Rp360.000** untuk total Gemini.

### QRIS settlement

Fee Rp2.000–3.000 per hari **jika** transaksi merchant memenuhi syarat dan
settlement harian. Jika ya:

```
2.500 × 30 = Rp75.000/bulan
```

⚠️ Belum dikonfirmasi ke InterActive. Kalau ternyata tidak berlaku, hemat
Rp75.000 — tapi jangan dihitung sebagai saving sebelum ada konfirmasi tertulis.

## Ringkasan

| Baris | Rp/bulan |
|---|---|
| Pendapatan (85 × 19.000) | **1.615.000** |
| Fixed | −166.333 |
| Gemini | −360.000 |
| QRIS settlement (asumsi) | −75.000 |
| **Sisa** | **≈1.013.667** |

Titik impas: **9–10 pengguna PRO** (pendapatan 9 × 19.000 = 171.000 >
fixed 166.333).

### Sisi revenue jitter
85 PRO dari 935 pengguna = **conversion 9,1%**. Ini asumsi, bukan hasil.
Kalau conversion separuh (4,6%), jumlah FREE untuk 85 PRO jadi 1.850 dan total
pesan **melebihi 10.000** — artinya perlu Unlimited **jauh sebelum** 85 PRO.
Jadi keputusan unlimited/normal sebaiknya diambil dari rasio FREE:PRO aktual,
bukan dari jumlah PRO saja.

## Kalau naik ke 300 PRO (batas praktis RAM 1 GB)

- Pendapatan: 5.700.000
- Gemini: ~1.270.000
- Fixed + settlement: ~193.000 (dengan Unlimited ~208.000)
- Sisa: **≈4.240.000**
- Batasnya: proses PM2 `instances: 1` (antrean & replyBudget in-memory) dan
  1 GiB RAM.

## Sumber harga

- Wablas 10.000 pesan Rp47.000–62.000; Unlimited Rp76.000–107.000 — https://wablas.com/pricing (harga & kuota **wajib diverifikasi** saat signup).
- DomaiNesia Cloud VPS Lite 1GB: Rp43.200/bulan promo tahun pertama (kode `CLOUDVPSHEMAT`), renewal **Rp48.000/bulan** — https://www.domainesia.com/cloud-vps-lite/. Spek: 1 vCPU / 1 GiB / 20 GiB NVMe / unlimited bandwidth / dedicated IP.
- Gemini Developer API pricing — https://ai.google.dev/gemini-api/docs/pricing
- Domain `.id` Rp100.000/tahun (promo); `.com` berpengaruh.
