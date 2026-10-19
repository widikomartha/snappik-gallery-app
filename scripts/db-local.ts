import { loadEnvFile } from "node:process";
import { postgres } from "./local-postgres";
import { config } from "../src/config";

loadEnvFile(".env.local");
const url = new URL(config().databaseUrl);
if (url.port !== "55432" || url.pathname !== "/snappik" || url.username !== "snappik") throw new Error("db:local manages only the generated local database.");
const instance = await postgres(".local/postgres", 55432, decodeURIComponent(url.password));
const client = instance.getPgClient("postgres", "127.0.0.1");
await client.connect();
if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='snappik'")).rowCount) await client.query('CREATE DATABASE "snappik"');
await client.end();
console.log("Local PostgreSQL ready on loopback port 55432. Ctrl+C stops it without removing data.");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  await instance.stop(); process.exit(0);
});
setInterval(() => {}, 60000);
