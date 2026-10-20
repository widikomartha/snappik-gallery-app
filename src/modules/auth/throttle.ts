import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../../config";
import { Problem } from "../http";

// The provider also applies a shared per-route ceiling with no trusted IP
// headers. These account buckets remain the same across replicas/restarts and
// do not persist email addresses, cookies or recovery tokens.
export async function accountThrottle(client: PoolClient, request: Request, path: string, email?: string) {
  if (config().mode !== "production" || request.method !== "POST") return;
  const subject = email?.trim().toLowerCase() ?? request.headers.get("cookie") ?? "anonymous";
  const mail = ["sign-up/email", "request-password-reset", "send-verification-email"].includes(path);
  const group = mail ? "mail" : path;
  const key = `account:${createHmac("sha256", config().secret).update(`${group}\0${subject}`).digest("hex")}`;
  async function consume(key: string, maximum: number) {
    const result = await client.query(`INSERT INTO "rateLimit" (key,count,"lastRequest") VALUES ($1,1,floor(extract(epoch FROM clock_timestamp())*1000))
    ON CONFLICT (key) DO UPDATE SET
      count=CASE WHEN "rateLimit"."lastRequest"<=floor(extract(epoch FROM clock_timestamp())*1000)-60000 THEN 1 ELSE LEAST("rateLimit".count+1,1000) END,
      "lastRequest"=floor(extract(epoch FROM clock_timestamp())*1000) RETURNING count`, [key]);
    if (result.rows[0].count > maximum) throw new Problem(429, "RATE_LIMITED", "Too many attempts. Retry later.");
  }
  // Includes noninvited/unknown identities, before the generic no-op response.
  await consume(`auth-global:${path}`, 60);
  await consume(key, mail ? 5 : 10);
}
