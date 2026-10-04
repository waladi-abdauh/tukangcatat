-- Migration: sent_alerts — dedupe alert harian (anti pesan duplikat).
--
-- KAPAN JALANKAN: sekali di Supabase SQL Editor (sudah termasuk di ddl.sql untuk
-- install baru, tapi project yang sudah jalan perlu migration ini).
-- Idempotent — aman diulang.
--
-- Gunanya: alert bocor kategori dipindah ke Web Push (bukan WhatsApp) dengan
-- maksimal 1 push per kategori per hari. Baris dipakai sebagai "klaim" sebelum
-- push dikirim, jadi webhook paralel / transaksi berulang tidak menghasilkan
-- notifikasi kembar (claim-then-send race-safe lewat UNIQUE).

CREATE TABLE IF NOT EXISTS sent_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  sent_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, kind, key, sent_date)
);

CREATE INDEX IF NOT EXISTS idx_sent_alerts_user ON sent_alerts(user_id);

-- RLS: user hanya boleh baca barisnya sendiri (notifikasi masuk lewat service_role).
ALTER TABLE sent_alerts ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON sent_alerts TO service_role;
GRANT SELECT ON sent_alerts TO anon, authenticated;

DROP POLICY IF EXISTS "select own sent alerts" ON sent_alerts;
CREATE POLICY "select own sent alerts" ON sent_alerts
  FOR SELECT USING (auth.uid() = user_id);
