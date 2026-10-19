import { z } from "zod";
import { auth } from "./provider";
import { authGuard } from "../../db/pool";
import { withDeliveries } from "./mail";
import { body, failure, origin, Problem } from "../http";
import { recordOperatorMfa } from "../operations/mfa";
import { assertOperational } from "../operations/recovery";

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
    origin(request);
    const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
    if (request.method === "POST") {
      if (!schemas[path]) throw new Problem(404, "NOT_FOUND", "Not found.");
      const value = await body(request);
      if (!schemas[path].safeParse(value).success) throw new Problem(422, "INVALID_INPUT", "Check the supplied fields.");
      request = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(value) });
    } else if (request.method !== "GET" || (! ["get-session", "verify-email"].includes(path) && !/^reset-password\/[A-Za-z0-9_-]{1,200}$/.test(path))) throw new Problem(404, "NOT_FOUND", "Not found.");
    // Deliberately conservative local policy: serialize provider requests across processes.
    // Prevent password-check/session-create and factor/reset races while D-01 is open.
    const guard = await authGuard().connect();
    try {
      await guard.query("SELECT pg_advisory_lock(71002)");
      await assertOperational(guard);
      const before = path === "sign-out" ? await auth().api.getSession({ headers: request.headers, query: { disableCookieCache: true } }) : null;
      if (path === "sign-out") {
        if (before) await guard.query("DELETE FROM session WHERE id=$1", [before.session.id]);
        // Revocation uncertainty is failure even when the library would swallow a delete error.
        await guard.query("SELECT 1");
      }
      const execute = async () => {
        const response = await withDeliveries(() => auth().handler(request));
        if (response.status >= 500) throw new Error("Auth storage unavailable");
        if (path === "two-factor/verify-totp" && response.ok) await recordOperatorMfa(request,response);
        return response;
      };
      const response = path.startsWith("two-factor/") || path === "change-password"
        ? await (await auth().$context).adapter.transaction(() => execute())
        : await execute();
      if (path === "sign-out" && before && (await guard.query("SELECT 1 FROM session WHERE id=$1", [before.session.id])).rowCount) throw new Error("Logout not durable");
      response.headers.set("Cache-Control", "no-store");
      return response;
    } finally {
      try { await guard.query("SELECT pg_advisory_unlock(71002)"); }
      finally { guard.release(); }
    }
  } catch (e) { return failure(e); }
}
