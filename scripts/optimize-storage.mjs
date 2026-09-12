import { resolve } from "node:path";
import { openDatabase } from "../server/db.js";
import { optimizeStorage } from "../server/storage.js";
if (!process.argv.includes("--service-stopped"))
  throw new Error(
    "Stop ZNote and back up its data directory first, then pass --service-stopped.",
  );
const dir = resolve(process.env.DATA_DIR || "data");
const db = openDatabase(dir);
try {
  console.log(JSON.stringify(await optimizeStorage(db, dir), null, 2));
} finally {
  db.close();
}
