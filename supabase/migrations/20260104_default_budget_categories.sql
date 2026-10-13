-- Migration: default budget & kategori baru (7 kategori, budget 3,5jt).
--
-- KAPAN JALANKAN: sekali di Supabase SQL Editor. Idempotent — aman diulang.
--
-- LATAR: seed lama menanam 5 kategori dengan total plafon 3.600.000 padahal
-- fallback budget bulanan DEFAULT_MONTHLY_BUDGET cuma 3.000.000, sehingga user
-- baru langsung melihat "Cadangan" merah. Migrasi ini:
--   1) mengganti fungsi seed_default_categories ke versi baru (7 kategori,
--      total plafon 3.150.000, plus menanam baris monthly_budgets 3.500.000);
--   2) memperbaiki user lama HANYA bila limit bulan berjalan mereka masih
--      PERSIS set seed lama (belum diubah sama sekali). User yang sudah
--      menyesuaikan kategori/budget tidak disentuh.
--
-- CATATAN: dev & prod memakai database yang SAMA, jadi migrasi ini langsung
-- berlaku di produksi. Guard "persis set lama" membatasi dampaknya.

-- =====================================================================
-- 1) Fungsi seed versi baru (juga dipakai ddl.sql untuk install baru)
-- =====================================================================
CREATE OR REPLACE FUNCTION seed_default_categories(target_user_id UUID)
RETURNS VOID AS $$
DECLARE
  cur_month TEXT := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
BEGIN
  INSERT INTO category_budgets (user_id, category_name, limit_amount, month) VALUES
    (target_user_id, 'Dapur', 1150000, cur_month),
    (target_user_id, 'Belanja', 450000, cur_month),
    (target_user_id, 'Tagihan', 450000, cur_month),
    (target_user_id, 'Makan', 400000, cur_month),
    (target_user_id, 'Transport', 400000, cur_month),
    (target_user_id, 'Kesehatan', 150000, cur_month),
    (target_user_id, 'Hiburan', 150000, cur_month)
  ON CONFLICT DO NOTHING;

  INSERT INTO monthly_budgets (user_id, month, amount) VALUES
    (target_user_id, cur_month, 3500000)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 2) Backfill user lama yang limitnya persis set seed lama
-- =====================================================================
DO $$
DECLARE
  cur_month TEXT := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
BEGIN
  CREATE TEMP TABLE _seed_fix_users AS
  SELECT user_id
  FROM category_budgets
  WHERE month = cur_month
  GROUP BY user_id
  HAVING count(*) = 5
     AND count(*) FILTER (WHERE category_name = 'Dapur' AND limit_amount = 1200000) = 1
     AND count(*) FILTER (WHERE category_name = 'Makan' AND limit_amount = 600000) = 1
     AND count(*) FILTER (WHERE category_name = 'Transport' AND limit_amount = 600000) = 1
     AND count(*) FILTER (WHERE category_name = 'Leisure' AND limit_amount = 600000) = 1
     AND count(*) FILTER (WHERE category_name = 'Tagihan' AND limit_amount = 600000) = 1;

  DELETE FROM category_budgets cb
  USING _seed_fix_users u
  WHERE cb.user_id = u.user_id AND cb.month = cur_month;

  INSERT INTO category_budgets (user_id, category_name, limit_amount, month)
  SELECT u.user_id, v.category_name, v.limit_amount, cur_month
  FROM _seed_fix_users u
  CROSS JOIN (VALUES
    ('Dapur', 1150000),
    ('Belanja', 450000),
    ('Tagihan', 450000),
    ('Makan', 400000),
    ('Transport', 400000),
    ('Kesehatan', 150000),
    ('Hiburan', 150000)
  ) AS v(category_name, limit_amount)
  ON CONFLICT DO NOTHING;

  -- Hormati budget eksplisit user yang sudah ada (jangan ditimpa).
  INSERT INTO monthly_budgets (user_id, month, amount)
  SELECT u.user_id, cur_month, 3500000
  FROM _seed_fix_users u
  ON CONFLICT (user_id, month) DO NOTHING;

  DROP TABLE _seed_fix_users;
END $$;
