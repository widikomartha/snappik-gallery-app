import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir(".local", { recursive: true });
const password = randomBytes(32).toString("hex");
try {
  await writeFile(".env.local", [
    "APP_MODE=local", "APP_URL=http://127.0.0.1:3000",
    `DATABASE_URL=postgresql://snappik:${password}@127.0.0.1:55432/snappik`,
    `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
    `LOCAL_MAIL_KEY=${randomBytes(32).toString("base64url")}`, "",
  ].join("\n"), { flag: "wx", mode: 0o600 });
  console.log("Created private .env.local. Next: npm run db:local");
} catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; console.log("Existing .env.local preserved."); }
