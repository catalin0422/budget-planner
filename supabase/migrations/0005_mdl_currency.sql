-- Adauga leul moldovenesc (MDL) ca valuta pentru conturi, recurente si
-- planificari. Conversia in RON se face cu cursul BNR din exchange_rates
-- (vezi 0004 si lib/bnr.ts).
--
-- Migratia doar relaxeaza constrangerile: codul vechi nu scrie niciodata MDL,
-- deci poate rula inainte de deploy.
ALTER TABLE accounts  DROP CONSTRAINT IF EXISTS accounts_currency_check;
ALTER TABLE accounts  ADD CONSTRAINT accounts_currency_check
  CHECK (currency IN ('RON', 'EUR', 'MDL'));

ALTER TABLE recurring DROP CONSTRAINT IF EXISTS recurring_currency_check;
ALTER TABLE recurring ADD CONSTRAINT recurring_currency_check
  CHECK (currency IN ('RON', 'EUR', 'MDL'));

ALTER TABLE planned   DROP CONSTRAINT IF EXISTS planned_currency_check;
ALTER TABLE planned   ADD CONSTRAINT planned_currency_check
  CHECK (currency IN ('RON', 'EUR', 'MDL'));
