import { z } from "zod";

const loopback = (host: string) => ["127.0.0.1", "localhost", "[::1]"].includes(host);
const mailbox = z.email().max(254);

export function config() {
  const mode = process.env.APP_MODE, appUrl = process.env.APP_URL, databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET, mailKey = process.env.LOCAL_MAIL_KEY ?? "";
  if (!appUrl || !databaseUrl || !secret || secret.length < 32 || !["local", "production"].includes(mode ?? "")) throw new Error("Application configuration is missing or invalid.");
  const url = new URL(appUrl), database = new URL(databaseUrl);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["postgres:", "postgresql:"].includes(database.protocol)) throw new Error("Invalid application or database URL.");
  if (mode === "local") {
    if (!loopback(url.hostname) || url.protocol !== "http:" || !loopback(database.hostname) || mailKey.length < 32) throw new Error("Local mode requires loopback HTTP/database and a local mail key.");
    return { mode: "local" as const, appUrl: url.origin, databaseUrl, secret, mailKey, smtp: undefined, ownerEmails: [] as string[] };
  }
  if (url.protocol !== "https:" || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" || !/^[a-f\d]{64,128}$/i.test(secret) || secret.length % 2 || new Set(secret).size < 10) throw new Error("Production requires verified HTTPS and a generated 32–64 byte hexadecimal auth secret.");
  // pg verifies both CA and hostname with verify-full. Never accept no-verify.
  if (!loopback(database.hostname) && (database.searchParams.get("sslmode") !== "verify-full" || database.searchParams.has("uselibpqcompat"))) throw new Error("Remote production databases require verified TLS.");
  const ownerEmails = (process.env.AUTH_OWNER_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase());
  if (ownerEmails.length > 100 || ownerEmails.some(s => !mailbox.safeParse(s).success)) throw new Error("Production requires an explicit private owner email allowlist.");
  const host = process.env.SMTP_HOST ?? "", port = Number(process.env.SMTP_PORT), tls = process.env.SMTP_TLS;
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASSWORD, from = process.env.SMTP_FROM;
  if (!/^[a-z\d.-]+$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !["implicit", "starttls"].includes(tls ?? "") || !user || !pass || !mailbox.safeParse(from).success) throw new Error("Production requires authenticated TLS SMTP configuration.");
  return { mode: "production" as const, appUrl: url.origin, databaseUrl, secret, mailKey,
    ownerEmails: [...new Set(ownerEmails)], smtp: { host, port, secure: tls === "implicit", user, pass, from: from! } };
}

export function ownerAllowed(email: string) {
  const env = config();
  return env.mode === "local" || env.ownerEmails.includes(email.trim().toLowerCase());
}
