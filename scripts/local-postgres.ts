import EmbeddedPostgres from "embedded-postgres";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

export async function postgres(directory: string, port: number, password: string) {
  const root = path.resolve(directory);
  // Never reset or drop databases; tests use their own newly created directories.
  await mkdir(root, { recursive: true });
  const instance = new EmbeddedPostgres({
    databaseDir: root, port, user: "snappik", password, persistent: true,
    authMethod: "scram-sha-256", initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1", "-c", "log_statement=none", "-c", "log_min_error_statement=panic", "-c", "log_parameter_max_length_on_error=0"],
    onLog: () => {}, onError: () => {},
  });
  try { await access(path.join(root, "PG_VERSION")); } catch { await instance.initialise(); }
  await instance.start();
  return instance;
}
