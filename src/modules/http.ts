import { randomUUID } from "node:crypto";
import { config } from "../config";

export class Problem extends Error {
  constructor(public status: number, public code: string, message: string, public revision?: number) { super(message); }
}
export const json = (data: unknown, status = 200) => Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
export function failure(error: unknown, requestId = randomUUID()) {
  const p = error instanceof Problem ? error : new Problem(503, "TEMPORARILY_UNAVAILABLE", "Service unavailable. Retry safely.");
  // Never log exceptions, request paths, query strings or request bodies.
  if (!(error instanceof Problem)) console.error(JSON.stringify({ request_id: requestId, code: p.code }));
  return Response.json({ error: { code: p.code, message: p.message, request_id: requestId, ...(p.revision === undefined ? {} : { current_revision: p.revision }) } }, { status: p.status, headers: { "Cache-Control": "no-store", ...(p.status===429?{"Retry-After":"60"}:{}) } });
}
export function origin(request: Request, emailNavigation = false) {
  // Next constructs its internal Request URL from the listening interface.
  // Validate the actual Host and browser Origin against the configured origin.
  if (request.headers.get("host") !== new URL(config().appUrl).host) throw new Problem(403, "ORIGIN_DENIED", "Request origin is not allowed.");
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== config().appUrl) throw new Problem(403, "ORIGIN_DENIED", "Request origin is not allowed.");
  const site = request.headers.get("sec-fetch-site");
  const navigation = emailNavigation && request.method === "GET" && request.headers.get("sec-fetch-mode") === "navigate" && request.headers.get("sec-fetch-dest") === "document";
  if (site === "cross-site" && !navigation) throw new Problem(403, "ORIGIN_DENIED", "Request origin is not allowed.");
}
export async function body(request: Request, maximum = 16384) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Problem(415, "INVALID_INPUT", "Use JSON.");
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) { await reader.cancel(); throw new Problem(413, "PAYLOAD_TOO_LARGE", "Request is too large."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new Problem(400, "INVALID_INPUT", "Invalid JSON."); }
}
