import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "../../db/pool";
import { config } from "../../config";
import { AsyncLocalStorage } from "node:async_hooks";

type Delivery = { kind: "verification" | "recovery"; userId: string; content: string };
const pending = new AsyncLocalStorage<Delivery[]>();
export async function withDeliveries<T>(run: () => Promise<T>): Promise<T> {
  const messages: Delivery[] = [];
  const result = await pending.run(messages, run);
  // Better Auth invokes delivery inside signup's transaction and swallows callback
  // errors. Await outbox writes here, after provider commit, before acknowledging.
  for (const m of messages) await db().query("INSERT INTO local_mail (user_id,kind,content) VALUES ($1,$2,$3)", [m.userId,m.kind,m.content]);
  return result;
}

// Local mail is encrypted at rest and has no HTTP read endpoint. CLI access only.
export function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(config().mailKey).digest(), iv);
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
export function unseal(value: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(config().mailKey).digest(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
}
export async function deliver(kind: "verification" | "recovery", userId: string, url: string) {
  const messages = pending.getStore();
  if (!messages) throw new Error("Mail delivery requires the reviewed HTTP adapter");
  messages.push({ kind, userId, content: seal(url) });
}
