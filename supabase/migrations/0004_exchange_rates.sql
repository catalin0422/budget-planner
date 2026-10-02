-- Cursul oficial BNR EUR/RON si MDL/RON, cate un rand pe zi bancara. Date
-- publice, comune tuturor utilizatorilor (fara user_id). Se completeaza automat
-- din lib/bnr.ts.
--
-- Migratia e doar aditiva: codul vechi nu atinge tabelul, deci poate rula
-- inainte de deploy.
CREATE TABLE IF NOT EXISTS exchange_rates (
  date        text PRIMARY KEY,           -- YYYY-MM-DD, ziua pentru care BNR a publicat cursul
  eur_ron     double precision NOT NULL,
  mdl_ron     double precision NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON exchange_rates FROM %I', r);
    END IF;
  END LOOP;
END
$$;
