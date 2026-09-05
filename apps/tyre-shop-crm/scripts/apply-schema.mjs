import { lookup } from "node:dns";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(resolve(root, "supabase/smt.sql"), "utf8");
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password && !process.env.SUPABASE_DB_URL) {
  console.error("Set SUPABASE_DB_PASSWORD or SUPABASE_DB_URL");
  process.exit(1);
}
const encoded = password ? encodeURIComponent(password) : "";
const ref = "jxuymuvtaqvxlkwqrdbe";

const urls = [
  process.env.SUPABASE_DB_URL,
  `postgresql://postgres.${ref}:${encoded}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encoded}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
].filter(Boolean);

let lastError = null;
for (const connectionString of urls) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    lookup(hostname, options, callback) {
      lookup(hostname, { ...options, family: 4, all: false }, callback);
    },
  });
  try {
    await client.connect();
    console.log("connected", connectionString.replace(/:[^:@]+@/, ":***@"));
    await client.query(sql);
    const tables = await client.query(
      `select tablename from pg_tables where schemaname='public' and tablename like 'smt_%' order by 1`,
    );
    console.log(
      "tables",
      tables.rows.map((r) => r.tablename),
    );
    await client.end();
    process.exit(0);
  } catch (error) {
    lastError = error;
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    console.warn("try failed:", error.message);
  }
}

console.error("could not apply schema", lastError);
process.exit(1);
