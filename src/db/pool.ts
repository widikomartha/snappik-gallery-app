import { Pool, type PoolClient } from "pg";
import { config } from "../config";

const globalDb = globalThis as unknown as { snappikPool?: Pool; snappikAuthGuard?: Pool };
export function db() {
  return globalDb.snappikPool ??= new Pool({
    connectionString: config().databaseUrl, max: 12,
    connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
}
// One local waiter per process holds an advisory-lock connection. Other auth
// requests queue outside the business pool rather than exhausting its slots.
export function authGuard() {
  return globalDb.snappikAuthGuard ??= new Pool({ connectionString: config().databaseUrl, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, statement_timeout: 10000 });
}
export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
