-- ============================================================
-- CEPATCATAT - DDL SETUP (jalankan SEKALI di Supabase SQL Editor)
-- Jalankan via: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES (termasuk schema referral)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number TEXT UNIQUE NOT NULL,
  full_name TEXT,
  is_pro BOOLEAN DEFAULT FALSE,
  pro_until TIMESTAMPTZ,
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  credit_balance NUMERIC DEFAULT 0,
  -- Pengingat nyatet harian (web push): jam 'HH:MM' WIB, NULL = nonaktif.
  reminder_time TEXT,
  -- Tanggal terakhir pengingat terkirim (anti kirim dobel per hari).
  reminder_last_sent DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1b. BUDGET BULANAN PER PERIODE ('YYYY-MM').
-- Bulan tanpa baris mewarisi nilai terbaru sebelumnya (carryover), jadi
-- bulan lalu membeku dengan setting zamannya & bulan baru otomatis lanjut.
CREATE TABLE IF NOT EXISTS monthly_budgets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month)
);

-- 2. CATEGORY BUDGETS (limit per kategori per user PER BULAN)
CREATE TABLE IF NOT EXISTS category_budgets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  limit_amount NUMERIC NOT NULL DEFAULT 500000,
  month TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category_name, month)
);

-- 2b. PUSH SUBSCRIPTIONS (langganan notifikasi pengingat per browser/PWA)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2c. SENT ALERTS (dedupe notifikasi per hari, mis. alert bocor kategori
-- maksimal 1x per kategori per hari meski transaksi beruluan)
CREATE TABLE IF NOT EXISTS sent_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  sent_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, kind, key, sent_date)
);

-- 2d. WA INBOUND SEEN (dedupe retry webhook per pesan; mencegah 1 chat di-parse
-- AI berulang & transaksi tercatat berkali-kali saat gateway me-retry)
CREATE TABLE IF NOT EXISTS wa_inbound_seen (
  message_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2e. AI USAGE DAILY (kuota pemanggilan Gemini per user per hari; beda dari
-- jumlah catatan karena pesan non-transaksi juga memakai kuota AI)
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  used_date DATE NOT NULL,
  parse_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, used_date)
);

-- 2f. WA OUTBOUND USAGE (volume pesan KELUAR dari nomor bot).
-- Cap harian (hour_slot = -1) dan cap per jam (hour_slot 0..23), dihitung per
-- device — bukan per user. Tanpa ini, 1.000 user x 5 catatan = 5.000 pesan/hari
-- dari satu nomor tanpa ada yang menyadari.
CREATE TABLE IF NOT EXISTS wa_outbound_usage (
  used_date DATE NOT NULL,
  hour_slot SMALLINT NOT NULL,
  send_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (used_date, hour_slot)
);

-- 2g. GATEWAY HEALTH (status device + kill switch anti-blokir).
-- Status 'blocked' menghentikan seluruh outbound sampai operator atau
-- auto-recover mengosongkan switch. Lihat lib/wa/policy.ts.
CREATE TABLE IF NOT EXISTS gateway_health (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'ok',
  detail TEXT,
  blocked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO gateway_health (id, status) VALUES (1, 'ok')
ON CONFLICT (id) DO NOTHING;

-- 3. TRANSACTIONS
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL DEFAULT 'Lainnya',
  item_name TEXT NOT NULL,
  input_type TEXT NOT NULL CHECK (input_type IN ('text','voice','ocr','manual')),
  transaction_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PAYMENTS / LOG
CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  order_id TEXT UNIQUE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 19000,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','success','failed','expired')),
  snap_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. REFERRALS
CREATE TABLE IF NOT EXISTS referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  referee_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  status TEXT DEFAULT 'registered' CHECK (status IN ('registered','rewarded')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referee_id)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_monthly_budgets_user ON monthly_budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_category_budgets_user ON category_budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_category_budgets_user_month ON category_budgets(user_id, month);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_sent_alerts_user ON sent_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_seen_created ON wa_inbound_seen(created_at);
CREATE INDEX IF NOT EXISTS idx_wa_outbound_usage_date ON wa_outbound_usage(used_date);

-- RLS
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sent_alerts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_inbound_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;
-- Tanpa policy SELECT: hanya service_role yang boleh. Kalau tabel ini terbuka ke
-- anon/authenticated, browser bisa mematikan kill switch anti-blokir.
ALTER TABLE wa_outbound_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateway_health   ENABLE ROW LEVEL SECURITY;

-- GRANTS PostgREST (service_role = full, anon/authenticated = cukup baca own rows)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT ON profiles, monthly_budgets, category_budgets, transactions, payments, referrals, push_subscriptions, sent_alerts TO anon, authenticated;

-- SEED DEFAULT CATEGORIES (bulan berjalan WIB; bulan berikutnya mewarisi)
CREATE OR REPLACE FUNCTION seed_default_categories(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO category_budgets (user_id, category_name, limit_amount, month) VALUES
    (target_user_id, 'Dapur', 1200000, to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')),
    (target_user_id, 'Makan', 600000, to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')),
    (target_user_id, 'Transport', 600000, to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')),
    (target_user_id, 'Leisure', 600000, to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')),
    (target_user_id, 'Tagihan', 600000, to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM'))
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- KLAIM AI PARSE (kuota Gemini per user per hari).
-- TRUE hanya bila masih di bawah limit, dan counter hanya naik saat klaim
-- berhasil — jadi setelah limit habis counter berhenti (tidak tumbuh tak
-- terbatas) dan overweight tidak menambah usage.
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

GRANT EXECUTE ON FUNCTION claim_ai_parse(UUID, DATE, INTEGER) TO service_role;

-- KLAIM OUTBOUND (volume pesan keluar per nomor bot per hari & per jam).
-- TRUE hanya bila kedua batas belum kena; counter hanya naik saat klaim berhasil.
-- Baris harian dikunci FOR UPDATE sehingga semua kiriman per tanggal mengantre di
-- satu baris (throughput hanya ratusan/hari, jadi ini aman dan sederhana).
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

-- Baca kill switch satu round-trip. Tanpa policy RLS: hanya service_role, supaya
-- browser tidak bisa mengaktifkan maupun mematikan switch ini.
CREATE OR REPLACE FUNCTION get_gateway_status()
RETURNS TEXT LANGUAGE sql STABLE
AS $$ SELECT status FROM gateway_health WHERE id = 1; $$;

GRANT EXECUTE ON FUNCTION get_gateway_status() TO service_role;

-- Tandai nomor bermasalah sehingga semua outbound berhenti. Auto-recover
-- dilakukan di aplikasi (lib/wa/policy.ts) supaya bisa memperhitungkan warm-up
-- ulang setelah device reconnect; fungsi ini murni mencatat kejadian.
CREATE OR REPLACE FUNCTION mark_gateway_blocked(p_detail TEXT)
RETURNS VOID LANGUAGE sql
AS $$
  UPDATE gateway_health
  SET status = 'blocked', detail = p_detail,
      blocked_at = NOW(), updated_at = NOW()
  WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION mark_gateway_blocked(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION clear_gateway_blocked()
RETURNS VOID LANGUAGE sql
AS $$
  UPDATE gateway_health
  SET status = 'ok', detail = NULL, blocked_at = NULL, updated_at = NOW()
  WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION clear_gateway_blocked() TO service_role;

-- AUTO REFERRAL CODE (CCAT-XXXXXX) saat profile baru dibuat
CREATE OR REPLACE FUNCTION assign_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := 'CCAT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_referral_code ON profiles;
CREATE TRIGGER trg_assign_referral_code
BEFORE INSERT ON profiles
FOR EACH ROW EXECUTE FUNCTION assign_referral_code();

-- AUTO UPDATED_AT
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- POLICIES (defense-in-depth; akses normal dashboard via service role + token)
CREATE POLICY "select own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "select own monthly budgets" ON monthly_budgets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "select own budgets" ON category_budgets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "select own transactions" ON transactions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "select own payments" ON payments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "select own referrals" ON referrals
  FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referee_id);
CREATE POLICY "select own push subs" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "select own sent alerts" ON sent_alerts
  FOR SELECT USING (auth.uid() = user_id);