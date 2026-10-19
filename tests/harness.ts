import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";
import { postgres } from "../scripts/local-postgres";
import { migrate } from "../src/db/migrate";
import { unseal } from "../src/modules/auth/mail";

export async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
export async function harness(options:{mailKey?:string;inventoryAdapter?:"disabled"|"google_public"|"synthetic";captureLogs?:boolean}={}) {
  const password = randomBytes(32).toString("hex"); const port = await freePort(); const webPort = await freePort();
  const base = `http://127.0.0.1:${webPort}`;
  const instance = await postgres(`.local/tests/${randomUUID()}`, port, password);
  const pool = new Pool({ connectionString: `postgresql://snappik:${password}@127.0.0.1:${port}/postgres`, max: 12, connectionTimeoutMillis: 3000 });
  Object.assign(process.env, { APP_MODE: "local", APP_URL: base, DATABASE_URL: pool.options.connectionString, BETTER_AUTH_SECRET: randomBytes(48).toString("hex"), LOCAL_MAIL_KEY: options.mailKey??randomBytes(32).toString("hex"), INVENTORY_ADAPTER: options.inventoryAdapter??"disabled", NEXT_TELEMETRY_DISABLED: "1" });
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], { env: process.env, windowsHide: true, stdio: options.captureLogs ? ["ignore","pipe","pipe"] : "ignore" });
  let logs="";
  if(options.captureLogs)for(const stream of [child.stdout,child.stderr])stream?.on("data",chunk=>{logs=(logs+chunk.toString()).slice(-65536);});
  try {
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Next server exited early. Build before running integration tests.");
      try { if ((await fetch(`${base}/health/live`)).ok) break; } catch {}
      if (i === 119) throw new Error("Web startup timed out");
      await new Promise(r => setTimeout(r, 250));
    }
  } catch (e) { child.kill(); await pool.end(); await instance.stop(); throw e; }
  return { base, pool, instance, child, logs:()=>logs,
    migrate: () => migrate(pool),
    async mail(email: string, kind: string) {
      const row = (await pool.query('SELECT m.content FROM local_mail m JOIN "user" u ON u.id=m.user_id WHERE u.email=$1 AND m.kind=$2 ORDER BY m.created_at DESC LIMIT 1', [email, kind])).rows[0];
      if (!row) {
        const counts = (await pool.query('SELECT (SELECT count(*) FROM "user")::int AS users,(SELECT count(*) FROM local_mail)::int AS messages')).rows[0];
        throw new Error(`Expected local delivery missing (users=${counts.users}, messages=${counts.messages})`);
      } return unseal(row.content);
    },
    async close() { child.kill(); await pool.end(); await instance.stop(); },
  };
}
export class BrowserSession {
  cookies = new Map<string, string>();
  constructor(public base: string) {}
  get cookie() { return [...this.cookies.entries()].map(([k,v]) => `${k}=${v}`).join("; "); }
  async request(path: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(path.startsWith("http") ? path : `${this.base}${path}`, { method, redirect: "manual", headers: { Cookie: this.cookie, ...(method === "GET" ? {} : { Origin: this.base, "Content-Type": "application/json" }), ...headers }, body: value === undefined ? undefined : JSON.stringify(value) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]; const i = pair.indexOf("="); const key = pair.slice(0,i); const value = pair.slice(i+1);
      if (!value || /max-age=0/i.test(cookie)) this.cookies.delete(key); else this.cookies.set(key, value);
    }
    return response;
  }
  clone() { const copy = new BrowserSession(this.base); copy.cookies = new Map(this.cookies); return copy; }
}
export const fixturePassword = () => randomBytes(24).toString("base64url");
