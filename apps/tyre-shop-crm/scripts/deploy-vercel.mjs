#!/usr/bin/env node
/**
 * Create / update the Tyres 4 U SMT CRM Vercel project.
 * Does not touch tyre-fighter-dundee-inbox or the wasup worker.
 *
 * Requires VERCEL_TOKEN. Never prints secret values.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = process.env.VERCEL_PROJECT || "tyres-4u-smt-crm";
const vercelBin = process.env.VERCEL_BIN || "vercel";
const envPath = resolve(root, ".env.local");

const ENV_KEYS = [
  "DUNDEE_DASHBOARD_PASSWORD",
  "CRM_AUTH_SECRET",
  "SMT_MODE",
  "SMT_EMAIL",
  "SMT_PASSWORD",
  "SMT_ORIGIN",
  "SHOP_NAME",
  "POLL_INTERVAL_MS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "WEBHOOK_URL",
  "WEBHOOK_SECRET",
  "CRON_SECRET",
];

function parseDotEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function runVercel(args, { input } = {}) {
  const result = spawnSync(vercelBin, args, {
    cwd: root,
    encoding: "utf8",
    input,
    env: process.env,
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "vercel failed").trim();
    throw new Error(err.split("\n").slice(-12).join("\n"));
  }
  return (result.stdout || "").trim();
}

if (!process.env.VERCEL_TOKEN) {
  console.error("Set VERCEL_TOKEN, then re-run: node scripts/deploy-vercel.mjs");
  process.exit(1);
}

if (!existsSync(envPath)) {
  console.error("Missing apps/tyre-shop-crm/.env.local");
  process.exit(1);
}

const local = parseDotEnv(readFileSync(envPath, "utf8"));
if (!local.CRON_SECRET) {
  local.CRON_SECRET = randomBytes(24).toString("hex");
}
if (!local.SMT_MODE) local.SMT_MODE = "live";
if (!local.POLL_INTERVAL_MS) local.POLL_INTERVAL_MS = "60000";

console.log(`Linking Vercel project ${project} (root ${root})`);
runVercel(["link", "--yes", "--project", project]);

for (const key of ENV_KEYS) {
  const value = local[key];
  if (value === undefined) continue;
  const sensitive = !key.startsWith("NEXT_PUBLIC_") && key !== "TZ" && key !== "SMT_MODE" && key !== "SHOP_NAME" && key !== "SMT_ORIGIN" && key !== "POLL_INTERVAL_MS";
  const args = [
    "env",
    "add",
    key,
    "production,preview,development",
    "--yes",
    "--force",
    "--project",
    project,
  ];
  if (sensitive) args.push("--sensitive");
  runVercel(args, { input: `${value}\n` });
  console.log(`set ${key}`);
}

console.log("Deploying production");
const url = runVercel(["deploy", "--prod", "--yes", "--project", project]);
console.log(url);
