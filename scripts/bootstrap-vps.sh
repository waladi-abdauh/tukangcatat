#!/usr/bin/env bash
#
# Bootstrap VPS produksi CepatCatat.
#
# Jalankan SEKALI, sebagai root, di VPS yang masih kosong:
#
#   ssh root@202.155.95.43
#   curl -fsSL https://raw.githubusercontent.com/waladi-abdauh/tukangcatat/master/scripts/bootstrap-vps.sh | bash
#
# Aman dijalankan ulang: setiap langkah mengecek kondisinya dulu sebelum
# mengubah apa pun.
#
# ============ Yang TIDAK dikerjakan di sini ============
#
# Script ini sengaja tidak menyentuh file .env, sertifikat TLS, atau GitHub
# secret. Tiga hal itu butuh keputusan/nilai yang hanya kamu yang punya, dan
# tidak bisa di-curl dari URL publik tanpa membocorkan sesuatu. Setelah script
# ini selesai, langkah manual yang tersisa ada di bagian MANUAL di bawah.
#
# ============ Kenapa build tidak jalan di server ============
#
# next.config.ts memakai output: "standalone", jadi .next/standalone/ sudah
# berisi server.js plus hanya node_modules yang benar-benar dipakai route kita.
# Build dilakukan di GitHub Actions dan hasilnya di-rsync ke sini. Server ini
# tidak pernah menjalankan npm ci maupun next build, dan tidak punya toolchain
# dev -- itulah yang membuat RAM 1 GB cukup.
set -euo pipefail

DEPLOY_USER="deploy"
APP_ROOT="/opt/cepatcatat"
SHARED_DIR="${APP_ROOT}/shared"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
LOG_DIR="/var/log/caddy"
NODE_MAJOR="24"
SWAP_SIZE_GB="2"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mPERHATIAN: %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Jalankan sebagai root: ssh root@<ip> lalu ulangi perintah ini."

log "Cek sistem"
. /etc/os-release
echo "OS      : ${PRETTY_NAME:-tidak diketahui}"
echo "Kernel  : $(uname -r)"
echo "RAM     : $(free -h | awk '/^Mem:/ {print $2}')"
echo "Disk    : $(df -h / | awk 'NR==2 {print $4}') bebas dari $(df -h / | awk 'NR==2 {print $2}')"

# Node 24 butuh glibc >= 2.28. Alpine (musl) tidak bisa, makanya image Alpine
# tidak dipakai untuk VPS ini.
case "${ID:-}" in
  debian|ubuntu) ;;
  *) warn "Script ini diuji untuk Debian/Ubuntu. OS '${ID:-tidak dikenal}' mungkin perlu penyesuaian." ;;
esac

# =====================================================================
# 1. Kosongkan port 3000
# =====================================================================
# Image VPS "nodejs" dari provider biasanya menjalankan aplikasi demo di
# port 3000. Kalau proses itu masih hidup saat PM2 start, Node akan gagal
# bind dengan EADDRINUSE dan PM2 akan masuk restart loop. Gejalanya baru
# terlihat jelas di log PM2, tapi lebih baik dicegah dari awal.
log "Mengosongkan port 3000 (image demo provider)"

demo_pids="$(ss -lptnH 'sport = :3000' 2>/dev/null | grep -oP 'pid=\K[0-9]+' || true)"
if [ -n "$demo_pids" ]; then
  echo "Ditemukan proses di port 3000: $demo_pids"
  for pid in $demo_pids; do
    echo "  kill $pid"
    kill "$pid" 2>/dev/null || true
  done
  sleep 2
  # Masih hidup? Paksa.
  for pid in $demo_pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "  masih hidup, kirim SIGKILL ke $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
else
  echo "Port 3000 sudah kosong."
fi

# Matikan service demo yang biasa jalan di image provider, kalau ada. Sengaja
# pakai loop + unit yang ada, supaya `systemctl disable` tidak gagal saat
# unit-nya memang tidak terpasang.
for unit in nodejs-app quickstart-app express-app; do
  if systemctl list-unit-files --no-legend 2>/dev/null | grep -q "^${unit}\.service"; then
    echo "Menonaktifkan ${unit}.service"
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
  fi
done

# =====================================================================
# 2. Swap 2 GB
# =====================================================================
# RAM 1 GB dengan heap Node 640 MB + PM2 + Caddy + OS sudah ~= 850 MB.
# Tanpa swap, satu lonjakan singkat (mis. `npm ci` saat setup, atau GC yang
# lambat) akan memicu OOM killer yang membunuh proses Next di tengah request.
# Swap jadi jaring pengaman, bukan pengganti RAM.
#
# swappiness=10 supaya Linux TIDAK memakai swap untuk halaman cache normal --
# kalau terlalu rakus, latensi naik terus-menerus karena halaman yang
# sebenarnya masih ada di RAM terus dipaginasikan ke disk.
log "Menyiapkan swap ${SWAP_SIZE_GB} GB"

if swapon --show=NAME --noheadings | grep -q .; then
  echo "Swap sudah aktif, dilewati."
else
  if [ ! -f /swapfile ]; then
    fallocate -l "${SWAP_SIZE_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_SIZE_GB * 1024))
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  # Supaya swap ikut hidup setelah reboot.
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Swap aktif."
fi

if ! grep -q '^vm.swappiness=' /etc/sysctl.conf 2>/dev/null; then
  printf 'vm.swappiness=10\n' >> /etc/sysctl.conf
fi
sysctl -p /etc/sysctl.conf >/dev/null 2>&1 || true
echo "vm.swappiness = $(sysctl -n vm.swappiness)"

# =====================================================================
# 3. Paket dasar
# =====================================================================
log "Memasang paket dasar"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  curl ca-certificates gnupg rsync ufw sudo logrotate >/dev/null

# =====================================================================
# 4. Node.js 24 dari NodeSource
# =====================================================================
# Node 24 (LTS) wajib karena package.json mengunci engines ke ">=24 <25".
# Node bawaan image provider sering versi lama; distro repo Ubuntu juga
# biasanya tertinggal, jadi kita pakai repo NodeSource.
log "Memasang Node.js ${NODE_MAJOR} dari NodeSource"

if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/^v//; s/\..*//')" = "${NODE_MAJOR}" ]; then
  echo "Node $(node -v) sudah sesuai, dilewati."
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  echo "Node terpasang: $(node -v), npm $(npm -v)"
fi

# =====================================================================
# 5. User deploy
# =====================================================================
# Workflow GitHub Actions login sebagai user ini, bukan root. Semua yang
# dilakukan workflow (mkdir, rsync, ln, pm2, rm) cukup write access ke
# APP_ROOT yang DIMILIKI user ini -- jadi tidak ada sudo sama sekali di
# jalur deploy. Root hanya dipakai di sini, sekali ini.
log "Menyiapkan user ${DEPLOY_USER}"

if id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  echo "User ${DEPLOY_USER} sudah ada, dilewati."
else
  # -m "" supaya tidak ada home directory yang bisa dieksplorasi via login
  # interaktif, tapi tetap ada (/home/deploy) karena ecosystem.config.js
  # menulis log ke /home/deploy/.pm2/logs/.
  useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
  echo "User ${DEPLOY_USER} dibuat."
fi

install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 755 "${APP_ROOT}" "${RELEASES_DIR}"
# shared/ hanya boleh dibaca owner: isinya .env berisi seluruh secret produksi.
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 700 "${SHARED_DIR}"
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 755 "/home/${DEPLOY_USER}/.pm2/logs"

# =====================================================================
# 6. PM2 + modul rotasi log
# =====================================================================
log "Memasang PM2 dan pm2-logrotate"

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 >/dev/null
  echo "PM2 terpasang: $(pm2 -v)"
else
  echo "PM2 sudah ada: $(pm2 -v)"
fi

# Modul ini harus terpasang di PM2 milik user deploy, bukan root -- PM2
# menyimpan modul per-user. Dipasang lewat `sudo -u` supaya daftar modulnya
# ikut tersimpan dan otomatis termuat saat PM2 start.
sudo -u "${DEPLOY_USER}" -H pm2 install pm2-logrotate >/dev/null 2>&1 || \
  warn "pm2-logrotate gagal dipasang; pasang manual dengan: sudo -u ${DEPLOY_USER} pm2 install pm2-logrotate"

sudo -u "${DEPLOY_USER}" -H pm2 set pm2-logrotate:max_size 10M >/dev/null 2>&1 || true
sudo -u "${DEPLOY_USER}" -H pm2 set pm2-logrotate:retain 3 >/dev/null 2>&1 || true
sudo -u "${DEPLOY_USER}" -H pm2 set pm2-logrotate:compress true >/dev/null 2>&1 || true
echo "Batas log: 10 MB per berkas, 3 berkas lamanya disimpan."

# =====================================================================
# 7. Firewall
# =====================================================================
# ufw DENY by default, hanya SSH/HTTP/HTTPS yang boleh masuk. Port 3000 TIDAK
# dibuka: PM2 bind ke 127.0.0.1, jadi hanya Caddy yang boleh menyentuh app.
log "Mengatur firewall"
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow 22/tcp comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP (sertifikat TLS + redirect)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw --force enable >/dev/null
ufw status verbose || true

# =====================================================================
# 8. Caddy
# =====================================================================
log "Memasang Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" > /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null || true
  if apt-get update -qq 2>/dev/null && apt-get install -y -qq caddy >/dev/null 2>&1; then
    echo "Caddy terpasang: $(caddy version)"
  else
    warn "Caddy gagal dipasang dari repo resmi. Ambil dari https://caddyserver.com/docs/install"
  fi
fi

# Direktori log harus ada SEBELUM Caddy start, kalau tidak Caddy gagal start
# dengan error yang membingungkan ("failed to open log file").
install -d -m 755 "${LOG_DIR}"

if [ -f /etc/caddy/Caddyfile ]; then
  echo "Caddyfile sudah ada di server; tidak ditimpa."
else
  echo "Caddyfile belum ada di server."
fi

# =====================================================================
# 9. Ringkasan + langkah manual
# =====================================================================
log "Selesai. Status akhir:"
printf '  Node      : %s\n' "$(node -v 2>/dev/null || echo belum)"
printf '  PM2       : %s\n' "$(pm2 -v 2>/dev/null || echo belum)"
printf '  Caddy     : %s\n' "$(caddy version 2>/dev/null | head -n1 || echo belum)"
printf '  Swap      : %s\n' "$(free -h | awk '/^Swap:/ {print $2}') total"
printf '  App root  : %s (pemilik: %s)\n' "${APP_ROOT}" "${DEPLOY_USER}"
printf '  current   : %s\n' "$(readlink -f "${CURRENT_LINK}" 2>/dev/null || echo 'belum ada (normal sebelum deploy pertama)')"

cat <<'MANUAL'

=================================================================
LANGKAH MANUAL YANG MASIH HARUS DIKERJAKAN
=================================================================

1. Pasang Caddyfile ke server

   Salin Caddyfile dari repo ke /etc/caddy/Caddyfile, lalu:

     caddy validate --config /etc/caddy/Caddyfile
     systemctl reload caddy

2. Isi secret runtime

     nano /opt/cepatcatat/shared/.env
     chown deploy:deploy /opt/cepatcatat/shared/.env
     chmod 600 /opt/cepatcatat/shared/.env

   Isinya: seluruh isi .env.local lokal KECUALI NEXT_PUBLIC_* (nilai itu
   di-inline saat build di GitHub, jadi yang ada di sini tidak berpengaruh).
   WA_WEBHOOK_SECRET_TOKEN WAJIB nilai baru: nilai yang lama sudah bocor.

3. Public key GitHub Actions

     sudo -u deploy mkdir -p /home/deploy/.ssh
     sudo chmod 700 /home/deploy/.ssh
     # tempel isi ~/.ssh/cepatcatat_deploy.pub ke sini:
     nano /home/deploy/.ssh/authorized_keys
     sudo chmod 600 /home/deploy/.ssh/authorized_keys
     sudo chown -R deploy:deploy /home/deploy/.ssh

4. Survive reboot

   Jalankan sebagai root, yang mencetak perintah sudo -u deploy:

     pm2 startup systemd -u deploy --hp /home/deploy

5. Matikan login password (SETELAH langkah 3 teruji)

     nano /etc/ssh/sshd_config     # set PasswordAuthentication no
     systemctl restart ssh

   Jangan lakukan sebelum kunci SSH berhasil login -- kalau tidak, VPS kamu
   terkunci dari luar.

6. Cron (setelah deploy pertama berhasil)

     crontab -u deploy -e

   Isi:
     */15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/gateway-health
     */15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/push-reminder
     30 3 * * * cd /opt/cepatcatat/current && node scripts/maintenance/cleanup.mts

   curl tidak punya akses ke CRON_SECRET dari crontab secara default --
   pakai wrapper script yang me-export env-nya, atau simpan di /etc/environment.

=================================================================
Domain harus SUDAH resolve ke IP VPS sebelum Caddy bisa ambil sertifikat.
Kalau DNS belum propagate, `caddy validate` tetap lulus tapi sertifikat baru
diterbitkan setelah DNS siap.
=================================================================
MANUAL
