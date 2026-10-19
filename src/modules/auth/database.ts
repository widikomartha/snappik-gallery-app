import { AsyncLocalStorage } from "node:async_hooks";
import { Kysely, PostgresDialect } from "kysely";
import { kyselyAdapter } from "@better-auth/kysely-adapter";
import type { DBAdapter, DBTransactionAdapter } from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "better-auth";
import type { Pool } from "pg";

// Some plugin operations use ctx.adapter directly, bypassing the library's
// internal transaction context. Route every adapter method to the same request
// transaction; nested provider transactions join it. No password logic here.
export function authDatabase(pool: Pool) {
  const factory = kyselyAdapter(new Kysely({ dialect: new PostgresDialect({ pool }) }), { type: "postgres", transaction: true });
  const scope = new AsyncLocalStorage<DBTransactionAdapter>();
  return (options: BetterAuthOptions): DBAdapter => {
    const base = factory(options);
    return new Proxy(base, {
      get(target, property) {
        if (property === "transaction") return async <T>(run: (trx: DBTransactionAdapter) => Promise<T>) => {
          const active = scope.getStore();
          if (active) return run(active);
          return base.transaction(trx => scope.run(trx, () => run(trx)));
        };
        const source = scope.getStore() ?? target;
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    });
  };
}
