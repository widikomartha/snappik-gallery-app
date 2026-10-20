import { auth } from "./provider";
import { Problem } from "../http";
import type { PoolClient } from "pg";
import { assertOperational } from "../operations/recovery";
import { db } from "../../db/pool";
import { ownerAllowed } from "../../config";

export async function identity(request: Request) {
  await assertOperational(db());
  const session = await auth().api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session || new Date(session.session.expiresAt).getTime() <= Date.now()) throw new Problem(401, "AUTH_REQUIRED", "Please sign in.");
  if (!session.user.emailVerified) throw new Problem(403, "EMAIL_UNVERIFIED", "Verify your email first.");
  if (!ownerAllowed(session.user.email)) throw new Problem(403, "OWNER_NOT_ALLOWED", "Owner access is not available.");
  return session;
}
// Recheck the provider session under the same row locks as every business operation.
// DELETE during logout/reset waits for this operation; no later operation can use it.
export async function lockIdentity(client: PoolClient, session: Awaited<ReturnType<typeof identity>>) {
  await assertOperational(client, true);
  const result = await client.query('SELECT u.id FROM "user" u JOIN session s ON s."userId"=u.id WHERE s.id=$1 AND u.id=$2 AND u."emailVerified" AND s."expiresAt">clock_timestamp() FOR UPDATE OF u,s', [session.session.id, session.user.id]);
  if (!result.rowCount) throw new Problem(401, "AUTH_REQUIRED", "Please sign in again.");
  if (!ownerAllowed(session.user.email)) throw new Problem(403, "OWNER_NOT_ALLOWED", "Owner access is not available.");
  return session;
}
