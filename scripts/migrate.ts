import { db } from "../src/db/pool";
import { migrate } from "../src/db/migrate";

try { await migrate(db()); console.log("Migrations applied and checksums verified."); }
catch { console.error("Migration failed; no success claimed. Check database availability and migration history."); process.exitCode = 1; }
finally { await db().end(); }
