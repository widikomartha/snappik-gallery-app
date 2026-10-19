export function config() {
  const appUrl = process.env.APP_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  const mailKey = process.env.LOCAL_MAIL_KEY;
  if (!appUrl || !databaseUrl || !secret || secret.length < 32 || !mailKey || mailKey.length < 32) {
    throw new Error("Local configuration is missing; run npm run setup:local.");
  }
  const url = new URL(appUrl);
  // A release adapter must be reviewed before accepting any nonlocal mode.
  if (process.env.APP_MODE !== "local" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:") {
    throw new Error("Only loopback local authentication is enabled. D-01 is open.");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)) {
    throw new Error("Local mode requires a loopback database.");
  }
  return { appUrl: url.origin, databaseUrl, secret, mailKey };
}
