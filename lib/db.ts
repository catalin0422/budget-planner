import { Pool, types, type PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Parsere de tipuri
// ---------------------------------------------------------------------------
// Implicit, driverul `pg` converteste timestamp-urile in obiecte Date si
// bigint-urile in string-uri. Ambele ar rupe cod existent, asa ca le aducem
// inapoi la ce intorcea node:sqlite.

// timestamptz (1184) si timestamp (1114) -> string brut.
// lib/types.ts declara `created_at: string`, nu Date.
types.setTypeParser(1184, (v) => v);
types.setTypeParser(1114, (v) => v);

// int8 / bigint (20) -> number. COUNT(*) intoarce bigint in Postgres, iar
// queries.ts foloseste rezultatul direct ca numar (ex: COALESCE(MAX(sort_order), 0) + 1).
types.setTypeParser(20, (v) => Number(v));

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

declare global {
  var __budgetPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL lipseste. Ia connection string-ul din Supabase > Connect > " +
        "Transaction pooler (portul 6543) si pune-l in .env.local. Vezi README."
    );
  }

  const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);

  return new Pool({
    connectionString,
    // Pe Vercel fiecare instanta de functie are pool-ul ei, iar Supavisor face
    // deja pooling-ul real in fata bazei. Tinem putine conexiuni per instanta.
    max: isLocal ? 5 : 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal
      ? undefined
      : // Supavisor prezinta un certificat public valid. Daca totusi primesti
        // "self-signed certificate in certificate chain", seteaza
        // DATABASE_SSL_NO_VERIFY=1 (vezi README).
        { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" },
  });
}

export function getPool(): Pool {
  if (!global.__budgetPool) {
    global.__budgetPool = createPool();
  }
  return global.__budgetPool;
}

// ---------------------------------------------------------------------------
// Helpere de interogare
// ---------------------------------------------------------------------------

/**
 * Converteste placeholderele SQLite `?` in cele Postgres `$1, $2, ...`.
 *
 * Exista ca sa nu fie nevoie sa rescriem cele ~30 de interogari din queries.ts:
 * SQL-ul ramane identic cu cel scris pentru node:sqlite.
 *
 * Atentie: inlocuirea e pur textuala, deci un `?` aflat intr-un literal de tip
 * string ar fi convertit gresit. In codul asta nu exista niciunul; daca vreodata
 * scrii o interogare cu `?` intr-un string, foloseste direct `$n`.
 */
function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export interface Queryable {
  /** Intoarce toate randurile. */
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Intoarce primul rand sau null. Echivalentul lui .get() din node:sqlite. */
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Ruleaza o comanda fara sa citeasca rezultatul. Echivalentul lui .run(). */
  execute(sql: string, params?: unknown[]): Promise<void>;
}

function queryableFrom(runner: Pool | PoolClient): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await runner.query(toPositional(sql), params);
      return result.rows as T[];
    },
    async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const result = await runner.query(toPositional(sql), params);
      return (result.rows[0] as T) ?? null;
    },
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      await runner.query(toPositional(sql), params);
    },
  };
}

export function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  return queryableFrom(getPool()).query<T>(sql, params);
}

export function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  return queryableFrom(getPool()).queryOne<T>(sql, params);
}

export function execute(sql: string, params?: unknown[]): Promise<void> {
  return queryableFrom(getPool()).execute(sql, params);
}

/**
 * Ruleaza mai multe comenzi pe aceeasi conexiune, intr-o tranzactie.
 * Necesar pentru scrieri pe mai multe tabele (ex: upsertSnapshot, care scrie
 * un snapshot plus soldurile lui) -- fara asta, o eroare la jumatate ar lasa
 * un snapshot fara solduri.
 */
export async function withTransaction<T>(
  fn: (tx: Queryable) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(queryableFrom(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
