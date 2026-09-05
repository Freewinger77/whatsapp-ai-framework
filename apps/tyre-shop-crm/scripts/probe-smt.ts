import { mkdirSync, writeFileSync } from "node:fs";
import { LiveSmtClient } from "../lib/smt/client";
import { CRM_PATHS } from "../lib/smt/types";

const out = "/tmp/smt-live";
mkdirSync(out, { recursive: true });

const client = new LiveSmtClient();
await client.login();
const ping = await client.ping();
console.log("ping", ping);

const dumps: Array<[string, () => Promise<unknown>]> = [
  ["customers-p1", () => client.listCustomers(1, 25)],
  ["enquiries-p1", () => client.listEnquiries(1, 25)],
  ["nps-p1", () => client.listNps(1, 25)],
  ["testimonials-p1", () => client.listTestimonials(1, 25)],
  ["customers-csv", () => client.exportCustomersCsv()],
  ["headline-nps", () => client.headlineNps()],
];

for (const [name, fn] of dumps) {
  try {
    const data = await fn();
    writeFileSync(`${out}/${name}.json`, JSON.stringify(data, null, 2));
    const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items;
    console.log(name, Array.isArray(items) ? items.length : data);
  } catch (err) {
    console.error(name, err instanceof Error ? err.message : err);
  }
}

// Also dump raw HTML of key pages via a second login fetch by reading saved lists.
console.log("paths", CRM_PATHS);
console.log("wrote", out);
