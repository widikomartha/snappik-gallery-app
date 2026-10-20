import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "../../db/pool";
import { config } from "../../config";
import { AsyncLocalStorage } from "node:async_hooks";
import nodemailer from "nodemailer";

type Delivery = { kind: "verification" | "recovery"; userId: string; url: string };
const pending = new AsyncLocalStorage<Delivery[]>();
export async function withDeliveries<T>(run: () => Promise<T>): Promise<T> {
  const messages: Delivery[] = [];
  const result = await pending.run(messages, run);
  // Better Auth invokes delivery inside signup's transaction and swallows callback
  // errors. Await outbox writes here, after provider commit, before acknowledging.
  for (const m of messages) {
    if (config().mode === "local") await db().query("INSERT INTO local_mail (user_id,kind,content) VALUES ($1,$2,$3)", [m.userId,m.kind,seal(m.url)]);
    else {
      const user = (await db().query('SELECT email FROM "user" WHERE id=$1', [m.userId])).rows[0];
      if (!user) throw new Error("Delivery unavailable");
      await sendSmtp(user.email, m.kind, m.url);
    }
  }
  return result;
}

// Local mail is encrypted at rest and has no HTTP read endpoint. CLI access only.
export function seal(value: string) {
  if (config().mode !== "local") throw new Error("Local mail is disabled");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(config().mailKey).digest(), iv);
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
export function unseal(value: string) {
  if (config().mode !== "local") throw new Error("Local mail is disabled");
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(config().mailKey).digest(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
}
export async function deliver(kind: "verification" | "recovery", userId: string, url: string) {
  const messages = pending.getStore();
  if (!messages) throw new Error("Mail delivery requires the reviewed HTTP adapter");
  messages.push({ kind, userId, url });
}

export async function sendSmtp(to: string, kind: Delivery["kind"], url: string) {
  const env = config(), smtp = env.smtp;
  if (!smtp || !env.ownerEmails.includes(to.toLowerCase()) || new URL(url).origin !== env.appUrl) throw new Error("Delivery unavailable");
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: true,
    auth: { user: smtp.user, pass: smtp.pass },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: smtp.host },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      transport.sendMail({ from: smtp.from, to, subject: kind === "verification" ? "Verify your Snappik email / Verifikasi email Snappik" : "Reset your Snappik password / Atur ulang kata sandi Snappik",
        text: `${kind === "verification" ? "Verify your email / Verifikasi email Anda" : "Reset your password / Atur ulang kata sandi Anda"}:\n\n${url}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.\nTautan berlaku 30 menit. Abaikan email ini jika Anda tidak memintanya.` }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { transport.close(); reject(new Error("Delivery unavailable")); }, 15000); }),
    ]);
    if (result.rejected.length || result.accepted.length !== 1) throw new Error("Delivery unavailable");
  } finally { clearTimeout(timer); transport.close(); }
}
