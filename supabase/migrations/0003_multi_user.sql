-- Date separate per utilizator (Clerk userId), ca oricine sa-si poata face cont
-- fara sa vada datele altcuiva.
--
-- user_id e nullable DELIBERAT: randurile existente (ale tale) raman cu NULL pana
-- rulezi scripts/claim-legacy-data.mjs cu userId-ul tau Clerk. Aplicatia
-- filtreaza mereu cu `user_id = $1`, deci randurile cu NULL nu sunt vizibile
-- nimanui (esueaza inchis) pana nu sunt revendicate.

ALTER TABLE accounts  ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE recurring ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE planned   ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE goals     ADD COLUMN IF NOT EXISTS user_id text;

CREATE INDEX IF NOT EXISTS idx_accounts_user  ON accounts  (user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring (user_id);
CREATE INDEX IF NOT EXISTS idx_planned_user   ON planned   (user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user     ON goals     (user_id);

-- Un snapshot pe zi, dar acum per utilizator (inainte: UNIQUE global pe date).
ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS snapshots_user_date_key ON snapshots (user_id, date);

-- app_settings era un rand unic (id = 1). Acum e cate un rand per utilizator.
-- Dropul coloanei `id` scoate si PRIMARY KEY-ul si CHECK-ul (id = 1).
ALTER TABLE app_settings DROP COLUMN IF EXISTS id;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS user_id text;
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_user_key ON app_settings (user_id);
