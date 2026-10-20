import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer as httpsServer, request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { generate } from "selfsigned";
import { SMTPServer } from "smtp-server";
import { harness, freePort, BrowserSession, fixturePassword } from "./harness";

// Real local TLS termination + two independent production Next processes and
// authenticated TLS SMTP. This is protocol proof, not hosted/inbox acceptance.
export async function productionHarness() {
  const saved = { ...process.env }, authorities = getCACertificates("default");
  const local = await harness({ captureLogs: true });
  await local.migrate();
  const email = "owner@example.test", password = fixturePassword(), legacy = new BrowserSession(local.base);
  if (!(await legacy.request("/api/auth/sign-up/email", "POST", { name: "Synthetic", email, password })).ok) throw new Error("Legacy seed failed");
  await legacy.request(await local.mail(email, "verification"));
  await legacy.request("/api/auth/sign-in/email", "POST", { email, password });
  await legacy.request("/api/v1/onboarding", "POST", { name: "Preserved studio", slug: "preserved-studio", locale: "en", timezone: "Asia/Makassar" });
  const original = (await (await legacy.request("/api/v1/me")).json()).data;
  local.child.kill(); await once(local.child, "exit");
  const cert = await generate([{ name: "commonName", value: "localhost" }], { keySize: 2048, algorithm: "sha256",
    extensions: [{ name: "basicConstraints", cA: true }, { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] }] });
  const directory = path.resolve(".local/tests", `tls-${randomBytes(8).toString("hex")}`);
  await mkdir(directory, { recursive: true }); const ca = path.join(directory, "ca.pem"); await writeFile(ca, cert.cert);
  setDefaultCACertificates([...authorities, cert.cert]);
  const messages: { to: string; url: string }[] = [];
  let rejectDelivery = false, secureDeliveries = 0;
  const smtpPassword = fixturePassword(), smtpPort = await freePort();
  const smtp = new SMTPServer({ secure: true, key: cert.private, cert: cert.cert, logger: false, disableReverseLookup: true,
    onAuth(auth, session, done) { done(session.secure && auth.username === "synthetic-smtp" && auth.password === smtpPassword ? null : new Error("Denied"), { user: "synthetic" }); },
    onData(stream, session, done) {
      let raw = ""; stream.on("data", chunk => { raw += chunk.toString(); });
      stream.on("end", () => {
        if (rejectDelivery) return done(Object.assign(new Error("Synthetic rejection"), { responseCode: 451 }));
        const split = raw.indexOf("\r\n\r\n"), headers = raw.slice(0, split), encoded = raw.slice(split + 4);
        const text = /Content-Transfer-Encoding: base64/i.test(headers) ? Buffer.from(encoded, "base64").toString() : encoded.replace(/=\r\n/g, "").replace(/=([a-f\d]{2})/ig, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        const url = text.match(/https:\/\/[^\s]+\/api\/auth\/[^\s]+/)?.[0];
        if (!url) return done(new Error("Missing synthetic link"));
        secureDeliveries += Number(session.secure);
        messages.push({ to: session.envelope.rcptTo[0].address, url }); done();
      });
    },
  });
  // Expected TLS rejection tests must not produce raw exception logs.
  smtp.on("error", () => {});
  await new Promise<void>(resolve => smtp.listen(smtpPort, "127.0.0.1", resolve));
  const ports = [await freePort(), await freePort()], tlsPort = await freePort(), base = `https://localhost:${tlsPort}`;
  Object.assign(process.env, { APP_MODE: "production", APP_URL: base, AUTH_OWNER_EMAILS: "owner@example.test,retry@example.test,browser@example.test",
    SMTP_HOST: "localhost", SMTP_PORT: String(smtpPort), SMTP_TLS: "implicit", SMTP_USER: "synthetic-smtp", SMTP_PASSWORD: smtpPassword, SMTP_FROM: "sender@example.test", NODE_EXTRA_CA_CERTS: ca });
  let logs = "", cursor = 0;
  const children: ChildProcess[] = [];
  async function start(index: number) {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(ports[index])], { env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    children[index] = child;
    for (const stream of [child.stdout, child.stderr]) stream?.on("data", chunk => { logs = (logs + chunk.toString()).slice(-65536); });
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Production web process exited");
      try { if ((await fetch(`http://127.0.0.1:${ports[index]}/health/live`)).ok) return; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("Production startup timed out");
  }
  const proxy = httpsServer({ key: cert.private, cert: cert.cert }, (request, response) => {
    const upstream = httpRequest({ host: "127.0.0.1", port: ports[cursor++ % ports.length], path: request.url, method: request.method, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode!, incoming.headers); incoming.pipe(response);
    });
    upstream.on("error", () => { response.writeHead(503); response.end(); }); request.pipe(upstream);
  });
  await start(0); await start(1); proxy.listen(tlsPort, "127.0.0.1"); await once(proxy, "listening");
  return { base, pool: local.pool, email, password, original, legacy,
    // Native HTTPS preserves Fetch Metadata and Host exactly. Fetch rewrites
    // Sec-Fetch-Mode/Host, so it cannot prove these browser/proxy denial cases.
    async rawRequest(url: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) {
      return new Promise<Response>((resolve, reject) => {
        const request = httpsRequest(url.startsWith("https:") ? url : `${base}${url}`, { method, servername: "localhost", headers: { ...(method === "POST" ? { Origin: base, "Content-Type": "application/json" } : {}), ...headers } }, incoming => {
          const chunks: Buffer[] = []; incoming.on("data", chunk => chunks.push(chunk));
          incoming.on("end", () => { const responseHeaders = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) for (const part of Array.isArray(value) ? value : [value]) responseHeaders.append(key, part); resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers: responseHeaders })); });
        });
        request.on("error", () => reject(new Error("Synthetic HTTPS request failed"))); request.end(value === undefined ? undefined : JSON.stringify(value));
      });
    },
    logs: () => logs, messages, secureDeliveries: () => secureDeliveries, tls: { key: cert.private, cert: cert.cert },
    rejectDelivery(value: boolean) { rejectDelivery = value; },
    mail(to: string, kind: "verification" | "recovery") {
      const message = messages.findLast(m => m.to === to && m.url.includes(kind === "verification" ? "/verify-email?" : "/reset-password/"));
      if (!message) throw new Error("Expected SMTP message missing"); return message.url;
    },
    async restart() { for (const child of children) { child.kill(); await once(child, "exit"); } await start(0); await start(1); },
    async close() {
      proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve()));
      for (const child of children) { child.kill(); await once(child, "exit"); }
      await new Promise<void>(resolve => smtp.close(() => resolve()));
      await local.close(); setDefaultCACertificates(authorities); process.env = saved;
    },
  };
}
