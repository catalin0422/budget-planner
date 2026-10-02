import { execute, query, queryOne, withTransaction } from "./db";
import { toRON } from "./balance";
import type {
  Account,
  AppSettings,
  Currency,
  ExchangeRates,
  Goal,
  PlannedItem,
  RecurringItem,
  Snapshot,
  SnapshotWithBalances,
} from "./types";

// ---------- accounts ----------

export async function listAccounts(userId: string, includeArchived = false): Promise<Account[]> {
  const sql = includeArchived
    ? "SELECT * FROM accounts WHERE user_id = ? ORDER BY sort_order, id"
    : "SELECT * FROM accounts WHERE user_id = ? AND archived = 0 ORDER BY sort_order, id";
  return query<Account>(sql, [userId]);
}

export async function createAccount(userId: string, params: {
  name: string;
  currency: Currency;
}): Promise<Account> {
  const sortRow = await queryOne<{ next: number }>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM accounts WHERE user_id = ?",
    [userId]
  );
  const account = await queryOne<Account>(
    "INSERT INTO accounts (user_id, name, currency, sort_order) VALUES (?, ?, ?, ?) RETURNING *",
    [userId, params.name, params.currency, sortRow?.next ?? 1]
  );
  if (!account) throw new Error("createAccount: inserarea nu a intors niciun rand");
  return account;
}

export async function updateAccount(
  userId: string,
  id: number,
  fields: { name?: string; currency?: Currency; archived?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    values.push(fields.name);
  }
  if (fields.currency !== undefined) {
    sets.push("currency = ?");
    values.push(fields.currency);
  }
  if (fields.archived !== undefined) {
    sets.push("archived = ?");
    values.push(fields.archived ? 1 : 0);
  }
  if (sets.length === 0) return;
  values.push(id, userId);
  await execute(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, values);
}

export async function deleteAccount(userId: string, id: number): Promise<void> {
  // snapshot_balances are ON DELETE CASCADE pe account_id, dar stergem explicit
  // ca sa pastram acelasi comportament ca inainte.
  await withTransaction(async (tx) => {
    await tx.execute(
      `DELETE FROM snapshot_balances
       WHERE account_id IN (SELECT id FROM accounts WHERE id = ? AND user_id = ?)`,
      [id, userId]
    );
    await tx.execute("DELETE FROM accounts WHERE id = ? AND user_id = ?", [id, userId]);
  });
}

// ---------- snapshots ----------

function snapshotTotal(
  balances: Record<number, number>,
  accounts: Account[],
  rates: ExchangeRates
): number {
  let total = 0;
  for (const acc of accounts) {
    const amount = balances[acc.id] ?? 0;
    total += toRON(amount, acc.currency, rates);
  }
  return total;
}

/**
 * Totalurile (RON) sunt calculate cu cursul curent pentru toate snapshot-urile,
 * nu cu cel din ziua fiecaruia: asa, o miscare de curs nu apare in verdicte ca
 * bani economisiti sau cheltuiti.
 */
export async function listSnapshotsWithBalances(
  userId: string,
  rates: ExchangeRates
): Promise<SnapshotWithBalances[]> {
  const [accounts, snapshots, allBalances] = await Promise.all([
    listAccounts(userId, true),
    query<Snapshot>("SELECT * FROM snapshots WHERE user_id = ? ORDER BY date ASC", [userId]),
    query<{ snapshot_id: number; account_id: number; amount: number }>(
      `SELECT sb.* FROM snapshot_balances sb
       JOIN snapshots s ON s.id = sb.snapshot_id
       WHERE s.user_id = ?`,
      [userId]
    ),
  ]);

  return snapshots.map((s) => {
    const balances: Record<number, number> = {};
    for (const b of allBalances) {
      if (b.snapshot_id === s.id) balances[b.account_id] = b.amount;
    }
    return {
      id: s.id,
      date: s.date,
      note: s.note,
      balances,
      total: snapshotTotal(balances, accounts, rates),
    };
  });
}

export async function getLatestSnapshotWithBalances(
  userId: string,
  rates: ExchangeRates
): Promise<SnapshotWithBalances | null> {
  const snapshots = await listSnapshotsWithBalances(userId, rates);
  return snapshots.length ? snapshots[snapshots.length - 1] : null;
}

/** Un singur snapshot pe zi: a doua salvare pe aceeasi data il actualizeaza pe primul. */
export async function upsertSnapshot(userId: string, params: {
  date: string;
  note: string | null;
  balances: Record<number, number>;
}): Promise<void> {
  await withTransaction(async (tx) => {
    const snapshot = await tx.queryOne<{ id: number }>(
      `INSERT INTO snapshots (user_id, date, note) VALUES (?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET note = excluded.note
       RETURNING id`,
      [userId, params.date, params.note]
    );
    if (!snapshot) throw new Error("upsertSnapshot: upsert-ul nu a intors niciun rand");

    for (const [accountId, amount] of Object.entries(params.balances)) {
      // SELECT-ul din accounts garanteaza ca soldul se scrie doar pe un cont al
      // utilizatorului; un account_id strain nu insereaza nimic.
      await tx.execute(
        `INSERT INTO snapshot_balances (snapshot_id, account_id, amount)
         SELECT ?, a.id, ? FROM accounts a WHERE a.id = ? AND a.user_id = ?
         ON CONFLICT (snapshot_id, account_id) DO UPDATE SET amount = excluded.amount`,
        [snapshot.id, amount, Number(accountId), userId]
      );
    }
  });
}

export async function deleteSnapshot(userId: string, id: number): Promise<void> {
  await execute("DELETE FROM snapshots WHERE id = ? AND user_id = ?", [id, userId]);
}

// ---------- recurring ----------

export async function listRecurring(userId: string, activeOnly = false): Promise<RecurringItem[]> {
  const sql = activeOnly
    ? "SELECT * FROM recurring WHERE user_id = ? AND active = 1 ORDER BY sort_order, id"
    : "SELECT * FROM recurring WHERE user_id = ? ORDER BY sort_order, id";
  return query<RecurringItem>(sql, [userId]);
}

export async function createRecurring(userId: string, params: {
  label: string;
  amount: number;
  currency: Currency;
  kind: "income" | "expense";
  dayOfMonth?: number | null;
  nthBusinessDay?: number | null;
}): Promise<RecurringItem> {
  const sortRow = await queryOne<{ next: number }>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM recurring WHERE user_id = ?",
    [userId]
  );
  const item = await queryOne<RecurringItem>(
    `INSERT INTO recurring (user_id, label, amount, currency, kind, day_of_month, nth_business_day, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      userId,
      params.label,
      params.amount,
      params.currency,
      params.kind,
      params.dayOfMonth ?? null,
      params.nthBusinessDay ?? null,
      sortRow?.next ?? 1,
    ]
  );
  if (!item) throw new Error("createRecurring: inserarea nu a intors niciun rand");
  return item;
}

const RECURRING_NUMBER_COLUMNS = new Set(["amount", "day_of_month", "nth_business_day"]);
const RECURRING_TEXT_COLUMNS = new Set(["label", "currency", "kind", "confirmed_through"]);
const RECURRING_FLAG_COLUMNS = new Set(["active"]);

export async function updateRecurring(
  userId: string,
  id: number,
  fields: Record<string, unknown>
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (RECURRING_FLAG_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value ? 1 : 0);
    } else if (RECURRING_NUMBER_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value === null || value === undefined || value === "" ? null : Number(value));
    } else if (RECURRING_TEXT_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value ?? "");
    }
  }
  if (sets.length === 0) return;
  values.push(id, userId);
  await execute(`UPDATE recurring SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, values);
}

export async function deleteRecurring(userId: string, id: number): Promise<void> {
  await execute("DELETE FROM recurring WHERE id = ? AND user_id = ?", [id, userId]);
}

// ---------- planned ----------

export async function listPlanned(userId: string): Promise<PlannedItem[]> {
  return query<PlannedItem>("SELECT * FROM planned WHERE user_id = ? ORDER BY date, id", [userId]);
}

export async function createPlanned(userId: string, params: {
  label: string;
  amount: number;
  currency: Currency;
  kind: "income" | "expense";
  date: string;
}): Promise<PlannedItem> {
  const item = await queryOne<PlannedItem>(
    `INSERT INTO planned (user_id, label, amount, currency, kind, date)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [userId, params.label, params.amount, params.currency, params.kind, params.date]
  );
  if (!item) throw new Error("createPlanned: inserarea nu a intors niciun rand");
  return item;
}

const PLANNED_NUMBER_COLUMNS = new Set(["amount"]);
const PLANNED_TEXT_COLUMNS = new Set(["label", "currency", "date", "kind"]);
const PLANNED_FLAG_COLUMNS = new Set(["done"]);

export async function updatePlanned(
  userId: string,
  id: number,
  fields: Record<string, unknown>
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (PLANNED_FLAG_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value ? 1 : 0);
    } else if (PLANNED_NUMBER_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(Number(value));
    } else if (PLANNED_TEXT_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value ?? "");
    }
  }
  if (sets.length === 0) return;
  values.push(id, userId);
  await execute(`UPDATE planned SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, values);
}

export async function deletePlanned(userId: string, id: number): Promise<void> {
  await execute("DELETE FROM planned WHERE id = ? AND user_id = ?", [id, userId]);
}

// ---------- app settings ----------

/** Setarile utilizatorului; la prima accesare se creeaza cu valorile implicite din schema. */
export async function getAppSettings(userId: string): Promise<AppSettings> {
  const existing = await queryOne<AppSettings>(
    "SELECT * FROM app_settings WHERE user_id = ?",
    [userId]
  );
  if (existing) return existing;

  await execute(
    "INSERT INTO app_settings (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING",
    [userId]
  );
  const created = await queryOne<AppSettings>(
    "SELECT * FROM app_settings WHERE user_id = ?",
    [userId]
  );
  if (!created) throw new Error("getAppSettings: nu s-au putut crea setarile implicite");
  return created;
}

export async function updateAppSettings(userId: string, fields: {
  dailyBudget?: number;
}): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.dailyBudget !== undefined) {
    sets.push("daily_budget = ?");
    values.push(fields.dailyBudget);
  }
  if (sets.length === 0) return;
  await getAppSettings(userId); // garanteaza ca randul exista
  values.push(userId);
  await execute(`UPDATE app_settings SET ${sets.join(", ")} WHERE user_id = ?`, values);
}

// ---------- goals ----------

export async function listGoals(userId: string, includeArchived = false): Promise<Goal[]> {
  const sql = includeArchived
    ? "SELECT * FROM goals WHERE user_id = ? ORDER BY sort_order, id"
    : "SELECT * FROM goals WHERE user_id = ? AND archived = 0 ORDER BY sort_order, id";
  return query<Goal>(sql, [userId]);
}

export async function createGoal(userId: string, params: {
  name: string;
  targetDate?: string | null;
  targetAmount?: number | null;
}): Promise<Goal> {
  const sortRow = await queryOne<{ next: number }>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM goals WHERE user_id = ?",
    [userId]
  );
  const goal = await queryOne<Goal>(
    "INSERT INTO goals (user_id, name, target_date, target_amount, sort_order) VALUES (?, ?, ?, ?, ?) RETURNING *",
    [userId, params.name, params.targetDate ?? null, params.targetAmount ?? null, sortRow?.next ?? 1]
  );
  if (!goal) throw new Error("createGoal: inserarea nu a intors niciun rand");
  return goal;
}

export async function updateGoal(
  userId: string,
  id: number,
  fields: { name?: string; targetDate?: string | null; targetAmount?: number | null; archived?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    values.push(fields.name);
  }
  if (fields.targetDate !== undefined) {
    sets.push("target_date = ?");
    values.push(fields.targetDate);
  }
  if (fields.targetAmount !== undefined) {
    sets.push("target_amount = ?");
    values.push(fields.targetAmount);
  }
  if (fields.archived !== undefined) {
    sets.push("archived = ?");
    values.push(fields.archived ? 1 : 0);
  }
  if (sets.length === 0) return;
  values.push(id, userId);
  await execute(`UPDATE goals SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, values);
}

export async function deleteGoal(userId: string, id: number): Promise<void> {
  await execute("DELETE FROM goals WHERE id = ? AND user_id = ?", [id, userId]);
}
