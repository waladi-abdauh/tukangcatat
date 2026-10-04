-- Migration: wa_outbound_usage + gateway_health — pengaman nomor bot dari blokir.
--
-- KAPAN JALANKAN: sekali di Supabase SQL Editor (install baru sudah ikut di
-- ddl.sql). Idempotent — aman diulang.
--
-- Kenapa perlu: satu nomor WhatsApp bot yang kena blok = SELURUH produk mati,
-- karena bot tidak bisa membalas dan user tidak bisa nyatet. Pengaman lain
-- (pacing 1 detik, kuota per user) hanya terlihat oleh orang yang membaca
-- kode; tabel ini membuat keputusan itu bisa dilihat ops kapan saja lewat SQL.
--
-- 1) wa_outbound_usage — penghitung volume pesan KELUAR dari nomor bot.
--    Dual: cap harian (hour_slot = -1) dan cap per jam (hour_slot 0..23).
--    Dihitung per device, bukan per-user: 1.000 user gratis x 5 catatan =
--    5.000 pesan/hari dari satu nomor, dan tanpa tabel ini tidak ada yang
--    menyadari itu lewat.
--
-- 2) gateway_health — status device + kill switch. Kalau gateway melaporkan
--    nomor terblokir atau disconnect, semua pengiriman dihentikan lewat baris
--    status='blocked', bukan diteruskan sampai ada yang membaca log.

-- ===== 1. Volume pesan keluar =====

CREATE TABLE IF NOT EXISTS wa_outbound_usage (
  used_date DATE NOT NULL,
  -- -1 = baris total harian; 0..23 = baris per jam (WIB).
  hour_slot SMALLINT NOT NULL,
  send_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (used_date, hour_slot)
);

-- Pembersihan oleh cron: cukup 3 hari, sama seperti wa_inbound_seen.
CREATE INDEX IF NOT EXISTS idx_wa_outbound_usage_date
  ON wa_outbound_usage(used_date);

ALTER TABLE wa_outbound_usage ENABLE ROW LEVEL SECURITY;

GRANT ALL ON wa_outbound_usage TO service_role;

-- Klaim satu jatah kirim secara atomik (race-safe).
--
-- Mengembalikan TRUE hanya bila batas harian DAN per jam belum kena, dan hanya
-- dalam kasus itu counter naik. Kalau salah satu batas sudah habis, TIDAK ADA
-- counter yang naik, jadi cap tidak bisa digoreng oleh pesan yang ditolak.
--
-- Baris harian dikunci FOR UPDATE sehingga semua kiriman pada tanggal yang sama
-- mengantre di satu baris. Throughput hanya ratusan per hari, jadi ini aman dan
-- jauh lebih sederhana disbanding counter atomik terpisah per jam.
CREATE OR REPLACE FUNCTION claim_wa_outbound(
  p_date DATE,
  p_hour SMALLINT,
  p_daily_limit INTEGER,
  p_hourly_limit INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  daily_count INTEGER;
  hourly_count INTEGER;
BEGIN
  -- Pastikan baris harian ada, lalu kunci (serialize per tanggal).
  INSERT INTO wa_outbound_usage (used_date, hour_slot, send_count)
  VALUES (p_date, -1, 0)
  ON CONFLICT (used_date, hour_slot) DO NOTHING;

  SELECT send_count INTO daily_count
  FROM wa_outbound_usage
  WHERE used_date = p_date AND hour_slot = -1
  FOR UPDATE;

  IF daily_count >= p_daily_limit THEN
    RETURN FALSE;
  END IF;

  INSERT INTO wa_outbound_usage (used_date, hour_slot, send_count)
  VALUES (p_date, p_hour, 0)
  ON CONFLICT (used_date, hour_slot) DO NOTHING;

  SELECT send_count INTO hourly_count
  FROM wa_outbound_usage
  WHERE used_date = p_date AND hour_slot = p_hour
  FOR UPDATE;

  IF hourly_count >= p_hourly_limit THEN
    RETURN FALSE;
  END IF;

  UPDATE wa_outbound_usage
  SET send_count = send_count + 1, updated_at = NOW()
  WHERE used_date = p_date AND hour_slot IN (-1, p_hour);

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_wa_outbound(DATE, SMALLINT, INTEGER, INTEGER) TO service_role;

-- ===== 2. Status device + kill switch =====

CREATE TABLE IF NOT EXISTS gateway_health (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- ok | blocked
  status TEXT NOT NULL DEFAULT 'ok',
  -- Alasan singkat hasil klasifikasi error gateway, untuk dibaca di log.
  detail TEXT,
  blocked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO gateway_health (id, status)
VALUES (1, 'ok')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE gateway_health ENABLE ROW LEVEL SECURITY;

GRANT ALL ON gateway_health TO service_role;

-- Baca status kill switch satu round-trip. Sengaja tidak dibuka lewat policy
-- RLS: hanya service_role, supaya browser tidak bisa mengaktifkan maupun
-- mematikan switch ini.
CREATE OR REPLACE FUNCTION get_gateway_status()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT status FROM gateway_health WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION get_gateway_status() TO service_role;

-- Tandai nomor bermasalah sehingga semua pengiriman dihentikan.
--
-- Auto-recover TIDAK dilakukan di sini: logika pemulihannya butuh jam waktu
-- per proses (lihat lib/wa/policy.ts) supaya bisa memperhitungkan warm-up
-- ulang setelah device reconnect. Fungsi ini murni mencatat kejadian.
CREATE OR REPLACE FUNCTION mark_gateway_blocked(p_detail TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE gateway_health
  SET status = 'blocked',
      detail = p_detail,
      blocked_at = NOW(),
      updated_at = NOW()
  WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION mark_gateway_blocked(TEXT) TO service_role;

-- Pulihkan manual (dipakai cron pemeriksa health atau setelah operator
-- confirms perangkat sudah reconnect).
CREATE OR REPLACE FUNCTION clear_gateway_blocked()
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE gateway_health
  SET status = 'ok',
      detail = NULL,
      blocked_at = NULL,
      updated_at = NOW()
  WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION clear_gateway_blocked() TO service_role;