-- Migration: wa_inbound_seen + ai_usage_daily — dedupe inbound & penghitung
-- biaya AI.
--
-- KAPAN JALANKAN: sekali di Supabase SQL Editor (project yang sudah jalan perlu
-- migration ini; install baru sudah ikut di ddl.sql). Idempotent — aman diulang.
--
-- 1) wa_inbound_seen — retensi pesan WA per gateway.
--    Fonnte me-retries webhook yang lambat (15x/menit) dan Wablas punya retry
--    serupa. Tanpa tabel ini satu chat bisa diparse AI berulang kali DAN
--    transaksi tercatat berkali-kali. Baris diklaim sebelum proses jalan
--    (claim-then-process) lewat PRIMARY KEY message_id.
--
-- 2) ai_usage_daily — kuota pemanggilan Gemini per user per hari.
--    Batas "jumlah catatan" tidak cukup: pesan salam/gibberish/struk tak
--    terbaca tetap memanggil Gemini tanpa menghasilkan transaksi.

-- ===== 1. Dedupe inbound =====

CREATE TABLE IF NOT EXISTS wa_inbound_seen (
  message_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pembersihan oleh cron: baris cukup disimpan 3 hari (retry selalu < 1 jam).
CREATE INDEX IF NOT EXISTS idx_wa_inbound_seen_created
  ON wa_inbound_seen(created_at);

-- RLS diaktifkan tanpa policy: tabel hanya diakses lewat service_role
-- (tidak ada Select langsung dari browser, jadi policy SELECT tidak perlu).
ALTER TABLE wa_inbound_seen ENABLE ROW LEVEL SECURITY;

GRANT ALL ON wa_inbound_seen TO service_role;

-- ===== 2. Kuota parse AI =====

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  used_date DATE NOT NULL,
  parse_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, used_date)
);

ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;

GRANT ALL ON ai_usage_daily TO service_role;

-- Klaim atomik 1 jatah parse. Mengembalikan TRUE hanya bila masih di bawah
-- limit, dan hanya dalam kasus itu counter naik — jadi setelah limit habis
-- counter berhenti (tidak tumbuh tanpa batas) dan overweight tidak dihitung.
--
-- ON CONFLICT DO UPDATE dengan WHERE: kalau kondisi WHERE tidak terpenuhi,
-- baris TIDAK di-update dan tidak ada baris yang dikembalikan ke RETURNING,
-- sehingga FOUND = false.
CREATE OR REPLACE FUNCTION claim_ai_parse(
  p_user UUID,
  p_date DATE,
  p_limit INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  next_count INTEGER;
BEGIN
  INSERT INTO ai_usage_daily (user_id, used_date, parse_count)
  VALUES (p_user, p_date, 1)
  ON CONFLICT (user_id, used_date) DO UPDATE
    SET parse_count = ai_usage_daily.parse_count + 1
    WHERE ai_usage_daily.parse_count < p_limit
  RETURNING parse_count INTO next_count;

  RETURN FOUND;
END;
$$;

-- Izinkan service_role memanggil fungsi ini.
GRANT EXECUTE ON FUNCTION claim_ai_parse(UUID, DATE, INTEGER) TO service_role;