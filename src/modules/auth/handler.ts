import { z } from "zod";
import { auth } from "./provider";
import { authGuard } from "../../db/pool";
import { withDeliveries } from "./mail";
import { body, failure, origin, Problem } from "../http";
import { recordOperatorMfa } from "../operations/mfa";
import { assertOperational } from "../operations/recovery";
import { config, ownerAllowed } from "../../config";
import { accountThrottle } from "./throttle";

const password = z.string().min(1).max(128);
const email = z.string().email().max(254);
const callbackURL = z.string().max(500).optional();
const schemas: Record<string, z.ZodType> = {
  "sign-up/email": z.object({ name: z.string().trim().min(1).max(100), email, password, callbackURL }).strict(),
  "sign-in/email": z.object({ email, password, callbackURL, rememberMe: z.boolean().optional() }).strict(),
  "sign-out": z.object({}).strict(),
  "send-verification-email": z.object({ email, callbackURL }).strict(),
  "request-password-reset": z.object({ email, redirectTo: z.string().max(500).optional() }).strict(),
  "reset-password": z.object({ token: z.string().min(1).max(1000), newPassword: password }).strict(),
  "change-password": z.object({ currentPassword: password, newPassword: password, revokeOtherSessions: z.literal(true) }).strict(),
  "two-factor/enable": z.object({ password, method: z.literal("totp").optional() }).strict(),
  "two-factor/disable": z.object({ password }).strict(),
  "two-factor/verify-totp": z.object({ code: z.string().regex(/^\d{6}$/), trustDevice: z.literal(false).optional() }).strict(),
  "two-factor/verify-backup-code": z.object({ code: z.string().max(100), trustDevice: z.literal(false).optional() }).strict(),
  "two-factor/generate-backup-codes": z.object({ password }).strict(),
};
export async function authHandler(request: Request) {
  try {
    let suppliedEmail: string | undefined;
    const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
    origin(request, path === "verify-email" || /^reset-password\/[A-Za-z0-9_-]{1,200}$/.test(path));
    if (request.method === "POST") {
      if (!schemas[path]) throw new Problem(404, "NOT_FOUND", "Not found.");
      const value = await body(request);
      if (!schemas[path].safeParse(value).success) throw new Problem(422, "INVALID_INPUT", "Check the supplied fields.");
      // Restrict credential-bearing redirects to this application, including
      // URL credentials and protocol-relative URLs. Defaults land on real UI.
      const fields = value as Record<string, unknown>;
      if (typeof fields.email === "string") suppliedEmail = fields.email;
      if (["sign-up/email", "sign-in/email", "send-verification-email"].includes(path)) fields.callbackURL = callback(fields.callbackURL, "/login");
      if (path === "request-password-reset") fields.redirectTo = callback(fields.redirectTo, "/recover");
      request = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(value) });
    } else if (request.method !== "GET" || (! ["get-session", "verify-email"].includes(path) && !/^reset-password\/[A-Za-z0-9_-]{1,200}$/.test(path))) throw new Problem(404, "NOT_FOUND", "Not found.");
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.searchParams.has("callbackURL")) callback(url.searchParams.get("callbackURL"), path === "verify-email" ? "/login" : "/recover");
    }
    return await withDeliveries(() => guardedAuth(request, path, suppliedEmail));
  } catch (e) { return failure(e); }
}

async function guardedAuth(request: Request, path: string, suppliedEmail?: string) {
  // A bounded pilot serializes credential/factor transitions across replicas.
  // Delivery runs after this lock and provider transactions have been released.
  const guard = await authGuard().connect();
  let locked = false;
  try {
    await accountThrottle(guard, request, path, suppliedEmail);
    await guard.query("SELECT pg_advisory_lock(71002)"); locked = true;
    await assertOperational(guard);
    if (suppliedEmail && !ownerAllowed(suppliedEmail)) {
      if (path === "sign-in/email") throw new Problem(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password.");
      return Response.json({ status: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const before = path === "sign-out" ? await auth().api.getSession({ headers: request.headers, query: { disableCookieCache: true } }) : null;
    if (path === "sign-out" && before) await guard.query("DELETE FROM session WHERE id=$1", [before.session.id]);
    const execute = async () => {
      const response = await auth().handler(request);
      if (response.status >= 500) throw new Error("Auth storage unavailable");
      if (path === "two-factor/verify-totp" && response.ok) await recordOperatorMfa(request,response);
      return response;
    };
    const response = path.startsWith("two-factor/") || path === "change-password"
      ? await (await auth().$context).adapter.transaction(() => execute())
      : await execute();
    // A lost guard connection cannot acknowledge credentials after losing its
    // serialization lock. Durable logout must survive swallowed provider errors.
    await guard.query("SELECT 1");
    if (path === "sign-out" && before && (await guard.query("SELECT 1 FROM session WHERE id=$1", [before.session.id])).rowCount) throw new Error("Logout not durable");
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    try { if (locked) await guard.query("SELECT pg_advisory_unlock(71002)"); }
    finally { guard.release(); }
  }
}

function callback(value: unknown, fallback: string) {
  const base = config().appUrl;
  if (value === undefined) return `${base}${fallback}`;
  try {
    const url = new URL(String(value), base);
    if (url.origin === base && !url.username && !url.password && !url.hash && !url.search && ["/", "/login", "/recover"].includes(url.pathname)) return url.href;
  } catch {}
  throw new Problem(403, "ORIGIN_DENIED", "Request origin is not allowed.");
}
