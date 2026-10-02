/**
 * Atribuie datele existente (user_id NULL, create inainte de 0003_multi_user.sql)
 * unui utilizator Clerk.
 *
 * Rulare (userId-ul e in Clerk Dashboard > Users, de forma user_xxx):
 *   node --env-file=.env.local scripts/claim-legacy-data.mjs user_xxx
 *
 * Ruleaza intr-o tranzactie. Nu atinge randurile care au deja un user_id.
 */

import pg from "pg";

const userId = process.argv[2];
if (!userId || !userId.startsWith("user_")) {
  console.error("Foloseste: node --env-file=.env.local scripts/claim-legacy-data.mjs user_xxx");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL lipseste. Ruleaza cu --env-file=.env.local");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" },
});

await client.connect();
try {
  await client.query("BEGIN");
  for (const table of ["accounts", "snapshots", "recurring", "planned", "goals", "app_settings"]) {
    const res = await client.query(
      `UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`,
      [userId]
    );
    console.log(`${table}: ${res.rowCount} randuri atribuite`);
  }
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  await client.end();
}
