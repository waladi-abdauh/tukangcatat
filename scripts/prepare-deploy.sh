#!/usr/bin/env bash
#
# Menyusun paket deploy yang self-contained.
#
# `next build` dengan `output: "standalone"` (lihat next.config.ts) sudah
# menulis .next/standalone/ berisi server.js + salinan node_modules yang benar-
# benar dipakai route kita. Dua folder TIDAK ikut otomatis dan harus disalin
# manual. Kalau dilewatkan, gejalanya baru muncul saat production: server.js
# tetap jalan, tapi halaman dashboard gagal load asset.
#
#   - public/          -> icon, logo, sw.js (service worker)
#   - .next/static/    -> asset JS/CSS hasil build
#
# Hasilnya folder `release/` yang tinggal di-rsync ke VPS. Tidak ada `npm ci`
# di server dan tidak ada `next build` di server, jadi VPS 1 GB cukup.
#
# Jalankan: bash scripts/prepare-deploy.sh   (setelah `next build`)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE="$ROOT/.next/standalone"
OUT="$ROOT/release"

if [ ! -f "$STANDALONE/server.js" ]; then
  echo "ERROR: $STANDALONE/server.js tidak ada." >&2
  echo "       Jalankan 'next build' dulu, dan pastikan next.config.ts" >&2
  echo "       masih punya output: 'standalone'." >&2
  exit 1
fi

echo "==> Membersihkan $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

# -a dipakai agar symlink & timestamp ikut terjaga; standalone sudah punya
# struktur direktori sendiri sehingga cukup disalin apa adanya.
echo "==> Menyalin standalone runtime"
cp -a "$STANDALONE/." "$OUT/"

# Cache build Next tidak pernah dibutuhkan saat runtime dan bisa berukuran
# ratusan MB -- di VPS 1 GB itu boros sia-sia.
echo "==> Membuang cache build (tidak dipakai saat runtime)"
rm -rf "$OUT/.next/cache"

if [ -d "$ROOT/public" ]; then
  echo "==> Menyalin public/"
  cp -a "$ROOT/public" "$OUT/public"
else
  echo "==> Lewati public/ (tidak ada)"
fi

if [ -d "$ROOT/.next/static" ]; then
  echo "==> Menyalin .next/static/"
  mkdir -p "$OUT/.next"
  cp -a "$ROOT/.next/static" "$OUT/.next/static"
else
  echo "ERROR: .next/static tidak ada -- asset produksi akan hilang." >&2
  exit 1
fi

# Penanda release aktif di server. Berguna dua hal: smoke test bisa memastikan
# artifact yang jalan adalah SHA yang diharapkan, dan `ls -l current` langsung
# memberi tahu sedang circulasi commit mana.
SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
printf '%s\n' "$SHA" > "$OUT/.release-sha"

# Sanity check: tanpa dua folder di atas, halaman dashboard akan 404 padahal
# server.js-nya jalan -- gejalanya jauh lebih jauh dari "deploy gagal".
for wajib in server.js .next/static public; do
  if [ ! -e "$OUT/$wajib" ]; then
    echo "ERROR: paket release tidak lengkap: $OUT/$wajib hilang." >&2
    exit 1
  fi
done

echo "==> Rilis $SHA siap di release/ ($(du -sh "$OUT" | cut -f1))"
