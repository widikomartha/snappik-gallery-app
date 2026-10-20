import { db } from "../src/db/pool";
import { unseal } from "../src/modules/auth/mail";
import { config } from "../src/config";

if (config().mode !== "local") throw new Error("The private mailbox is available only in local mode.");
const email = process.argv[2];
if (!email) throw new Error("Usage: npm run mail:local -- owner@example.test (local messages only)");
try {
  const rows = (await db().query('SELECT m.kind,m.content FROM local_mail m JOIN "user" u ON u.id=m.user_id WHERE u.email=$1 AND m.expires_at>now() ORDER BY m.created_at DESC LIMIT 5', [email])).rows;
  // This is an intentional local-only delivery surface, never a server log.
  console.log("Private local mail. Treat links as credentials; do not copy into logs or documentation.");
  for (const row of rows) console.log(`${row.kind}: ${unseal(row.content)}`);
  if (!rows.length) console.log("No unexpired local messages.");
} finally { await db().end(); }
